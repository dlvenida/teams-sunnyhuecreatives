from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import Client, CommentAttachment, CommentReaction, Project, SubClient, Task, TaskComment, TaskPriority, TaskRecurrence, TaskStatus, UserRole, VA, WorkLog
from app.schemas import LinkAttachmentCreate, ReactionToggle, TaskCommentCreate, TaskCommentResponse, TaskCommentUpdate, TaskCreate, TaskResponse, TaskUpdate
from app.services import comments as comment_svc
from app.services.notifications import notify_task_assigned, notify_task_comment, notify_task_updated, push
from app.services.task_recurrence import (
    recover_missing_occurrences,
    recurrence_label,
    spawn_next_occurrence,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])

CUSTOM_UNITS = {"day", "week", "month", "year"}


def _normalize_recurrence(data: dict) -> None:
    """Validate / clean recurrence fields in-place on a create/update payload dict."""
    rec = data.get("recurrence")
    if rec is None:
        return
    if isinstance(rec, str):
        rec = TaskRecurrence(rec)
        data["recurrence"] = rec
    if rec == TaskRecurrence.none:
        data["recurrence_interval"] = 1
        data["recurrence_unit"] = None
        data["recurrence_weekdays"] = None
        data["recurrence_until"] = None
        return
    interval = data.get("recurrence_interval")
    if interval is not None and interval < 1:
        raise HTTPException(400, "Recurrence interval must be at least 1")
    if rec == TaskRecurrence.custom:
        unit = (data.get("recurrence_unit") or "day").lower()
        if unit not in CUSTOM_UNITS:
            raise HTTPException(400, "Custom recurrence unit must be day, week, month, or year")
        data["recurrence_unit"] = unit
        days = data.get("recurrence_weekdays")
        if unit == "week" and days is not None:
            cleaned = sorted({int(d) for d in days if 0 <= int(d) <= 6})
            if not cleaned:
                raise HTTPException(400, "Pick at least one weekday for a custom weekly schedule")
            data["recurrence_weekdays"] = cleaned
    else:
        data["recurrence_unit"] = None
        if rec != TaskRecurrence.weekdays:
            data["recurrence_weekdays"] = None
        else:
            data["recurrence_weekdays"] = [0, 1, 2, 3, 4]


def _serialize(db: Session, t: Task) -> TaskResponse:
    logged = db.query(func.coalesce(func.sum(WorkLog.hours), 0)).filter(WorkLog.task_id == t.id).scalar() or Decimal("0")
    rec = t.recurrence or TaskRecurrence.none
    return TaskResponse(
        id=t.id, title=t.title, description=t.description, client_id=t.client_id,
        client_name=t.client.name if t.client else None, sub_client_id=t.sub_client_id,
        sub_client_name=t.sub_client.name if t.sub_client else None, project_id=t.project_id,
        project_name=t.project.name if t.project else None, project_color=t.project.color if t.project else None,
        assignee_va_id=t.assignee_va_id, assignee_name=t.assignee.name if t.assignee else None,
        status=t.status, priority=t.priority, start_date=t.start_date, due_date=t.due_date,
        estimated_hours=t.estimated_hours, logged_hours=Decimal(str(logged)), position=t.position or 0,
        tags=t.tags or [], checklist=t.checklist or [],
        recurrence=rec,
        recurrence_interval=t.recurrence_interval or 1,
        recurrence_unit=t.recurrence_unit,
        recurrence_weekdays=t.recurrence_weekdays,
        recurrence_until=t.recurrence_until,
        recurrence_label=recurrence_label(
            rec,
            interval=t.recurrence_interval or 1,
            unit=t.recurrence_unit,
            weekdays=t.recurrence_weekdays,
        ),
        series_id=t.series_id,
        parent_task_id=t.parent_task_id,
        completed_at=t.completed_at,
        created_at=t.created_at, updated_at=t.updated_at,
    )


def _base_query(db: Session):
    return db.query(Task).options(joinedload(Task.client), joinedload(Task.sub_client), joinedload(Task.project), joinedload(Task.assignee))


