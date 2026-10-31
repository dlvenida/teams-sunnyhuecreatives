"""Dashboard + push reminders for semi-monthly timesheet deadlines."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape as html_escape

from sqlalchemy.orm import Session

from app.models import Notification
from app.services.notifications import admin_and_auditor_user_ids, push, va_user_id
from app.services.payroll_calendar import (
    active_vas,
    current_and_upcoming,
    va_has_submitted,
)

# Same title is not emailed again inside this window (hourly job).
EMAIL_DEDUP_HOURS = 20


def _already_notified(db: Session, user_id, title: str, within_hours: int = EMAIL_DEDUP_HOURS) -> bool:
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


def _session_permanently_closed(db: Session) -> bool:
    state = getattr(db, "_close_state", None)
    return getattr(state, "name", None) == "CLOSED"


def _commit_pending(db: Session) -> bool:
    """Commit in-app rows before any email. False means the caller must not email."""
    if _session_permanently_closed(db):
        return False
    try:
        db.commit()
        return True
    except Exception:
        try:
            if not _session_permanently_closed(db):
                db.rollback()
        except Exception:
            pass
        return False


def _recently_emailed(subject: str, within_hours: int = EMAIL_DEDUP_HOURS) -> set[str]:
    """Addresses that already got this subject. Own session so a rolled-back caller cannot hide it."""
    db = None
    try:
        from app.database import SessionLocal
        from app.models import EmailLog

        since = datetime.now(timezone.utc) - timedelta(hours=within_hours)
        db = SessionLocal()
        rows = (
            db.query(EmailLog.to_email)
            .filter(
                EmailLog.subject == subject,
                EmailLog.status == "sent",
                EmailLog.created_at >= since,
            )
            .all()
        )
        return {row[0] for row in rows if row and row[0]}
    except Exception:
        return set()
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


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

    # Snapshot names before any push(); push commits and expires the VA rows.
    pending: list[tuple] = []
    for va in active_vas(db):
        if va_has_submitted(db, va.id, period_start, period_end):
            continue
        pending.append((va.id, va.name, va_user_id(db, va.id)))
    missing_names = [name for _, name, _ in pending]
    for _va_id, _name, uid in pending:
        if not uid or _already_notified(db, uid, va_title):
            continue
        push(db, [uid], "log", va_title, va_body, "/va/payroll")

    # Staff: in-app and email for the whole reminder window, not only when the dashboard is open.
    # Email only after the notification commit succeeds. A rolled-back session must not send mail.
    if pending and _commit_pending(db):
        names = ", ".join(missing_names[:8])
        more = f" (+{len(pending) - 8} more)" if len(pending) > 8 else ""
        staff_title = f"{len(pending)} VA(s) have not submitted timesheets yet"
        staff_body = f"Deadline is {label} ({period_end}). Missing: {names}{more}."
        staff_ids = list(admin_and_auditor_user_ids(db))
        fresh_ids = [uid for uid in staff_ids if uid and not _already_notified(db, uid, staff_title)]
        push_ok = True
        if fresh_ids:
            push(db, fresh_ids, "log", staff_title, staff_body, "/admin/payroll")
            # push() commits on success. On failure it rolls the session back and returns.
            # Do not email from that rolled-back transaction.
            push_ok = any(_already_notified(db, uid, staff_title) for uid in fresh_ids)
        if push_ok and _commit_pending(db):
            _email_missing_timesheets(
                staff_ids,
                staff_title,
                staff_body,
                label,
                str(period_start),
                str(period_end),
                names + more,
            )

    return {
        "skipped": False,
        "missing_count": len(pending),
        "deadline": str(info["deadline"]),
        "deadline_label": label,
    }


def _email_missing_timesheets(user_ids, title: str, body: str, label: str, period_start: str, period_end: str, names: str) -> None:
    """Email admins and Project Managers. Caller must already have committed.

    Opens its own session for the recipient list and closes it before sending,
    so a later rollback of the reminder session cannot unsend or re-queue mail.
    The same title is skipped when it was sent in the last ~20 hours.
    """
    from app.config import settings
    from app.database import SessionLocal
    from app.models import User, UserRole
    from app.services.email import branded_email, send_email

    if not user_ids:
        return
    html_body = branded_email(
        title,
        body,
        (
            f"<p>These team members have not submitted their timesheet for {html_escape(period_start)} – {html_escape(period_end)}.</p>"
            f"<p><strong>Missing:</strong> {html_escape(names)}</p>"
            f"<p>Deadline: {html_escape(label)}.</p>"
        ),
        "Open VA Payroll",
        f"{(settings.app_url or '').rstrip('/')}/admin/payroll",
    )
    already = _recently_emailed(title, EMAIL_DEDUP_HOURS)
    recipients: list[str] = []
    db = None
    try:
        db = SessionLocal()
        users = db.query(User).filter(User.id.in_(list(user_ids)), User.is_active.is_(True)).all()
        for user in users:
            if user.role not in (UserRole.admin, UserRole.auditor) or not user.email:
                continue
            if user.email in already:
                continue
            recipients.append(user.email)
    except Exception:
        recipients = []
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
    for email in recipients:
        send_email(email, title, html_body, template_key="timesheet_missing")


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
