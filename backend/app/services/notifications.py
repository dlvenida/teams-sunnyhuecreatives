"""Task/project email + in-app notifications (Monday-style). Best-effort: never breaks the request."""
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Notification, Task, User, UserRole, VA
from app.services.email import branded_email, detail_rows, render_template, send_email

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


def first_name_of(user) -> str:
    if not user:
        return "there"
    raw = (getattr(user, "display_name", None) or "").strip()
    if not raw and getattr(user, "email", None):
        raw = user.email.split("@")[0]
    return raw.split()[0] if raw else "there"


def possessive_pronoun(user) -> str:
    """her / his / their from profile text when someone wrote she/her, he/him, or they/them. Otherwise their."""
    if not user:
        return "their"
    blob = " ".join(
        str(getattr(user, field, "") or "")
        for field in ("bio", "job_title", "status_message")
    ).lower()
    if "she/her" in blob or "she / her" in blob:
        return "her"
    if "he/him" in blob or "he / him" in blob:
        return "his"
    return "their"


def comment_snippet(text: str, limit: int = 90) -> str:
    cleaned = " ".join((text or "").split())
    cleaned = cleaned.replace("\u2014", ", ").replace("\u2013", "-")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + "..."


def is_staff_user(user) -> bool:
    role = getattr(user, "role", None)
    value = role.value if hasattr(role, "value") else str(role or "")
    return value in ("admin", "auditor")


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


def notify_task_assigned(db: Session, task: Task, first_in_project: bool = False) -> None:
    try:
        contact = _va_contact(db, task.assignee_va_id)
        if not contact:
            return
        email, name = contact
        if first_in_project and task.project:
            title = f"🌸 New project for you: {task.project.name}"
            body = f"<p>Hi {_name(name)},</p><p>You've been assigned to a new project. Your first task is ready:</p>" + _task_rows(task)
            subject = f"New project assigned: {task.project.name}"
        else:
            title = f"📌 New task: {task.title}"
            body = f"<p>Hi {_name(name)},</p><p>A new task was assigned to you:</p>" + _task_rows(task)
            subject = f"New task assigned: {task.title}"
        rendered = render_template(db, "task_assigned", {"name": name, "task_title": task.title, "client": task.client.name if task.client else "", "project": task.project.name if task.project else "", "status": task.status.value.replace("_", " ").title(), "priority": task.priority.value.title(), "due": str(task.due_date or "no date")})
        if rendered:
            send_email(email, rendered[0], rendered[1], template_key="task_assigned")
        else:
            send_email(email, subject, branded_email(title, subject, body, "Open My Board", f"{settings.app_url}{BASE}"), template_key="task_assigned")
        push(db, [va_user_id(db, task.assignee_va_id)], "task",
             f"🌸 New project: {task.project.name}" if first_in_project and task.project else f"📌 New task assigned: {task.title}",
             f"{task.client.name if task.client else ''}{' · ' + task.project.name if task.project else ''} · due {task.due_date or 'no date'}",
             task_deep_link(task.id))
    except Exception:
        pass


def notify_task_updated(db: Session, task: Task, change: str, actor_name: str = "") -> None:
    try:
        contact = _va_contact(db, task.assignee_va_id)
        if not contact:
            return
        email, name = contact
        title = f"🔔 Task updated: {task.title}"
        body = f"<p>Hi {_name(name)},</p><p>{_name(change)}</p>" + _task_rows(task, [("Updated by", actor_name)] if actor_name else None)
        rendered = render_template(db, "task_updated", {"name": name, "task_title": task.title, "client": task.client.name if task.client else "", "project": task.project.name if task.project else "", "change": change, "actor": actor_name})
        if rendered:
            send_email(email, rendered[0], rendered[1], template_key="task_updated")
        else:
            send_email(email, f"Task updated: {task.title}", branded_email(title, change, body, "View Task", f"{settings.app_url}{BASE}"), template_key="task_updated")
        push(db, [va_user_id(db, task.assignee_va_id)], "task", f"🔔 Task updated: {task.title}", change, task_deep_link(task.id))
    except Exception:
        pass


def task_involved_user_ids(db: Session, task: Task) -> list:
    """People who own or are on this task: creator, assignee, that VA's reviewer, and prior commenters."""
    from app.models import TaskComment

    ids: list = []
    if task.created_by:
        ids.append(task.created_by)
    assignee = va_user_id(db, task.assignee_va_id)
    if assignee:
        ids.append(assignee)
    if task.assignee_va_id:
        va = db.query(VA).filter(VA.id == task.assignee_va_id).first()
        if va and va.reviewer_user_id:
            ids.append(va.reviewer_user_id)
    for row in db.query(TaskComment).filter(TaskComment.task_id == task.id).all():
        if row.author_user_id:
            ids.append(row.author_user_id)
    return ids


def project_involved_user_ids(db: Session, project) -> list:
    """Project owner, people on its tasks, their reviewers, and prior discussion commenters."""
    from app.models import ProjectComment

    ids: list = []
    if project.created_by:
        ids.append(project.created_by)
    for task in db.query(Task).filter(Task.project_id == project.id).all():
        ids.extend(task_involved_user_ids(db, task))
    for row in db.query(ProjectComment).filter(ProjectComment.project_id == project.id).all():
        if row.author_user_id:
            ids.append(row.author_user_id)
    return ids


def notify_involved_comment(
    db: Session,
    *,
    author_name: str,
    author_user_id,
    comment_body: str,
    context_title: str,
    link: str,
    recipient_ids,
) -> None:
    """In-app only for people who own or are involved. Not a blast to every admin."""
    try:
        ids = []
        for uid in recipient_ids or []:
            if uid and uid != author_user_id and uid not in ids:
                ids.append(uid)
        if not ids:
            return
        snippet = comment_snippet(comment_body)
        push(
            db,
            ids,
            "comment",
            f"{author_name} commented: {snippet}" if snippet else f"{author_name} commented",
            f"On {context_title}",
            link,
        )
    except Exception:
        pass


def notify_task_comment(db: Session, task: Task, comment_body: str, author_name: str, author_user_id=None, author_is_assignee: bool = False) -> None:
    """Tell people involved in the task. Does not email or ping every admin."""
    try:
        notify_involved_comment(
            db,
            author_name=author_name,
            author_user_id=author_user_id,
            comment_body=comment_body,
            context_title=task.title,
            link=task_deep_link(task.id),
            recipient_ids=task_involved_user_ids(db, task),
        )
        if author_is_assignee:
            return
        contact = _va_contact(db, task.assignee_va_id)
        if not contact:
            return
        email, name = contact
        snippet = comment_snippet(comment_body)
        title = f"{author_name} commented: {snippet}" if snippet else f"{author_name} commented"
        body = (
            f"<p>Hi {_name(name)},</p><p><strong>{_name(author_name)}</strong> commented on "
            f"<em>{_name(task.title)}</em>:</p>"
            f"<blockquote style='margin:10px 0;padding:10px 14px;background:#fff7fa;border-left:3px solid #ec4899;border-radius:8px;'>{_name(snippet)}</blockquote>"
        )
        send_email(email, title, branded_email(title, snippet, body, "Reply on My Board", f"{settings.app_url}{BASE}"), template_key="task_comment")
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
