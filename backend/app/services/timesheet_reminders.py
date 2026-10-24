"""Dashboard + push reminders for semi-monthly timesheet deadlines."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import Notification, VA
from app.services.notifications import admin_and_auditor_user_ids, push, va_user_id
from app.services.payroll_calendar import (
    active_vas,
    current_and_upcoming,
    va_has_submitted,
)


def _already_notified(db: Session, user_id, title: str, within_hours: int = 36) -> bool:
    since = datetime.now(timezone.utc) - timedelta(hours=within_hours)
    return (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.title == title,
            Notification.created_at >= since,
        )
        .first()
        is not None
    )


def run_timesheet_reminders(db: Session) -> dict:
    """Idempotent: push VA submit reminders and staff alerts for missing submissions."""
    info = current_and_upcoming()
    if not info["in_reminder_window"] and not info["is_deadline_day"]:
        return {"skipped": True, **{k: str(v) if hasattr(v, "isoformat") else v for k, v in info.items()}}

    period_start, period_end = info["period_start"], info["period_end"]
    label = info["deadline_label"]
    va_title = f"Please submit your timesheet by {label}"
    va_body = (
        f"Payroll period {period_start} – {period_end}. "
        f"Submit by {label} so you can be paid on {info['pay_date']}."
    )

    missing: list[VA] = []
    for va in active_vas(db):
        if va_has_submitted(db, va.id, period_start, period_end):
            continue
        missing.append(va)
        uid = va_user_id(db, va.id)
        if not uid:
            continue
        if _already_notified(db, uid, va_title):
            continue
        push(db, [uid], "log", va_title, va_body, "/va/payroll")

    # Staff: alert when deadline is today (or within 1 day) and VAs are still missing
    if missing and info["days_until_deadline"] <= 1:
        names = ", ".join(v.name for v in missing[:8])
        more = f" (+{len(missing) - 8} more)" if len(missing) > 8 else ""
        staff_title = f"{len(missing)} VA(s) have not submitted timesheets yet"
        staff_body = f"Deadline is {label} ({period_end}). Missing: {names}{more}."
        for uid in admin_and_auditor_user_ids(db):
            if _already_notified(db, uid, staff_title):
                continue
            push(db, [uid], "log", staff_title, staff_body, "/admin/payroll")

    return {
        "skipped": False,
        "missing_count": len(missing),
        "deadline": str(info["deadline"]),
        "deadline_label": label,
    }


def dashboard_timesheet_attention(db: Session, *, is_va: bool, va_id, is_staff: bool) -> list[dict]:
    """Items for the morning dashboard needs_attention / prepare lists."""
    info = current_and_upcoming()
    items: list[dict] = []
    if not info["in_reminder_window"] and not info["is_deadline_day"]:
        return items

    period_start, period_end = info["period_start"], info["period_end"]
    label = info["deadline_label"]

    if is_va and va_id:
        if not va_has_submitted(db, va_id, period_start, period_end):
            items.append({
                "type": "timesheet_deadline",
                "severity": "high" if info["days_until_deadline"] <= 1 else "medium",
                "title": f"Please submit your timesheet by {label}",
                "detail": f"Period {period_start} – {period_end} · paid on {info['pay_date']}",
                "link": "/va/payroll",
            })
    elif is_staff:
        missing = [v for v in active_vas(db) if not va_has_submitted(db, v.id, period_start, period_end)]
        if missing:
            items.append({
                "type": "timesheet_missing",
                "severity": "high" if info["days_until_deadline"] <= 1 else "medium",
                "title": f"{len(missing)} VA(s) have not submitted timesheets yet",
                "detail": f"Deadline {label} ({period_end}). " + ", ".join(v.name for v in missing[:5]),
                "link": "/admin/payroll",
            })
    return items
