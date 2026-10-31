"""Shared serialization + bucket storage for task & project comments."""
import html as _html
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
    if a.link_url:
        kind = "link"
    elif a.width or (a.format or "").lower() in ("avif", "webp", "jpg", "jpeg", "png", "gif"):
        kind = "image"
    else:
        kind = "file"
    return {
        "id": a.id, "comment_id": a.comment_id, "original_name": a.original_name,
        "link_url": a.link_url, "provider": a.provider, "kind": kind,
        "size_bytes": a.size_bytes, "original_size": a.original_size,
        "width": a.width, "height": a.height, "original_width": a.original_width, "original_height": a.original_height,
        "format": a.format, "storage_backend": a.storage_backend, "is_annotation": bool(a.is_annotation),
        "annotated_from_id": a.annotated_from_id, "created_at": a.created_at,
        "url": f"/comments/attachments/{a.id}/content",
    }


MAX_COMMENT_ATTACHMENT_BYTES = 25 * 1024 * 1024


async def store_attachment(db: Session, *, scope: str, scope_id, current, file: UploadFile,
                           comment_id=None, is_annotation: bool = False, annotated_from_id=None) -> CommentAttachment:
    """Store a comment attachment. Images are AVIF-optimized; any other file is stored as-is."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    if len(raw) > MAX_COMMENT_ATTACHMENT_BYTES:
        raise HTTPException(400, f"File is too large — keep attachments under {MAX_COMMENT_ATTACHMENT_BYTES // (1024 * 1024)} MB")

    filename = (file.filename or "attachment")[:255]
    ctype = (file.content_type or "application/octet-stream").lower()
    att_id = uuid.uuid4()
    is_image = ctype in ALLOWED_CONTENT_TYPES or ctype.startswith("image/")

    if is_image and not is_annotation:
        try:
            opt = optimize_image(raw)
            data, ext = opt["data"], opt["format"]
            width, height = opt["width"], opt["height"]
            ow, oh = opt["original_width"], opt["original_height"]
            stored_ctype = opt["content_type"]
        except ValueError:
            data, ext = raw, (filename.rsplit(".", 1)[-1] if "." in filename else "bin")[:12]
            width = height = ow = oh = None
            stored_ctype = ctype
    elif is_image:
        # Annotations are often PNG from the canvas — still try optimize, fall back to raw
        try:
            opt = optimize_image(raw)
            data, ext = opt["data"], opt["format"]
            width, height = opt["width"], opt["height"]
            ow, oh = opt["original_width"], opt["original_height"]
            stored_ctype = opt["content_type"]
        except ValueError as e:
            raise HTTPException(400, str(e))
    else:
        data = raw
        ext = (filename.rsplit(".", 1)[-1] if "." in filename else "bin")[:12]
        width = height = ow = oh = None
        stored_ctype = ctype

    key = f"{scope}-comments/{scope_id}/{att_id}.{ext}"
    # Bucket first: storage.save_bytes writes to the S3-compatible Railway bucket
    # whenever S3_*/AWS_* bucket credentials are configured on the api service,
    # and only falls back to local disk in dev. We record which backend was used.
    ref = storage.save_bytes(key, data, stored_ctype)
    a = CommentAttachment(
        id=att_id, scope=scope, scope_id=scope_id, comment_id=comment_id,
        uploaded_by=current.user.id, uploader_name=display_name(db, current),
        storage_key=key, storage_backend="bucket" if ref.startswith("s3://") else "local",
        original_name=filename, original_size=len(raw), size_bytes=len(data),
        width=width, height=height, original_width=ow, original_height=oh,
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


def _audience_ids(user_ids) -> list:
    ids: list = []
    for uid in user_ids:
        if uid and uid not in ids:
            ids.append(uid)
    return ids


def notify_reaction(db: Session, *, scope: str, comment, emoji: str, reactor_name: str,
                    scope_title: str, link: str, exclude_user_id) -> None:
    """When someone adds an emoji reaction, notify everyone involved:
    the comment author, the parent-comment author (for replies), everyone who
    commented on the task/project, the task assignee and creator — i.e. all
    users involved in the project, its comments and the task."""
    from app.models import ProjectComment, Task, TaskComment, User
    from app.services.email import branded_email, email_cta_url, send_email
    from app.services.notifications import push, va_user_id

    recipient_ids: list = [comment.author_user_id]

    if scope == "task":
        rows = db.query(TaskComment).filter(TaskComment.task_id == comment.task_id).all()
        recipient_ids += [r.author_user_id for r in rows]
        if comment.parent_id:
            parent = next((r for r in rows if r.id == comment.parent_id), None)
            if parent:
                recipient_ids.append(parent.author_user_id)
        task = db.query(Task).filter(Task.id == comment.task_id).first()
        if task:
            recipient_ids.append(va_user_id(db, task.assignee_va_id))
            recipient_ids.append(task.created_by)
    else:  # project
        rows = db.query(ProjectComment).filter(ProjectComment.project_id == comment.project_id).all()
        recipient_ids += [r.author_user_id for r in rows]
        if comment.parent_id:
            parent = next((r for r in rows if r.id == comment.parent_id), None)
            if parent:
                recipient_ids.append(parent.author_user_id)
        project_tasks = db.query(Task).filter(Task.project_id == comment.project_id).all()
        for t in project_tasks:
            recipient_ids.append(va_user_id(db, t.assignee_va_id))
            recipient_ids.append(t.created_by)

    excerpt = (comment.body or "").strip().replace("\n", " ")
    if len(excerpt) > 140:
        excerpt = excerpt[:140] + "…"
    push(
        db, _audience_ids(recipient_ids), "comment",
        f"{emoji} {reactor_name} reacted on: {scope_title}",
        f"Reacted {emoji} to: “{excerpt}”" if excerpt else f"Reacted {emoji} to a comment",
        link, exclude_user_id=exclude_user_id,
    )

    # Cute branded email for the comment author (not the reactor)
    author_id = comment.author_user_id
    if author_id and author_id != exclude_user_id:
        user = db.query(User).filter(User.id == author_id, User.is_active.is_(True)).first()
        if user and user.email:
            first = (user.display_name or user.email.split("@")[0]).split(" ")[0]
            html = branded_email(
                f"Hey {first}! Someone reacted {emoji}",
                f"{reactor_name} reacted on {scope_title}",
                (
                    f"<p>Hey <strong>{first}</strong>! 💕</p>"
                    f"<p><strong>{reactor_name}</strong> left a {emoji} on your comment in "
                    f"<em>{scope_title}</em>.</p>"
                    f"<p style='background:#fff7fa;border-radius:12px;padding:12px 14px;border-left:3px solid #ec4899;'>"
                    f"{excerpt or 'Your comment'}</p>"
                    f"<p>Keep the love going — open the task to reply!</p>"
                ),
                "Open the task ✨",
                email_cta_url(user.role, link),
            )
            send_email(user.email, f"{emoji} {reactor_name} reacted on your comment", html, template_key="reaction")


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
    """Email each @mention. Task links must already include task id and comment id."""
    from app.models import User
    from app.services.email import branded_email, email_cta_url, render_template, send_email
    from app.services.notifications import push, wants_email

    ids = []
    for m in mentions or []:
        try:
            ids.append(uuid.UUID(str(m.get("user_id"))))
        except Exception:
            continue
    push(
        db,
        ids,
        "comment",
        f"🔔 You were mentioned in {scope_label}: {title}",
        body[:200],
        link,
        exclude_user_id=exclude_user_id,
    )

    excerpt = (body or "")[:280]
    safe_excerpt = _html.escape(excerpt)
    safe_title = _html.escape(title)
    for uid in ids:
        if exclude_user_id and uid == exclude_user_id:
            continue
        user = db.query(User).filter(User.id == uid, User.is_active.is_(True)).first()
        if not user or not wants_email(user, "mention"):
            continue
        # Role-specific absolute URL. Callers pass /tasks?task={id}&comment={id} for task mentions.
        url = email_cta_url(user.role, link)
        first = (user.display_name or user.email.split("@")[0]).split(" ")[0]
        rendered = render_template(db, "mention", {"name": first, "task_title": title, "comment": excerpt}, url)
        if rendered:
            send_email(user.email, rendered[0], rendered[1], template_key="mention")
            continue
        safe_first = _html.escape(first)
        html = branded_email(
            f"Hey {first}, someone tagged you! 💕",
            f"You were mentioned in {title}",
            (
                f"<p>Hey <strong>{safe_first}</strong>! 🌸</p>"
                f"<p>Someone tagged you in <strong>{safe_title}</strong>.</p>"
                f"<p style='background:#fff7fa;border-radius:12px;padding:12px 14px;border-left:3px solid #ec4899;'>"
                f"{safe_excerpt}</p>"
            ),
            "Open the task ✨",
            url,
        )
        send_email(
            user.email,
            f"💕 Hey {first}, someone tagged you in a task!",
            html,
            template_key="mention",
        )