def _visible(q, current: CurrentUser):
    if current.role == UserRole.va:
        return q.filter(or_(Task.assignee_va_id == current.va_id, Task.created_by == current.user.id))
    return q


def _validate_links(db: Session, client_id, sub_client_id, project_id, assignee_va_id):
    if client_id and not db.query(Client).filter(Client.id == client_id).first():
        raise HTTPException(404, "Client not found")
    if sub_client_id:
        sub = db.query(SubClient).filter(SubClient.id == sub_client_id).first()
        if not sub: raise HTTPException(404, "Sub-client not found")
        if client_id and sub.client_id != client_id: raise HTTPException(400, "Sub-client does not belong to this client")
    if project_id:
        proj = db.query(Project).filter(Project.id == project_id).first()
        if not proj: raise HTTPException(404, "Project not found")
        if client_id and proj.client_id != client_id: raise HTTPException(400, "Project does not belong to this client")
    if assignee_va_id and not db.query(VA).filter(VA.id == assignee_va_id).first():
        raise HTTPException(404, "Assignee VA not found")


def _spawn_and_notify(db: Session, done_task: Task) -> Task | None:
    """Create the next repeating task and notify the assignee."""
    child = spawn_next_occurrence(db, done_task)
    if not child:
        return None
    db.flush()
    child_full = _base_query(db).filter(Task.id == child.id).first() or child
    if child_full.assignee_va_id:
        try:
            notify_task_assigned(db, child_full, first_in_project=False)
        except Exception:
            pass
    if done_task.created_by:
        push(
            db,
            [done_task.created_by],
            "task",
            f"🔁 Next repeat created: {child_full.title}",
            f"Due {child_full.due_date} · same client, assignee, and schedule",
            f"/tasks?task={child_full.id}",
        )
    return child_full


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None, project_id: UUID | None = None, assignee_va_id: UUID | None = None,
    status_filter: TaskStatus | None = Query(None, alias="status"), priority: TaskPriority | None = None,
    search: str | None = None, due_from: date | None = None, due_to: date | None = None, overdue: bool = False,
    mine: bool = False,
):
    # Recover Done repeating tasks that never got a next copy
    try:
        spawned = recover_missing_occurrences(db)
        if spawned:
            db.commit()
            for child in spawned:
                if child.assignee_va_id:
                    full = _base_query(db).filter(Task.id == child.id).first()
                    if full:
                        try:
                            notify_task_assigned(db, full, first_in_project=False)
                        except Exception:
                            pass
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    q = _visible(_base_query(db), current)
    if mine and current.va_id: q = q.filter(Task.assignee_va_id == current.va_id)
    if client_id: q = q.filter(Task.client_id == client_id)
    if project_id: q = q.filter(Task.project_id == project_id)
    if assignee_va_id: q = q.filter(Task.assignee_va_id == assignee_va_id)
    if status_filter: q = q.filter(Task.status == status_filter)
    if priority: q = q.filter(Task.priority == priority)
    if search: q = q.filter(or_(Task.title.ilike(f"%{search}%"), Task.description.ilike(f"%{search}%")))
    if due_from: q = q.filter(Task.due_date >= due_from)
    if due_to: q = q.filter(Task.due_date <= due_to)
    if overdue: q = q.filter(Task.due_date < date.today(), Task.status != TaskStatus.done)
    tasks = q.order_by(Task.status, Task.position, Task.due_date.asc().nullslast(), Task.created_at.desc()).all()
    return [_serialize(db, t) for t in tasks]


