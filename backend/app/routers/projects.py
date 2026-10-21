from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import Client, CommentAttachment, CommentReaction, Project, ProjectComment, ProjectMeetup, ProjectStatus, SubClient, Task, TaskStatus, UserRole, WorkLog
from app.schemas import LinkAttachmentCreate, MeetupCreate, MeetupResponse, MeetupUpdate, ProjectCommentCreate, ProjectCreate, ProjectResponse, ProjectUpdate, ReactionToggle, TaskCommentResponse, TaskCommentUpdate
from app.services import comments as comment_svc

router = APIRouter(prefix="/projects", tags=["projects"])


def _serialize(db: Session, p: Project) -> ProjectResponse:
    total = db.query(func.count(Task.id)).filter(Task.project_id == p.id).scalar() or 0
    done = db.query(func.count(Task.id)).filter(Task.project_id == p.id, Task.status == TaskStatus.done).scalar() or 0
    prog = db.query(func.count(Task.id)).filter(Task.project_id == p.id, Task.status == TaskStatus.in_progress).scalar() or 0
    hours = db.query(func.coalesce(func.sum(WorkLog.hours), 0)).filter(WorkLog.project_id == p.id).scalar() or Decimal("0")
    return ProjectResponse(
        id=p.id, client_id=p.client_id, client_name=p.client.name if p.client else None,
        sub_client_id=p.sub_client_id, sub_client_name=p.sub_client.name if p.sub_client else None,
        name=p.name, description=p.description, color=p.color or "#ec4899", status=p.status, cadence=p.cadence,
        start_date=p.start_date, due_date=p.due_date, task_total=int(total), task_done=int(done),
        task_in_progress=int(prog), total_hours=Decimal(str(hours)), created_at=p.created_at,
    )


@router.get("", response_model=list[ProjectResponse])
def list_projects(
    _: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    status_filter: ProjectStatus | None = None,
    include_archived: bool = True,
):
    q = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client))
    if client_id:
        q = q.filter(Project.client_id == client_id)
    if status_filter:
        q = q.filter(Project.status == status_filter)
    elif not include_archived:
        q = q.filter(Project.status != ProjectStatus.archived)
    return [_serialize(db, p) for p in q.order_by(Project.created_at.desc()).all()]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, current: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    if not db.query(Client).filter(Client.id == body.client_id).first():
        raise HTTPException(404, "Client not found")
    if body.sub_client_id and not db.query(SubClient).filter(SubClient.id == body.sub_client_id, SubClient.client_id == body.client_id).first():
        raise HTTPException(400, "Sub-client does not belong to this client")
    if body.due_date and body.start_date and body.due_date < body.start_date:
        raise HTTPException(400, "Due date cannot be before start date")
    p = Project(**body.model_dump(), created_by=current.user.id)
    db.add(p); db.commit(); db.refresh(p)
    p = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client)).filter(Project.id == p.id).first()
    return _serialize(db, p)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID, _: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    p = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client)).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    return _serialize(db, p)


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: UUID, body: ProjectUpdate, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    data = body.model_dump(exclude_unset=True)
    if "client_id" in data and data["client_id"] and not db.query(Client).filter(Client.id == data["client_id"]).first():
        raise HTTPException(404, "Client not found")
    for k, v in data.items(): setattr(p, k, v)
    if p.due_date and p.start_date and p.due_date < p.start_date:
        raise HTTPException(400, "Due date cannot be before start date")
    db.commit(); db.refresh(p)
    p = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client)).filter(Project.id == p.id).first()
    return _serialize(db, p)


def _project(db: Session, project_id: UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    return p


# ── Project Discussion (same collaboration features as task comments) ──
@router.get("/{project_id}/comments", response_model=list[TaskCommentResponse])
def list_project_comments(project_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)],
                          sort: str = Query("newest", pattern="^(newest|oldest|most_reacted)$")):
    _project(db, project_id)
    rows = db.query(ProjectComment).filter(ProjectComment.project_id == project_id).all()
    return comment_svc.sort_comments([comment_svc.serialize_comment(db, c, "project", current.user.id) for c in rows], sort)


