"""One reminder per task per deadline, in Asia/Manila. A new deadline sends again."""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import Task, TaskDeadlineAlert, TaskStatus
from app.services.notification_mail import email_user_ids
from app.services.notifications import push, task_deep_link, va_user_id

MANILA = ZoneInfo("Asia/Manila")
DUE_HOUR = 17


def deadline_moment(due_date) -> datetime:
    return datetime(due_date.year, due_date.month, due_date.day, DUE_HOUR, 0, tzinfo=MANILA)


def classify_deadline(now: datetime, due_date) -> str | None:
    """due_soon during the 24 hours before 5:00 PM Manila, then overdue once it has passed."""
    moment = deadline_moment(due_date)
    current = now if now.tzinfo else now.replace(tzinfo=MANILA)
    current = current.astimezone(MANILA)
    if current >= moment:
        return "overdue"
    if current >= moment - timedelta(hours=24):
        return "due_soon"
    return None


def due_soon_title(task_title: str, now: datetime, due_date) -> str:
    current = now if now.tzinfo else now.replace(tzinfo=MANILA)
    today = current.astimezone(MANILA).date()
    if due_date == today:
        return f"{task_title} is due today at 5:00 PM"
    return f"{task_title} is due tomorrow at 5:00 PM"


def _already_sent(db: Session, task_id, kind: str, due_date) -> bool:
    rows = (
        db.query(TaskDeadlineAlert)
        .filter(TaskDeadlineAlert.task_id == task_id)
        .all()
    )
    return any(row.kind == kind and row.due_date == due_date for row in rows)


def notify_task_deadlines(db: Session, now: datetime | None = None) -> int:
    """Tell each assignee about a deadline that is 24 hours away, or already past. Once each."""
    now = now or datetime.now(MANILA)
    sent = 0
    tasks = (
        db.query(Task)
        .filter(
            Task.due_date.isnot(None),
            Task.assignee_va_id.isnot(None),
            Task.status != TaskStatus.done,
        )
        .all()
    )
    for task in tasks:
        kind = classify_deadline(now, task.due_date)
        if not kind or _already_sent(db, task.id, kind, task.due_date):
            continue
        uid = va_user_id(db, task.assignee_va_id)
        if not uid:
            continue
        if kind == "due_soon":
            title = due_soon_title(task.title, now, task.due_date)
            event = "deadline_soon"
            template = "deadline_soon"
        else:
            title = f"{task.title} is past due"
            event = "deadline_overdue"
            template = "deadline_overdue"
        link = task_deep_link(task.id)
        push(db, [uid], "task", title, "Open the task to update it.", link, event_key=event)
        email_user_ids(
            db,
            [uid],
            title=title,
            paragraphs=[title, "Open the task to update it."],
            link=link,
            template_key=template,
            link_label="Open the task",
            event_key=event,
        )
        db.add(TaskDeadlineAlert(task_id=task.id, kind=kind, due_date=task.due_date))
        db.commit()
        sent += 1
    return sent
