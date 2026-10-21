"""Team directory, bucket storage status, and comment-attachment file serving."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, get_current_user
from app.models import CommentAttachment, Task, User, UserRole, VA
from app.schemas import TeamMemberResponse
from app.services import storage
from app.services.images import AVIF_QUALITY, MAX_EDGE, MAX_UPLOAD_BYTES

router = APIRouter(tags=["collaboration"])

MEDIA = {"avif": "image/avif", "webp": "image/webp"}


@router.get("/team", response_model=list[TeamMemberResponse])
def team_directory(current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """Everyone who can be @mentioned / invited: Admin, Auditors and Users (VAs)."""
    users = db.query(User).filter(User.is_active.is_(True)).order_by(User.role, User.display_name).all()
    vas = {v.user_id: v for v in db.query(VA).all()}
    out = []
    for u in users:
        va = vas.get(u.id)
        out.append(TeamMemberResponse(user_id=u.id, name=(va.name if va else (u.display_name or u.email.split("@")[0])),
                                      role=u.role.value, va_id=va.id if va else None))
    return sorted(out, key=lambda m: ({"admin": 0, "auditor": 1, "va": 2}.get(m.role, 3), m.name.lower()))


@router.get("/storage/status")
def storage_status(current: Annotated[CurrentUser, Depends(get_current_user)]):
    """Lets the UI prove uploads land in the bucket connected to the api service."""
    enabled = storage.bucket_enabled()
    return {
        "bucket_enabled": enabled,
        "backend": "bucket" if enabled else "local",
        "note": "Attachments are optimized to AVIF by the api and saved via its S3 bucket connection (Railway bucket `teams-shc-uploads` in production; local disk fallback in dev)." if enabled
                else "No bucket credentials on this api instance — attachments fall back to local disk. Set S3_*/AWS_* bucket variables on the api service to store them in the bucket.",
        "image_policy": {"accepted": ["JPG", "PNG", "WebP", "AVIF", "GIF"], "max_original_mb": MAX_UPLOAD_BYTES // 1024 // 1024,
                         "max_edge_px": MAX_EDGE, "stored_format": "AVIF", "avif_quality": AVIF_QUALITY},
    }


@router.get("/comments/attachments/{attachment_id}/content")
def attachment_content(attachment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    a = db.query(CommentAttachment).filter(CommentAttachment.id == attachment_id).first()
    if not a:
        raise HTTPException(404, "Attachment not found")
    if a.scope == "task" and current.role == UserRole.va:
        t = db.query(Task).filter(Task.id == a.scope_id).first()
        if not t or (t.assignee_va_id != current.va_id and t.created_by != current.user.id):
            raise HTTPException(404, "Attachment not found")
    if a.link_url:
        raise HTTPException(400, "This is a link attachment — open its link_url instead")
    data = storage.read_bytes(a.storage_key)
    if data is None:
        raise HTTPException(404, "File missing from storage")
    return Response(content=data, media_type=MEDIA.get(a.format, "image/avif"),
                    headers={"Cache-Control": "private, max-age=3600", "Content-Disposition": f'inline; filename="{a.original_name}"'})


@router.delete("/comments/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(attachment_id: UUID, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    a = db.query(CommentAttachment).filter(CommentAttachment.id == attachment_id).first()
    if not a:
        raise HTTPException(404, "Attachment not found")
    if current.role != UserRole.admin and a.uploaded_by != current.user.id:
        raise HTTPException(403, "You can only delete your own attachments")
    if a.storage_key:
        storage.delete(a.storage_key)
    db.delete(a)
    db.commit()