@router.get("/stats")
def task_stats(current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    q = _visible(db.query(Task), current)
    total = q.count()
    by_status = {s.value: q.filter(Task.status == s).count() for s in TaskStatus}
    overdue = q.filter(Task.due_date < date.today(), Task.status != TaskStatus.done).count()
    due_today = q.filter(Task.due_date == date.today(), Task.status != TaskStatus.done).count()
    unassigned = q.filter(Task.assignee_va_id.is_(None)).count() if current.role == UserRole.admin else 0
    return {"total": total, "by_status": by_status, "overdue": overdue, "due_today": due_today, "unassigned": unassigned}


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    _validate_links(db, body.client_id, body.sub_client_id, body.project_id, body.assignee_va_id)
    if body.due_date and body.start_date and body.due_date < body.start_date:
        raise HTTPException(400, "Deadline cannot be before start date")
    if body.recurrence_until and body.due_date and body.recurrence_until < body.due_date:
        raise HTTPException(400, "Repeat until cannot be before the deadline")
    payload = body.model_dump(exclude={"assignee_va_id"})
    _normalize_recurrence(payload)
    assignee = body.assignee_va_id
    if current.role == UserRole.va:
        assignee = assignee or current.va_id
        if assignee != current.va_id:
            raise HTTPException(403, "VAs can only assign tasks to themselves")
    max_pos = db.query(func.coalesce(func.max(Task.position), 0)).filter(Task.status == body.status).scalar() or 0
    t = Task(**payload, assignee_va_id=assignee, created_by=current.user.id, position=int(max_pos) + 1)
    if t.status == TaskStatus.done:
        t.completed_at = datetime.now(timezone.utc)
    db.add(t)
    db.flush()
    if t.recurrence and t.recurrence != TaskRecurrence.none and not t.series_id:
        t.series_id = t.id
    if t.status == TaskStatus.done:
        _spawn_and_notify(db, t)
    db.commit()
    db.refresh(t)
    t = _base_query(db).filter(Task.id == t.id).first()
    if t.assignee_va_id:
        first_in_project = False
        if t.project_id:
            first_in_project = db.query(Task).filter(Task.project_id == t.project_id, Task.assignee_va_id == t.assignee_va_id).count() <= 1
        notify_task_assigned(db, t, first_in_project=first_in_project)
    return _serialize(db, t)


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    t = _visible(_base_query(db), current).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    return _serialize(db, t)


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: UUID, body: TaskUpdate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    if current.role == UserRole.auditor:
        raise HTTPException(403, "Auditors can view and comment on tasks, but cannot change them")
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    if current.role == UserRole.va and t.assignee_va_id != current.va_id and t.created_by != current.user.id:
        raise HTTPException(403, "You can only update your own tasks")
    if current.role == UserRole.va and body.assignee_va_id and body.assignee_va_id != current.va_id:
        raise HTTPException(403, "VAs cannot reassign tasks")
    data = body.model_dump(exclude_unset=True)
    _normalize_recurrence(data)
    _validate_links(db, data.get("client_id", t.client_id), data.get("sub_client_id", t.sub_client_id), data.get("project_id", t.project_id), data.get("assignee_va_id", t.assignee_va_id))
    old_status = t.status
    old_assignee = t.assignee_va_id
    for k, v in data.items():
        setattr(t, k, v)
    if t.due_date and t.start_date and t.due_date < t.start_date:
        raise HTTPException(400, "Deadline cannot be before start date")
    if t.recurrence_until and t.due_date and t.recurrence_until < t.due_date:
        raise HTTPException(400, "Repeat until cannot be before the deadline")
    if t.recurrence and t.recurrence != TaskRecurrence.none and not t.series_id:
        t.series_id = t.id
    just_completed = t.status == TaskStatus.done and old_status != TaskStatus.done
    spawned = None
    if just_completed:
        t.completed_at = datetime.now(timezone.utc)
        spawned = _spawn_and_notify(db, t)
    if t.status != TaskStatus.done:
        t.completed_at = None
    db.commit()
    db.refresh(t)
    t = _base_query(db).filter(Task.id == t.id).first()
    actor = current.user.display_name or current.user.email
    if spawned and just_completed:
        # Surface a friendly update so the VA knows the next cycle is on the board
        try:
            notify_task_updated(
                db, t,
                f"Marked done — next repeat is due {spawned.due_date}",
                actor,
            )
        except Exception:
            pass
    if t.assignee_va_id and t.assignee_va_id != old_assignee:
        first_in_project = False
        if t.project_id:
            first_in_project = db.query(Task).filter(Task.project_id == t.project_id, Task.assignee_va_id == t.assignee_va_id).count() <= 1
        notify_task_assigned(db, t, first_in_project=first_in_project)
    elif t.assignee_va_id and (t.status != old_status or "priority" in data or "due_date" in data):
        changes = []
        if t.status != old_status:
            changes.append(f"Status moved to {t.status.value.replace('_', ' ')}")
        if "priority" in data:
            changes.append(f"Priority set to {t.priority.value}")
        if "due_date" in data:
            changes.append(f"Deadline set to {t.due_date or 'none'}")
        notify_task_updated(db, t, "; ".join(changes) or "Task details updated", actor)
    return _serialize(db, t)


@router.post("/{task_id}/move", response_model=TaskResponse)
def move_task(task_id: UUID, body: TaskUpdate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """Kanban drag-drop: change status/position."""
    return update_task(task_id, body, current, db)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: UUID, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    db.delete(t); db.commit()


def _get_visible_task(db: Session, current: CurrentUser, task_id: UUID) -> Task:
    t = _visible(db.query(Task), current).filter(Task.id == task_id).first()
    if not t and current.role in (UserRole.admin, UserRole.auditor):
        t = db.query(Task).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    return t


@router.get("/{task_id}/comments", response_model=list[TaskCommentResponse])
def list_comments(task_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)],
                  sort: str = Query("newest", pattern="^(newest|oldest|most_reacted)$")):
    _get_visible_task(db, current, task_id)
    rows = db.query(TaskComment).filter(TaskComment.task_id == task_id).all()
    items = [comment_svc.serialize_comment(db, c, "task", current.user.id) for c in rows]
    return comment_svc.sort_comments(items, sort)