@router.post("/{project_id}/comments", response_model=TaskCommentResponse, status_code=status.HTTP_201_CREATED)
def add_project_comment(project_id: UUID, body: ProjectCommentCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    p = _project(db, project_id)
    if body.parent_id and not db.query(ProjectComment).filter(ProjectComment.id == body.parent_id, ProjectComment.project_id == project_id).first():
        raise HTTPException(400, "Parent comment not found in this discussion")
    name = comment_svc.display_name(db, current)
    mentions = [m.model_dump(mode="json") for m in body.mentions]
    c = ProjectComment(project_id=project_id, author_user_id=current.user.id, author_name=name, author_role=current.role.value,
                       body=body.body.strip(), parent_id=body.parent_id, mentions=mentions)
    db.add(c); db.commit(); db.refresh(c)
    if body.attachment_ids:
        db.query(CommentAttachment).filter(CommentAttachment.id.in_(body.attachment_ids), CommentAttachment.scope == "project",
                                           CommentAttachment.scope_id == project_id, CommentAttachment.uploaded_by == current.user.id
                                           ).update({CommentAttachment.comment_id: c.id}, synchronize_session=False)
        db.commit()
    comment_svc.notify_mentions(db, mentions, scope_label="a project discussion", title=p.name, body=f"{name}: {c.body}",
                                link="/va/projects", exclude_user_id=current.user.id)
    return comment_svc.serialize_comment(db, c, "project", current.user.id)


@router.patch("/{project_id}/comments/{comment_id}", response_model=TaskCommentResponse)
def edit_project_comment(project_id: UUID, comment_id: UUID, body: TaskCommentUpdate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(ProjectComment).filter(ProjectComment.id == comment_id, ProjectComment.project_id == project_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    if c.author_user_id != current.user.id: raise HTTPException(403, "You can only edit your own comments")
    from datetime import datetime, timezone
    c.body = body.body.strip(); c.mentions = [m.model_dump(mode="json") for m in body.mentions]; c.edited_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(c)
    return comment_svc.serialize_comment(db, c, "project", current.user.id)


@router.post("/{project_id}/comments/{comment_id}/pin", response_model=TaskCommentResponse)
def pin_project_comment(project_id: UUID, comment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(ProjectComment).filter(ProjectComment.id == comment_id, ProjectComment.project_id == project_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    c.is_pinned = not c.is_pinned; db.commit(); db.refresh(c)
    return comment_svc.serialize_comment(db, c, "project", current.user.id)


@router.post("/{project_id}/comments/{comment_id}/reactions", response_model=TaskCommentResponse)
def react_project_comment(project_id: UUID, comment_id: UUID, body: ReactionToggle, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    if body.emoji not in comment_svc.ALLOWED_EMOJI: raise HTTPException(400, "Emoji not allowed")
    c = db.query(ProjectComment).filter(ProjectComment.id == comment_id, ProjectComment.project_id == project_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    existing = db.query(CommentReaction).filter(CommentReaction.scope == "project", CommentReaction.comment_id == comment_id,
                                                CommentReaction.user_id == current.user.id, CommentReaction.emoji == body.emoji).first()
    if existing: db.delete(existing)
    else: db.add(CommentReaction(scope="project", comment_id=comment_id, user_id=current.user.id, user_name=comment_svc.display_name(db, current), emoji=body.emoji))
    db.commit(); db.refresh(c)
    return comment_svc.serialize_comment(db, c, "project", current.user.id)


@router.get("/{project_id}/attachments")
def list_project_attachments(project_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    _project(db, project_id)
    rows = db.query(CommentAttachment).filter(CommentAttachment.scope == "project", CommentAttachment.scope_id == project_id).order_by(CommentAttachment.created_at.desc()).all()
    return [comment_svc.serialize_attachment(a) for a in rows]


@router.post("/{project_id}/attachments/link", status_code=status.HTTP_201_CREATED)
def add_project_link_attachment(project_id: UUID, body: LinkAttachmentCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """Drop a Google Drive / Dropbox link onto the project details."""
    _project(db, project_id)
    a = comment_svc.create_link_attachment(db, scope="project", scope_id=project_id, current=current, url=body.url)
    return comment_svc.serialize_attachment(a)


@router.post("/{project_id}/comments/attachments", status_code=status.HTTP_201_CREATED)
async def upload_project_attachment(project_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)],
                                    file: UploadFile = File(...), is_annotation: bool = False, annotated_from_id: UUID | None = None, comment_id: UUID | None = None):
    _project(db, project_id)
    a = await comment_svc.store_attachment(db, scope="project", scope_id=project_id, current=current, file=file, comment_id=comment_id,
                                           is_annotation=is_annotation, annotated_from_id=annotated_from_id)
    return comment_svc.serialize_attachment(a)


@router.delete("/{project_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_comment(project_id: UUID, comment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    c = db.query(ProjectComment).filter(ProjectComment.id == comment_id, ProjectComment.project_id == project_id).first()
    if not c: raise HTTPException(404, "Comment not found")
    if current.role != UserRole.admin and c.author_user_id != current.user.id:
        raise HTTPException(403, "You can only delete your own comments")
    for a in db.query(CommentAttachment).filter(CommentAttachment.scope == "project", CommentAttachment.comment_id == comment_id).all():
        from app.services import storage as _storage
        _storage.delete(a.storage_key); db.delete(a)
    db.query(CommentReaction).filter(CommentReaction.scope == "project", CommentReaction.comment_id == comment_id).delete()
    db.delete(c); db.commit()


# ── Project Meet-ups ──────────────────────────────────────────────────
@router.get("/{project_id}/meetups", response_model=list[MeetupResponse])
def list_meetups(project_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    _project(db, project_id)
    return db.query(ProjectMeetup).filter(ProjectMeetup.project_id == project_id).order_by(ProjectMeetup.starts_at.asc()).all()


@router.post("/{project_id}/meetups", response_model=MeetupResponse, status_code=status.HTTP_201_CREATED)
def create_meetup(project_id: UUID, body: MeetupCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    p = _project(db, project_id)
    if body.ends_at and body.ends_at < body.starts_at: raise HTTPException(400, "End cannot be before start")
    attendees = [a.model_dump(mode="json") for a in body.attendees]
    m = ProjectMeetup(project_id=project_id, title=body.title.strip(), notes=body.notes, starts_at=body.starts_at,
                      ends_at=body.ends_at, location=body.location, attendees=attendees,
                      created_by=current.user.id, created_by_name=comment_svc.display_name(db, current))
    db.add(m); db.commit(); db.refresh(m)
    comment_svc.notify_mentions(db, attendees, scope_label="a project meet-up", title=p.name,
                                body=f"📅 {m.title} — {m.starts_at.strftime('%b %d, %Y %I:%M %p')}", link="/va/projects", exclude_user_id=current.user.id)
    return m


@router.patch("/{project_id}/meetups/{meetup_id}", response_model=MeetupResponse)
def update_meetup(project_id: UUID, meetup_id: UUID, body: MeetupUpdate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    m = db.query(ProjectMeetup).filter(ProjectMeetup.id == meetup_id, ProjectMeetup.project_id == project_id).first()
    if not m: raise HTTPException(404, "Meet-up not found")
    if current.role == UserRole.va and m.created_by != current.user.id: raise HTTPException(403, "You can only edit meet-ups you created")
    data = body.model_dump(exclude_unset=True)
    if data.get("attendees") is not None: data["attendees"] = [a.model_dump(mode="json") if not isinstance(a, dict) else a for a in body.attendees or []]
    for k, v in data.items(): setattr(m, k, v)
    if m.ends_at and m.ends_at < m.starts_at: raise HTTPException(400, "End cannot be before start")
    db.commit(); db.refresh(m)
    return m


@router.delete("/{project_id}/meetups/{meetup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meetup(project_id: UUID, meetup_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    m = db.query(ProjectMeetup).filter(ProjectMeetup.id == meetup_id, ProjectMeetup.project_id == project_id).first()
    if not m: raise HTTPException(404, "Meet-up not found")
    if current.role == UserRole.va and m.created_by != current.user.id: raise HTTPException(403, "You can only delete meet-ups you created")
    db.delete(m); db.commit()


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: UUID, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    # Tasks keep existing but lose project link via FK SET NULL? Tasks defined SET NULL, but ORM cascade on project.tasks would delete.
    # Detach tasks first.
    db.query(Task).filter(Task.project_id == project_id).update({Task.project_id: None})
    db.delete(p); db.commit()
