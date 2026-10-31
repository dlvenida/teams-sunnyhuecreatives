"""Task/project email + in-app notifications (Monday-style). Best-effort: never breaks the request."""
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Notification, Task, User, UserRole, VA
from app.services.email import branded_email, detail_rows, email_cta_url, render_template, send_email

BASE = "/va/tasks"


def task_deep_link(task_id, comment_id=None) -> str:
    """Role-neutral deep link; push() rewrites /tasks → /admin/tasks or /va/tasks per recipient."""
    link = f"/tasks?task={task_id}"
    if comment_id:
        link += f"&comment={comment_id}"
    return link


def project_deep_link(project_id, comment_id=None) -> str:
    link = f"/projects?project={project_id}"
    if comment_id:
        link += f"&comment={comment_id}"
    return link


def _link_for_role(link: str | None, role: UserRole | str | None) -> str | None:
    """Rewrite neutral /tasks and /projects (and legacy /va|/admin prefixes) for the recipient."""
    if not link:
        return None
    role_val = role.value if hasattr(role, "value") else str(role or "")
    prefix = "/va" if role_val == "va" else "/admin"

    if link.startswith("/tasks"):
        return f"{prefix}{link}"
    if link.startswith("/projects"):
        return f"{prefix}{link}"

    # Legacy absolute paths — swap prefix so admin/auditor aren't sent to /va/*
    for board in ("/tasks", "/projects"):
        for old in ("/va", "/admin"):
            if link.startswith(f"{old}{board}"):
                return f"{prefix}{link[len(old):]}"
    return link


def push(db: Session, user_ids, type: str, title: str, body: str = "", link: str = "", exclude_user_id=None) -> None:
    """Create in-app notification(s). Best-effort — never breaks the request.

    Links starting with /tasks or /projects are rewritten per recipient role so
    admins land on /admin/... and VAs on /va/....
    """
    try:
        ids = [u for u in dict.fromkeys(user_ids or []) if u and u != exclude_user_id]
        if not ids:
            return
        users = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()}
        for uid in ids:
            user = users.get(uid)
            resolved = _link_for_role(link, user.role if user else None)
            db.add(Notification(user_id=uid, type=type, title=title, body=body or None, link=resolved))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def admin_user_ids(db: Session) -> list:
    return [u.id for u in db.query(User).filter(User.role == UserRole.admin, User.is_active.is_(True)).all()]


def admin_and_auditor_user_ids(db: Session) -> list:
    return [u.id for u in db.query(User).filter(User.role.in_([UserRole.admin, UserRole.auditor]), User.is_active.is_(True)).all()]


def va_user_id(db: Session, va_id):
    if not va_id:
        return None
    va = db.query(VA).filter(VA.id == va_id).first()
    return va.user_id if va else None


def _va_contact(db: Session, va_id) -> tuple[str, str] | None:
    if not va_id:
        return None
    va = db.query(VA).filter(VA.id == va_id).first()
    if not va or not va.user or not va.user.email:
        return None
    return va.user.email, va.name


def _task_rows(task: Task, extra: list[tuple[str, str]] | None = None) -> str:
    rows = [
        ("Task", task.title),
        ("Client", task.client.name if task.client else ""),
        ("Project", task.project.name if task.project else ""),
        ("Status", task.status.value.replace("_", " ").title()),
        ("Priority", task.priority.value.title()),
        ("Due", str(task.due_date) if task.due_date else ""),
    ]
    if extra:
        rows = extra + rows
    return detail_rows(rows)


def wants_email(user, kind: str) -> bool:
    """Whether to send this email. Missing prefs default to on. No new columns.

    Skip when notification_preferences.email_enabled is false, or when
    notification_preferences.email_types[kind] is false.
    """
    if user is None or not getattr(user, "is_active", True) or not getattr(user, "email", None):
        return False
    prefs = user.notification_preferences if isinstance(getattr(user, "notification_preferences", None), dict) else {}
    if prefs.get("email_enabled") is False:
        return False
    types = prefs.get("email_types")
    if isinstance(types, dict) and types.get(kind) is False:
        return False
    return True


def _send_kind_email(db, user, *, kind: str, template_key: str, subject: str, title: str, preheader: str, body_html: str, cta_label: str, link: str, variables: dict) -> None:
    if not wants_email(user, kind):
        return
    url = email_cta_url(getattr(user, "role", None), link)
    rendered = render_template(db, template_key, variables, url)
    if rendered:
        send_email(user.email, rendered[0], rendered[1], template_key=template_key)
    else:
        send_email(user.email, subject, branded_email(title, preheader, body_html, cta_label, url), template_key=template_key)