@router.post("/{task_id}/comments", response_model=TaskCommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(task_id: UUID, body: TaskCommentCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    # Admin, Auditor and Users (VAs) can all comment on a task they can view.
    _get_visible_task(db, current, task_id)
    if body.parent_id and not db.query(TaskComment).filter(TaskComment.id == body.parent_id, TaskComment.task_id == task_id).first():
        raise HTTPException(400, "Parent comment not found on this task")
    name = comment_svc.display_name(db, current)
    mentions = [m.model_dump(mode="json") for m in body.mentions]
    c = TaskComment(task_id=task_id, author_user_id=current.user.id, author_name=name,
                    author_role=current.role.value, body=body.body.strip(), parent_id=body.parent_id, mentions=mentions)
    db.add(c); db.commit(); db.refresh(c)
    if body.attachment_ids:
        db.query(CommentAttachment).filter(CommentAttachment.id.in_(body.attachment_ids), CommentAttachment.scope == "task",
                                           CommentAttachment.scope_id == task_id, CommentAttachment.uploaded_by == current.user.id
                                           ).update({CommentAttachment.comment_id: c.id}, synchronize_session=False)
        db.commit()
    task_full = _base_query(db).filter(Task.id == task_id).first()
    if task_full:
        notify_task_comment(db, task_full, c.body, name, author_is_assignee=bool(current.va_id and task_full.assignee_va_id == current.va_id))
    from app.services.notifications import task_deep_link
    comment_svc.notify_mentions(
        db, mentions, scope_label="a task", title=task_full.title if task_full else "Task",
        body=f"{name}: {c.body}", link=task_deep_link(task_id, c.id), exclude_user_id=current.user.id,
    )
    return comment_svc.serialize_comment(db, c, "task", current.user.id)


@router.patch("/{task_id}/comments/{comment_id}", response_model=TaskCommentResponse)
def edit_comment(task_id: UUID, comment_id: UUID, body: TaskCommentUpdate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(TaskComment).filter(TaskComment.id == comment_id, TaskComment.task_id == task_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    if c.author_user_id != current.user.id: raise HTTPException(403, "You can only edit your own comments")
    from datetime import datetime, timezone
    c.body = body.body.strip(); c.mentions = [m.model_dump(mode="json") for m in body.mentions]; c.edited_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(c)
    return comment_svc.serialize_comment(db, c, "task", current.user.id)


@router.post("/{task_id}/comments/{comment_id}/pin", response_model=TaskCommentResponse)
def pin_comment(task_id: UUID, comment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(TaskComment).filter(TaskComment.id == comment_id, TaskComment.task_id == task_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    c.is_pinned = not c.is_pinned; db.commit(); db.refresh(c)
    return comment_svc.serialize_comment(db, c, "task", current.user.id)


@router.post("/{task_id}/comments/{comment_id}/reactions", response_model=TaskCommentResponse)
def toggle_reaction(task_id: UUID, comment_id: UUID, body: ReactionToggle, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    if body.emoji not in comment_svc.ALLOWED_EMOJI: raise HTTPException(400, "Emoji not allowed")
    c = db.query(TaskComment).filter(TaskComment.id == comment_id, TaskComment.task_id == task_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    existing = db.query(CommentReaction).filter(CommentReaction.scope == "task", CommentReaction.comment_id == comment_id,
                                                CommentReaction.user_id == current.user.id, CommentReaction.emoji == body.emoji).first()
    if existing: db.delete(existing)
    else: db.add(CommentReaction(scope="task", comment_id=comment_id, user_id=current.user.id, user_name=comment_svc.display_name(db, current), emoji=body.emoji))
    db.commit()
    if not existing:
        task = db.query(Task).filter(Task.id == task_id).first()
        from app.services.notifications import task_deep_link
        comment_svc.notify_reaction(
            db, scope="task", comment=c, emoji=body.emoji,
            reactor_name=comment_svc.display_name(db, current),
            scope_title=task.title if task else "Task",
            link=task_deep_link(task_id, comment_id),
            exclude_user_id=current.user.id,
        )
    db.refresh(c)
    return comment_svc.serialize_comment(db, c, "task", current.user.id)


@router.get("/{task_id}/attachments")
def list_task_attachments(task_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """All images attached anywhere on this task (details + comments)."""
    _get_visible_task(db, current, task_id)
    rows = db.query(CommentAttachment).filter(CommentAttachment.scope == "task", CommentAttachment.scope_id == task_id).order_by(CommentAttachment.created_at.desc()).all()
    return [comment_svc.serialize_attachment(a) for a in rows]


@router.post("/{task_id}/attachments/link", status_code=status.HTTP_201_CREATED)
def add_task_link_attachment(task_id: UUID, body: LinkAttachmentCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """Drop a Google Drive / Dropbox link onto the task details."""
    _get_visible_task(db, current, task_id)
    a = comment_svc.create_link_attachment(db, scope="task", scope_id=task_id, current=current, url=body.url)
    return comment_svc.serialize_attachment(a)


@router.post("/{task_id}/comments/attachments", status_code=status.HTTP_201_CREATED)
async def upload_comment_attachment(task_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)],
                                    file: UploadFile = File(...), is_annotation: bool = False, annotated_from_id: UUID | None = None, comment_id: UUID | None = None):
    """Upload an image for a task comment — AVIF-optimized by the api and stored in the bucket."""
    _get_visible_task(db, current, task_id)
    a = await comment_svc.store_attachment(db, scope="task", scope_id=task_id, current=current, file=file, comment_id=comment_id,
                                           is_annotation=is_annotation, annotated_from_id=annotated_from_id)
    return comment_svc.serialize_attachment(a)


@router.delete("/{task_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(task_id: UUID, comment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(TaskComment).filter(TaskComment.id == comment_id, TaskComment.task_id == task_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    if current.role != UserRole.admin and c.author_user_id != current.user.id:
        raise HTTPException(403, "You can only delete your own comments")
    for a in db.query(CommentAttachment).filter(CommentAttachment.scope == "task", CommentAttachment.comment_id == comment_id).all():
        from app.services import storage as _storage
        _storage.delete(a.storage_key); db.delete(a)
    db.query(CommentReaction).filter(CommentReaction.scope == "task", CommentReaction.comment_id == comment_id).delete()
    db.delete(c); db.commit()
