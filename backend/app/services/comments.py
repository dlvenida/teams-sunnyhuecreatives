"""Shared serialization + bucket storage for task & project comments."""
import uuid
from collections import Counter, defaultdict

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models import CommentAttachment, CommentReaction
from app.services import storage
from app.services.images import ALLOWED_CONTENT_TYPES, optimize_image

ALLOWED_EMOJI = ["👍", "❤️", "🎉", "👀", "✅", "🔥", "🙏", "💯"]


def display_name(db: Session, current) -> str:
    from app.models import VA
    name = current.user.display_name or current.user.email.split("@")[0]
    if current.va_id:
        va = db.query(VA).filter(VA.id == current.va_id).first()
        if va:
            name = va.name
    return name


def serialize_comment(db: Session, c, scope: str, me_id) -> dict:
    reactions = db.query(CommentReaction).filter(CommentReaction.scope == scope, CommentReaction.comment_id == c.id).all()
    grouped: dict[str, list] = defaultdict(list)
    for r in reactions:
        grouped[r.emoji].append(r)
    attachments = (
        db.query(CommentAttachment)
        .filter(CommentAttachment.scope == scope, CommentAttachment.comment_id == c.id)
        .order_by(CommentAttachment.created_at.asc()).all()
    )
    return {
        "id": c.id, "task_id": getattr(c, "task_id", None), "project_id": getattr(c, "project_id", None),
        "author_user_id": c.author_user_id, "author_name": c.author_name, "author_role": c.author_role or "va",
        "body": c.body, "parent_id": c.parent_id, "mentions": c.mentions or [],
        "is_pinned": bool(c.is_pinned), "edited_at": c.edited_at, "created_at": c.created_at,
        "reactions": [
            {"emoji": e, "count": len(rs), "users": [r.user_name for r in rs], "reacted_by_me": any(r.user_id == me_id for r in rs)}
            for e, rs in sorted(grouped.items(), key=lambda kv: -len(kv[1]))
        ],
        "attachments": [serialize_attachment(a) for a in attachments],
    }


def serialize_attachment(a: CommentAttachment) -> dict:
    return {
        "id": a.id, "comment_id": a.comment_id, "original_name": a.original_name,
        "link_url": a.link_url, "provider": a.provider, "kind": "link" if a.link_url else "image",
        "size_bytes": a.size_bytes, "original_size": a.original_size,
        "width": a.width, "height": a.height, "original_width": a.original_width, "original_height": a.original_height,
        "format": a.format, "storage_backend": a.storage_backend, "is_annotation": bool(a.is_annotation),
        "annotated_from_id": a.annotated_from_id, "created_at": a.created_at,
        "url": f"/comments/attachments/{a.id}/content",
    }


async def store_attachment(db: Session, *, scope: str, scope_id, current, file: UploadFile,
                           comment_id=None, is_annotation: bool = False, annotated_from_id=None) -> CommentAttachment:
    """Optimize an uploaded image to AVIF and put it in the bucket (services.storage)."""
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, "Only image files are supported (JPG, PNG, WebP, AVIF, GIF).")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        opt = optimize_image(raw)
    except ValueError as e:
        raise HTTPException(400, str(e))
    att_id = uuid.uuid4()
    ext = opt["format"]
    key = f"{scope}-comments/{scope_id}/{att_id}.{ext}"
    # Bucket first: storage.save_bytes writes to the S3-compatible Railway bucket
    # whenever S3_*/AWS_* bucket credentials are configured on the api service,
    # and only falls back to local disk in dev. We record which backend was used.
    ref = storage.save_bytes(key, opt["data"], opt["content_type"])
    a = CommentAttachment(
        id=att_id, scope=scope, scope_id=scope_id, comment_id=comment_id,
        uploaded_by=current.user.id, uploader_name=display_name(db, current),
        storage_key=key, storage_backend="bucket" if ref.startswith("s3://") else "local",
        original_name=(file.filename or "image")[:255], original_size=len(raw), size_bytes=len(opt["data"]),
        width=opt["width"], height=opt["height"], original_width=opt["original_width"], original_height=opt["original_height"],
        format=ext, is_annotation=is_annotation, annotated_from_id=annotated_from_id,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def create_link_attachment(db: Session, *, scope: str, scope_id, current, url: str) -> CommentAttachment:
    """Attach a Google Drive / Dropbox share link (no file is copied — the link itself is the attachment)."""
    import re
    from urllib.parse import urlparse
    u = (url or "").strip()
    parsed = urlparse(u)
    if parsed.scheme != "https":
        raise HTTPException(400, "Link must start with https://")
    host = (parsed.hostname or "").lower()
    if host in ("drive.google.com", "docs.google.com"):
        provider = "google_drive"
        m = re.search(r"/file/d/([\w-]+)", u) or re.search(r"[?&]id=([\w-]+)", u)
        open_url = f"https://drive.google.com/file/d/{m.group(1)}/view" if m else u
        name = "Google Drive file"
    elif host in ("www.dropbox.com", "dropbox.com", "dl.dropboxusercontent.com"):
        provider = "dropbox"
        # dl=1 makes Dropbox serve the file directly instead of its preview page
        open_url = re.sub(r"([?&])dl=\d", r"\1dl=1", u) if "dl=" in u else (u + ("&dl=1" if "?" in u else "?dl=1"))
        name = "Dropbox file"
    else:
        raise HTTPException(400, "Only Google Drive or Dropbox links are supported here.")
    a = CommentAttachment(
        scope=scope, scope_id=scope_id, uploaded_by=current.user.id, uploader_name=display_name(db, current),
        storage_key="", storage_backend="link", link_url=open_url, provider=provider,
        original_name=name, original_size=0, size_bytes=0, format="link",
    )
    db.add(a); db.commit(); db.refresh(a)
    return a


def sort_comments(items: list[dict], sort: str) -> list[dict]:
    pinned = [i for i in items if i["is_pinned"]]
    rest = [i for i in items if not i["is_pinned"]]
    if sort == "oldest":
        key = lambda i: i["created_at"]  # noqa: E731
        rest.sort(key=key); pinned.sort(key=key)
    elif sort == "most_reacted":
        rest.sort(key=lambda i: (-sum(r["count"] for r in i["reactions"]), i["created_at"]))
        pinned.sort(key=lambda i: (-sum(r["count"] for r in i["reactions"]), i["created_at"]))
    else:  # newest (default, Asana-style activity feed)
        rest.sort(key=lambda i: i["created_at"], reverse=True)
        pinned.sort(key=lambda i: i["created_at"], reverse=True)
    return pinned + rest


def notify_mentions(db: Session, mentions, *, scope_label: str, title: str, body: str, link: str, exclude_user_id) -> None:
    from app.services.notifications import push
    ids = []
    for m in mentions or []:
        try:
            ids.append(uuid.UUID(str(m.get("user_id"))))
        except Exception:
            continue
    push(db, ids, "comment", f"🔔 You were mentioned in {scope_label}: {title}", body[:200], link, exclude_user_id=exclude_user_id)