def _first_name(user) -> str:
    raw = (getattr(user, "display_name", None) or getattr(user, "email", None) or "").split("@")[0]
    return raw.split(" ")[0] or "there"


def _actor_user_id(db: Session, actor_name: str):
    if not actor_name:
        return None
    from sqlalchemy import or_
    rows = db.query(User).filter(or_(User.display_name == actor_name, User.email == actor_name)).all()
    if len(rows) == 1:
        return rows[0].id
    return None


def _latest_task_comment(db: Session, task: Task, body: str, comment_id=None):
    from app.models import TaskComment
    if comment_id:
        row = db.query(TaskComment).filter(TaskComment.id == comment_id, TaskComment.task_id == task.id).first()
        if row:
            return row
    return (
        db.query(TaskComment)
        .filter(TaskComment.task_id == task.id, TaskComment.body == body)
        .order_by(TaskComment.created_at.desc())
        .first()
    )


def _task_participants(db: Session, task: Task, *, exclude_comment_id=None) -> list[User]:
    """Assignee, creator, and people following the thread (earlier comments and mentions)."""
    import uuid as _uuid
    from app.models import TaskComment

    ids: list = []
    assignee_uid = va_user_id(db, task.assignee_va_id)
    if assignee_uid:
        ids.append(assignee_uid)
    if task.created_by:
        ids.append(task.created_by)
    comments = db.query(TaskComment).filter(TaskComment.task_id == task.id).all()
    for comment in comments:
        if exclude_comment_id and comment.id == exclude_comment_id:
            continue
        if comment.author_user_id:
            ids.append(comment.author_user_id)
        for mention in comment.mentions or []:
            if not isinstance(mention, dict) or not mention.get("user_id"):
                continue
            try:
                ids.append(_uuid.UUID(str(mention.get("user_id"))))
            except Exception:
                continue
    ordered: list = []
    for uid in ids:
        if uid and uid not in ordered:
            ordered.append(uid)
    if not ordered:
        return []
    found = {u.id: u for u in db.query(User).filter(User.id.in_(ordered), User.is_active.is_(True)).all()}
    return [found[uid] for uid in ordered if uid in found]


def _task_email_vars(task: Task, extra: dict | None = None) -> dict:
    data = {
        "task_title": task.title,
        "client": task.client.name if task.client else "",
        "project": task.project.name if task.project else "",
        "status": task.status.value.replace("_", " ").title() if task.status else "",
        "priority": task.priority.value.title() if task.priority else "",
        "due": str(task.due_date or "no date"),
    }
    if extra:
        data.update(extra)
    return data


def notify_task_assigned(db: Session, task: Task, first_in_project: bool = False) -> None:
    try:
        user_id = va_user_id(db, task.assignee_va_id)
        user = db.query(User).filter(User.id == user_id).first() if user_id else None
        link = task_deep_link(task.id)
        if user:
            name = _first_name(user)
            if first_in_project and task.project:
                title = f"🌸 New project for you: {task.project.name}"
                subject = f"New project assigned: {task.project.name}"
                intro = "You've been assigned to a new project. Your first task is ready."
            else:
                title = f"📌 New task: {task.title}"
                subject = f"New task assigned: {task.title}"
                intro = "A new task was assigned to you."
            body = f"<p>Hi {_name(name)},</p><p>{_name(intro)}</p>" + _task_rows(task)
            _send_kind_email(
                db, user, kind="task_assigned", template_key="task_assigned",
                subject=subject, title=title, preheader=intro, body_html=body,
                cta_label="Open task", link=link,
                variables=_task_email_vars(task, {"name": name}),
            )
        push(db, [user_id], "task",
             f"🌸 New project: {task.project.name}" if first_in_project and task.project else f"📌 New task assigned: {task.title}",
             f"{task.client.name if task.client else ''}{' · ' + task.project.name if task.project else ''} · due {task.due_date or 'no date'}",
             link)
    except Exception:
        pass


