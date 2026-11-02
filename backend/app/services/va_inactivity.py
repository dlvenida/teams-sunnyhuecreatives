"""Daily flags when a VA logged no time or no tasks. Notifies admins and project managers."""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models import ClockStatus, Notification, Task, TaskStatus, TimeClockEntry, User, UserRole, VA, WorkLog
from app.services.notifications import admin_and_auditor_user_ids, push


def flagged_date_label(day: date) -> str:
    return f"{day.strftime('%b')} {day.day}, {day.year}"


def _has_task(log: WorkLog) -> bool:
    if log.task_id:
        return True
    return bool((getattr(log, "task_name", None) or "").strip())


def daily_inactivity_flags(db: Session, today: date | None = None) -> list[dict]:
    """VAs who logged no time today, or logged time with no task for the day."""
    today = today or date.today()
    label = flagged_date_label(today)
    vas = (
        db.query(VA)
        .options(joinedload(VA.user))
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active.is_(True), User.role == UserRole.va, User.is_active.is_(True))
        .order_by(VA.name)
        .all()
    )
    flags: list[dict] = []
    for va in vas:
        logs_today = db.query(WorkLog).filter(WorkLog.va_id == va.id, WorkLog.work_date == today).all()
        live = (
            db.query(TimeClockEntry)
            .filter(
                TimeClockEntry.va_id == va.id,
                TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]),
            )
            .first()
        )
        open_tasks = (
            db.query(Task)
            .filter(Task.assignee_va_id == va.id, Task.status != TaskStatus.done)
            .count()
        )
        task_logs = [log for log in logs_today if _has_task(log)]
        on_a_task = bool(live and live.task_id)
        no_time = not logs_today and not live
        no_tasks = not task_logs and not on_a_task and (open_tasks > 0 or no_time)
        if not no_time and not no_tasks:
            continue
        name = (
            (va.user.display_name.strip() if va.user and va.user.display_name else "")
            or va.name
        )
        bits: list[str] = []
        if no_time:
            bits.append(f"{name} logged no time on {label}.")
        if no_tasks:
            bits.append(f"{name} has no tasks logged for {label}.")
        if no_time:
            title = f"{name} logged no time on {label}"
        else:
            title = f"{name} has no tasks for {label}"
        flags.append({
            "va_id": str(va.id),
            "va_name": name,
            "date": str(today),
            "date_label": label,
            "no_time": no_time,
            "no_tasks": no_tasks,
            "title": title,
            "body": " ".join(bits),
            "reviewer_user_id": str(va.reviewer_user_id) if va.reviewer_user_id else None,
            "link": "/admin/analytics",
        })
    return flags


def notify_daily_inactivity(db: Session, today: date | None = None) -> list[dict]:
    """Push the same daily flag to every admin and project manager (auditor), once per VA per day."""
    flags = daily_inactivity_flags(db, today)
    if not flags:
        return flags
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    staff = admin_and_auditor_user_ids(db)
    try:
        for flag in flags:
            recipients: list[UUID] = list(staff)
            if flag.get("reviewer_user_id"):
                rid = UUID(flag["reviewer_user_id"])
                if rid not in recipients:
                    recipients.append(rid)
            pending: list[UUID] = []
            for uid in recipients:
                exists = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == uid,
                        Notification.title == flag["title"],
                        Notification.created_at >= day_start,
                    )
                    .first()
                )
                if not exists:
                    pending.append(uid)
            if pending:
                push(
                    db,
                    pending,
                    "system",
                    flag["title"],
                    flag["body"],
                    flag["link"],
                )
                from app.services.notification_mail import email_user_ids
                email_user_ids(
                    db,
                    pending,
                    title=flag["title"],
                    paragraphs=[flag["body"]],
                    link=flag["link"],
                    template_key="inactive_va",
                    link_label="Open team activity",
                )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    return flags
