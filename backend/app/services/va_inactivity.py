"""Daily flags when a VA logged no time or no tasks.

Admins and project managers keep the in-app bell. Email for a VA with no hours
goes to that VA and to project managers, so they can nudge the VA. Jane and
other admins are not emailed.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models import ClockStatus, Notification, Task, TaskStatus, TimeClockEntry, User, UserRole, VA, WorkLog
from app.services.notifications import admin_and_auditor_user_ids, admin_user_ids, push


def flagged_date_label(day: date) -> str:
    return f"{day.strftime('%b')} {day.day}, {day.year}"


def inactivity_messages(name: str, label: str, *, no_time: bool, no_tasks: bool) -> dict[str, str]:
    """Staff copy names the VA. The VA's own copy speaks to them. No em dashes."""
    staff_bits: list[str] = []
    va_bits: list[str] = []
    if no_time:
        staff_bits.append(f"{name} logged no time on {label}.")
        va_bits.append(f"You logged no time on {label}.")
    if no_tasks:
        staff_bits.append(f"{name} has no tasks logged for {label}.")
        va_bits.append(f"You have no tasks logged for {label}.")
    if no_time:
        staff_title = f"{name} logged no time on {label}"
        va_title = f"You logged no time on {label}"
        va_bits.append("Log your hours so your timesheet stays current.")
    else:
        staff_title = f"{name} has no tasks for {label}"
        va_title = f"You have no tasks logged for {label}"
        va_bits.append("Add the task on your time log.")
    return {
        "title": staff_title,
        "body": " ".join(staff_bits),
        "va_title": va_title,
        "va_body": " ".join(va_bits),
    }


def inactivity_delivery(
    *,
    admin_ids: list[UUID],
    pm_ids: list[UUID],
    reviewer_id: UUID | None,
    va_user_id: UUID | None,
) -> dict[str, list[UUID]]:
    """Split a zero-hours alert into bells and emails.

    staff_bell: admins and project managers (the in-app bell stays).
    pm_email: project managers, plus a non-admin reviewer, so they can reach the VA.
    va_ids: the VA. Admins are never in an email list, even when one is the reviewer.
    """
    admins: list[UUID] = []
    seen_admin: set[UUID] = set()
    for uid in admin_ids:
        if uid and uid not in seen_admin:
            admins.append(uid)
            seen_admin.add(uid)
    pms: list[UUID] = []
    seen_pm: set[UUID] = set()
    for uid in pm_ids:
        if uid and uid not in seen_admin and uid != va_user_id and uid not in seen_pm:
            pms.append(uid)
            seen_pm.add(uid)
    staff_bell = [*admins, *pms]
    if reviewer_id and reviewer_id not in seen_admin and reviewer_id != va_user_id and reviewer_id not in seen_pm:
        staff_bell.append(reviewer_id)
        pms.append(reviewer_id)
        seen_pm.add(reviewer_id)
    va_ids = [va_user_id] if va_user_id and va_user_id not in seen_admin else []
    return {"staff_bell": staff_bell, "pm_email": pms, "va_ids": va_ids}


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
        words = inactivity_messages(name, label, no_time=no_time, no_tasks=no_tasks)
        flags.append({
            "va_id": str(va.id),
            "va_user_id": str(va.user_id) if va.user_id else None,
            "va_name": name,
            "date": str(today),
            "date_label": label,
            "no_time": no_time,
            "no_tasks": no_tasks,
            "title": words["title"],
            "body": words["body"],
            "va_title": words["va_title"],
            "va_body": words["va_body"],
            "reviewer_user_id": str(va.reviewer_user_id) if va.reviewer_user_id else None,
            "link": "/admin/analytics",
            "va_link": "/va/time-log",
        })
    return flags


def _missing(db: Session, user_ids: list[UUID], title: str, day_start: datetime) -> list[UUID]:
    pending: list[UUID] = []
    for uid in user_ids:
        exists = (
            db.query(Notification)
            .filter(
                Notification.user_id == uid,
                Notification.title == title,
                Notification.created_at >= day_start,
            )
            .first()
        )
        if not exists:
            pending.append(uid)
    return pending


def notify_daily_inactivity(db: Session, today: date | None = None) -> list[dict]:
    """Bell admins and project managers. Email the VA and project managers, not admins."""
    flags = daily_inactivity_flags(db, today)
    if not flags:
        return flags
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    admins = admin_user_ids(db)
    staff = admin_and_auditor_user_ids(db)
    admin_set = set(admins)
    pm_ids = [uid for uid in staff if uid not in admin_set]
    try:
        from app.services.notification_mail import email_user_ids

        for flag in flags:
            reviewer = UUID(flag["reviewer_user_id"]) if flag.get("reviewer_user_id") else None
            va_uid = UUID(flag["va_user_id"]) if flag.get("va_user_id") else None
            delivery = inactivity_delivery(
                admin_ids=admins,
                pm_ids=pm_ids,
                reviewer_id=reviewer,
                va_user_id=va_uid,
            )
            fresh_staff = _missing(db, delivery["staff_bell"], flag["title"], day_start)
            if fresh_staff:
                push(db, fresh_staff, "system", flag["title"], flag["body"], flag["link"])
                pm_mail = [uid for uid in fresh_staff if uid in set(delivery["pm_email"])]
                if pm_mail:
                    email_user_ids(
                        db,
                        pm_mail,
                        title=flag["title"],
                        paragraphs=[flag["body"]],
                        link=flag["link"],
                        template_key="inactive_va",
                        link_label="Open team activity",
                    )
            fresh_va = _missing(db, delivery["va_ids"], flag["va_title"], day_start)
            if fresh_va:
                push(db, fresh_va, "system", flag["va_title"], flag["va_body"], flag["va_link"])
                email_user_ids(
                    db,
                    fresh_va,
                    title=flag["va_title"],
                    paragraphs=[flag["va_body"]],
                    link=flag["va_link"],
                    template_key="inactive_va",
                    link_label="Log your time",
                )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    return flags