def notify_task_updated(db: Session, task: Task, change: str, actor_name: str = "") -> None:
    """Email everyone on the task (assignee, creator, followers) when it is moved or updated."""
    try:
        link = task_deep_link(task.id)
        actor_id = _actor_user_id(db, actor_name)
        participants = [u for u in _task_participants(db, task) if u.id != actor_id]
        title = f"🔔 Task updated: {task.title}"
        for user in participants:
            name = _first_name(user)
            body = f"<p>Hi {_name(name)},</p><p>{_name(change)}</p>" + _task_rows(task, [("Updated by", actor_name)] if actor_name else None)
            try:
                _send_kind_email(
                    db, user, kind="task_updated", template_key="task_updated",
                    subject=f"Task updated: {task.title}", title=title, preheader=change, body_html=body,
                    cta_label="View task", link=link,
                    variables=_task_email_vars(task, {"name": name, "change": change, "actor": actor_name}),
                )
            except Exception:
                continue
        push_ids = [u.id for u in participants]
        assignee_uid = va_user_id(db, task.assignee_va_id)
        if assignee_uid and assignee_uid != actor_id:
            push_ids.append(assignee_uid)
        push(db, push_ids, "task", title, change, link, exclude_user_id=actor_id)
    except Exception:
        pass


def notify_task_comment(db: Session, task: Task, comment_body: str, author_name: str, author_is_assignee: bool = False, comment_id=None) -> None:
    """Email people assigned to or following the task. Mention emails are separate."""
    try:
        comment = _latest_task_comment(db, task, comment_body, comment_id)
        cid = comment.id if comment else comment_id
        author_id = comment.author_user_id if comment else None
        link = task_deep_link(task.id, cid)
        participants = [u for u in _task_participants(db, task, exclude_comment_id=cid) if u.id != author_id]
        title = f"💬 New comment on: {task.title}"
        excerpt = (comment_body or "").strip()
        quote = (
            "<blockquote style='margin:10px 0;padding:10px 14px;background:#fff7fa;border-left:3px solid #ec4899;border-radius:8px;'>"
            f"{_name(excerpt)}</blockquote>"
        )
        client = f" ({_name(task.client.name)})" if task.client else ""
        for user in participants:
            name = _first_name(user)
            body = (
                f"<p>Hi {_name(name)},</p>"
                f"<p><strong>{_name(author_name)}</strong> commented on <strong>{_name(task.title)}</strong>{client}.</p>"
                f"{quote}"
            )
            try:
                _send_kind_email(
                    db, user, kind="comment", template_key="task_comment",
                    subject=f"New comment: {task.title}", title=title, preheader=excerpt[:120], body_html=body,
                    cta_label="View comment", link=link,
                    variables=_task_email_vars(task, {"name": name, "author": author_name, "comment": excerpt}),
                )
            except Exception:
                continue
        push_ids = [u.id for u in participants]
        if author_is_assignee:
            push_ids.extend(admin_user_ids(db))
        else:
            assignee_uid = va_user_id(db, task.assignee_va_id)
            if assignee_uid:
                push_ids.append(assignee_uid)
        push(
            db, push_ids, "comment",
            f"💬 {author_name} commented on: {task.title}",
            f"{author_name}: {excerpt[:180]}",
            link,
            exclude_user_id=author_id,
        )
    except Exception:
        pass


def notify_delegation(db: Session, to_va: VA, from_name: str, summary: dict) -> None:
    try:
        if not to_va.user or not to_va.user.email:
            return
        rows = [
            ("From", from_name), ("Tasks transferred", str(summary.get("tasks", 0))),
            ("Work logs transferred", str(summary.get("work_logs", 0))), ("Clock entries", str(summary.get("clock_entries", 0))),
            ("Clients covered", ", ".join(summary.get("clients", [])[:6])),
        ]
        title = f"🤝 Work delegated to you from {from_name}"
        body = f"<p>Hi {_name(to_va.name)},</p><p>Tasks and history from <strong>{_name(from_name)}</strong> were delegated to you. Everything is already synced to your board and logs.</p>" + detail_rows(rows)
        rendered = render_template(db, "delegation", {"name": to_va.name, "from_name": from_name, "tasks": summary.get("tasks", 0), "work_logs": summary.get("work_logs", 0)})
        if rendered:
            send_email(to_va.user.email, rendered[0], rendered[1], template_key="delegation")
        else:
            send_email(to_va.user.email, f"Work delegated to you from {from_name}", branded_email(title, "New delegated work is on your board", body, "Open My Board", f"{settings.app_url}{BASE}", accent="#a855f7"), template_key="delegation")
        push(db, [to_va.user_id], "delegation", f"🤝 Work delegated to you from {from_name}",
             f"{summary.get('tasks', 0)} tasks · {summary.get('work_logs', 0)} logs · {summary.get('clock_entries', 0)} clock entries now on your board", BASE)
    except Exception:
        pass


def _name(v: str) -> str:
    import html as _h
    return _h.escape(str(v or ""))
