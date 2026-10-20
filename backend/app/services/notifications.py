"""Task/project email + in-app notifications (Monday-style). Best-effort: never breaks the request."""
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Notification, Task, User, UserRole, VA
from app.services.email import branded_email, detail_rows, render_template, send_email

BASE = "/va/tasks"


def push(db: Session, user_ids, type: str, title: str, body: str = "", link: str = "", exclude_user_id=None) -> None:
    """Create in-app notification(s). Best-effort — never breaks the request."""
    try:
        ids = [u for u in dict.fromkeys(user_ids or []) if u and u != exclude_user_id]
        if not ids:
            return
        for uid in ids:
            db.add(Notification(user_id=uid, type=type, title=title, body=body or None, link=link or None))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def admin_user_ids(db: Session) -> list:
    return [u.id for u in db.query(User).filter(User.role == UserRole.admin, User.is_active.is_(True)).all()]


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
             f"{task.client.name if task.client else ''}{' · ' + task.project.name if task.project else ''} · due {task.due_date or 'no date'}", BASE)
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
        push(db, [va_user_id(db, task.assignee_va_id)], "task", f"🔔 Task updated: {task.title}", change, BASE)
    except Exception:
        pass


def notify_task_comment(db: Session, task: Task, comment_body: str, author_name: str, author_is_assignee: bool) -> None:
    """Comment by admin → email the VA. Comment by the VA → email the admin."""
    try:
        if author_is_assignee:
            title = f"💬 {author_name} commented on: {task.title}"
            body = f"<p><strong>{_name(author_name)}</strong> added an update:</p><blockquote style='margin:10px 0;padding:10px 14px;background:#fff7fa;border-left:3px solid #ec4899;border-radius:8px;'>{_name(comment_body)}</blockquote>" + _task_rows(task)
            from app.services.email import _resend_config
            rendered = render_template(db, "task_comment", {"name": "Admin", "task_title": task.title, "client": task.client.name if task.client else "", "author": author_name, "comment": comment_body})
            if rendered:
                send_email(_resend_config()[2], rendered[0], rendered[1], template_key="task_comment")
            else:
                send_email(_resend_config()[2], f"Task comment: {task.title}", branded_email(title, comment_body[:120], body, "Open Board", f"{settings.app_url}/admin/tasks"), template_key="task_comment")
            push(db, admin_user_ids(db), "comment", f"💬 {author_name} commented on: {task.title}", comment_body[:200], "/admin/tasks")
            return
        contact = _va_contact(db, task.assignee_va_id)
        if not contact:
            return
        email, name = contact
        title = f"💬 New comment on: {task.title}"
        body = f"<p>Hi {_name(name)},</p><p><strong>{_name(author_name)}</strong> commented:</p><blockquote style='margin:10px 0;padding:10px 14px;background:#fff7fa;border-left:3px solid #ec4899;border-radius:8px;'>{_name(comment_body)}</blockquote>" + _task_rows(task)
        rendered = render_template(db, "task_comment", {"name": name, "task_title": task.title, "client": task.client.name if task.client else "", "author": author_name, "comment": comment_body})
        if rendered:
            send_email(email, rendered[0], rendered[1], template_key="task_comment")
        else:
            send_email(email, f"New comment: {task.title}", branded_email(title, comment_body[:120], body, "Reply on My Board", f"{settings.app_url}{BASE}"), template_key="task_comment")
        push(db, [va_user_id(db, task.assignee_va_id)], "comment", f"💬 New comment on: {task.title}", f"{author_name}: {comment_body[:180]}", BASE)
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
