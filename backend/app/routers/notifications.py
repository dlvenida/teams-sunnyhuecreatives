from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, get_current_user
from app.models import Notification
from app.schemas import NotificationListResponse, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _serialize(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id, type=n.type, title=n.title, body=n.body, link=n.link,
        is_read=bool(n.is_read), created_at=n.created_at,
    )


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    type: str | None = None,
    unread_only: bool = False,
):
    # Retention: notification history keeps only the last 3 months
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    db.query(Notification).filter(Notification.user_id == current.user.id, Notification.created_at < cutoff).delete()
    db.commit()
    total = db.query(Notification).filter(Notification.user_id == current.user.id).count()
    if total == 0:
        # First run: a welcome so the bell never starts empty
        db.add(Notification(
            user_id=current.user.id, type="system",
            title="👋 Welcome to Teams.SHC notifications",
            body="New comments, task assignments, updates, approvals and clock activity will land here. Click one to jump straight to it.",
            link="/va/tasks" if current.role.value == "va" else "/admin/dashboard",
        ))
        db.commit()
    query = db.query(Notification).filter(Notification.user_id == current.user.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((Notification.title.ilike(like)) | (Notification.body.ilike(like)))
    if type:
        query = query.filter(Notification.type == type)
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))
    items = (
        query
        .order_by(Notification.created_at.desc())
        .offset(max(offset, 0))
        .limit(min(max(limit, 1), 200))
        .all()
    )
    unread = db.query(Notification).filter(Notification.user_id == current.user.id, Notification.is_read.is_(False)).count()
    return NotificationListResponse(items=[_serialize(n) for n in items], unread=unread, total=total or len(items))


@router.post("/read-all")
def mark_all_read(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == current.user.id, Notification.is_read.is_(False))
        .update({"is_read": True})
    )
    db.commit()
    return {"marked_read": updated}


@router.delete("")
def delete_all_notifications(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Empty the whole notification history for this user."""
    deleted = db.query(Notification).filter(Notification.user_id == current.user.id).delete()
    db.commit()
    return {"deleted": deleted}


@router.delete("/clear-read")
def clear_read(
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    deleted = (
        db.query(Notification)
        .filter(Notification.user_id == current.user.id, Notification.is_read.is_(True))
        .delete()
    )
    db.commit()
    return {"deleted": deleted}


class BulkIds(BaseModel):
    ids: list[UUID]


@router.post("/bulk-read")
def bulk_mark_read(
    body: BulkIds,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == current.user.id, Notification.id.in_(body.ids))
        .update({"is_read": True}, synchronize_session=False)
    )
    db.commit()
    return {"marked_read": updated}


@router.post("/bulk-delete")
def bulk_delete(
    body: BulkIds,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    deleted = (
        db.query(Notification)
        .filter(Notification.user_id == current.user.id, Notification.id.in_(body.ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@router.post("/{notification_id}/unread", response_model=NotificationResponse)
def mark_unread(
    notification_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current.user.id).first()
    if not n:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    n.is_read = False
    db.commit()
    db.refresh(n)
    return _serialize(n)


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_read(
    notification_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current.user.id).first()
    if not n:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    n.is_read = True
    db.commit()
    db.refresh(n)
    return _serialize(n)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: UUID,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current.user.id).first()
    if not n:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.delete(n)
    db.commit()
