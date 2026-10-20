from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import Client, Project, SubClient, Task, TaskComment, TaskPriority, TaskStatus, UserRole, VA, WorkLog
from app.schemas import TaskCommentCreate, TaskCommentResponse, TaskCreate, TaskResponse, TaskUpdate
from app.services.notifications import notify_task_assigned, notify_task_comment, notify_task_updated

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _serialize(db: Session, t: Task) -> TaskResponse:
    logged = db.query(func.coalesce(func.sum(WorkLog.hours), 0)).filter(WorkLog.task_id == t.id).scalar() or Decimal("0")
    return TaskResponse(
        id=t.id, title=t.title, description=t.description, client_id=t.client_id,
        client_name=t.client.name if t.client else None, sub_client_id=t.sub_client_id,
        sub_client_name=t.sub_client.name if t.sub_client else None, project_id=t.project_id,
        project_name=t.project.name if t.project else None, project_color=t.project.color if t.project else None,
        assignee_va_id=t.assignee_va_id, assignee_name=t.assignee.name if t.assignee else None,
        status=t.status, priority=t.priority, start_date=t.start_date, due_date=t.due_date,
        estimated_hours=t.estimated_hours, logged_hours=Decimal(str(logged)), position=t.position or 0,
        tags=t.tags or [], checklist=t.checklist or [], completed_at=t.completed_at,
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


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None, project_id: UUID | None = None, assignee_va_id: UUID | None = None,
    status_filter: TaskStatus | None = Query(None, alias="status"), priority: TaskPriority | None = None,
    search: str | None = None, due_from: date | None = None, due_to: date | None = None, overdue: bool = False,
    mine: bool = False,
):
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
        raise HTTPException(400, "Due date cannot be before start date")
    assignee = body.assignee_va_id
    if current.role == UserRole.va:
        assignee = assignee or current.va_id
        if assignee != current.va_id:
            raise HTTPException(403, "VAs can only assign tasks to themselves")
    max_pos = db.query(func.coalesce(func.max(Task.position), 0)).filter(Task.status == body.status).scalar() or 0
    t = Task(**body.model_dump(exclude={"assignee_va_id"}), assignee_va_id=assignee, created_by=current.user.id, position=int(max_pos) + 1)
    if t.status == TaskStatus.done: t.completed_at = datetime.now(timezone.utc)
    db.add(t); db.commit(); db.refresh(t)
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
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    if current.role == UserRole.va and t.assignee_va_id != current.va_id and t.created_by != current.user.id:
        raise HTTPException(403, "You can only update your own tasks")
    if current.role == UserRole.va and body.assignee_va_id and body.assignee_va_id != current.va_id:
        raise HTTPException(403, "VAs cannot reassign tasks")
    data = body.model_dump(exclude_unset=True)
    _validate_links(db, data.get("client_id", t.client_id), data.get("sub_client_id", t.sub_client_id), data.get("project_id", t.project_id), data.get("assignee_va_id", t.assignee_va_id))
    old_status = t.status
    old_assignee = t.assignee_va_id
    for k, v in data.items(): setattr(t, k, v)
    if t.due_date and t.start_date and t.due_date < t.start_date:
        raise HTTPException(400, "Due date cannot be before start date")
    if t.status == TaskStatus.done and old_status != TaskStatus.done: t.completed_at = datetime.now(timezone.utc)
    if t.status != TaskStatus.done: t.completed_at = None
    db.commit(); db.refresh(t)
    t = _base_query(db).filter(Task.id == t.id).first()
    actor = current.user.display_name or current.user.email
    if t.assignee_va_id and t.assignee_va_id != old_assignee:
        first_in_project = False
        if t.project_id:
            first_in_project = db.query(Task).filter(Task.project_id == t.project_id, Task.assignee_va_id == t.assignee_va_id).count() <= 1
        notify_task_assigned(db, t, first_in_project=first_in_project)
    elif t.assignee_va_id and (t.status != old_status or "priority" in data or "due_date" in data):
        changes = []
        if t.status != old_status: changes.append(f"Status moved to {t.status.value.replace('_', ' ')}")
        if "priority" in data: changes.append(f"Priority set to {t.priority.value}")
        if "due_date" in data: changes.append(f"Due date set to {t.due_date or 'none'}")
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


@router.get("/{task_id}/comments", response_model=list[TaskCommentResponse])
def list_comments(task_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    t = _visible(db.query(Task), current).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    return db.query(TaskComment).filter(TaskComment.task_id == task_id).order_by(TaskComment.created_at.asc()).all()


@router.post("/{task_id}/comments", response_model=TaskCommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(task_id: UUID, body: TaskCommentCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    t = _visible(db.query(Task), current).filter(Task.id == task_id).first()
    if not t and current.role == UserRole.admin:
        t = db.query(Task).filter(Task.id == task_id).first()
    if not t: raise HTTPException(404, "Task not found")
    name = current.user.display_name or current.user.email.split("@")[0]
    if current.va_id:
        va = db.query(VA).filter(VA.id == current.va_id).first()
        if va: name = va.name
    c = TaskComment(task_id=task_id, author_user_id=current.user.id, author_name=name, body=body.body.strip())
    db.add(c); db.commit(); db.refresh(c)
    task_full = _base_query(db).filter(Task.id == task_id).first()
    if task_full:
        notify_task_comment(db, task_full, c.body, name, author_is_assignee=bool(current.va_id and task_full.assignee_va_id == current.va_id))
    return c


@router.delete("/{task_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(task_id: UUID, comment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(TaskComment).filter(TaskComment.id == comment_id, TaskComment.task_id == task_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    if current.role != UserRole.admin and c.author_user_id != current.user.id:
        raise HTTPException(403, "You can only delete your own comments")
    db.delete(c); db.commit()
