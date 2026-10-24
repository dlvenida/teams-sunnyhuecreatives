"""Semi-monthly VA payroll calendar for Sunny Hue Creatives.

Cutoff / pay schedule:
  • Period 1–15  → submit by the 15th  → paid on the 16th
  • Period 16–EOM → submit by last day → paid on the 1st of next month
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import TimesheetStatus, TimesheetSubmission, VA, User, UserRole

REMINDER_DAYS = 3  # show / notify this many days before the submit deadline


def payroll_period_for(d: date) -> tuple[date, date]:
    """Return (period_start, period_end) containing date d."""
    last = monthrange(d.year, d.month)[1]
    if d.day <= 15:
        return date(d.year, d.month, 1), date(d.year, d.month, 15)
    return date(d.year, d.month, 16), date(d.year, d.month, last)


def period_deadline(period_end: date) -> date:
    """Submit-by date for a payroll period (same as period_end)."""
    return period_end


def period_pay_date(period_start: date, period_end: date) -> date:
    if period_start.day == 1:
        return date(period_start.year, period_start.month, 16)
    # Second half → 1st of next month
    if period_end.month == 12:
        return date(period_end.year + 1, 1, 1)
    return date(period_end.year, period_end.month + 1, 1)


def deadline_label(period_end: date) -> str:
    if period_end.day == 15:
        return "the 15th"
    return "the 30th" if period_end.day == 30 else f"the {period_end.day}th"


def next_period_start(after_period_end: date) -> date:
    """First day of the payroll period after the locked one."""
    return after_period_end + timedelta(days=1)


def current_and_upcoming(today: date | None = None) -> dict:
    """Snapshot used by dashboards and reminders."""
    today = today or date.today()
    start, end = payroll_period_for(today)
    deadline = period_deadline(end)
    days_left = (deadline - today).days
    return {
        "period_start": start,
        "period_end": end,
        "deadline": deadline,
        "pay_date": period_pay_date(start, end),
        "deadline_label": deadline_label(end),
        "days_until_deadline": days_left,
        "in_reminder_window": 0 <= days_left <= REMINDER_DAYS,
        "is_deadline_day": days_left == 0,
        "past_deadline": days_left < 0,
    }


def reviewed_sheet_covering(db: Session, va_id, work_date: date) -> TimesheetSubmission | None:
    return (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == va_id,
            TimesheetSubmission.period_start <= work_date,
            TimesheetSubmission.period_end >= work_date,
            TimesheetSubmission.status == TimesheetStatus.reviewed,
        )
        .first()
    )


def resolve_payable_on(db: Session, va_id, work_date: date) -> date | None:
    """If work_date falls in an already-approved timesheet, roll pay to the next period start.

    Returns None when the entry is paid in the normal period of work_date.
    """
    sheet = reviewed_sheet_covering(db, va_id, work_date)
    if not sheet:
        return None
    return next_period_start(sheet.period_end)


def effective_pay_date(work_date: date, payable_on: date | None) -> date:
    return payable_on or work_date


def va_has_submitted(db: Session, va_id, period_start: date, period_end: date) -> bool:
    row = (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == va_id,
            TimesheetSubmission.period_start == period_start,
            TimesheetSubmission.period_end == period_end,
        )
        .first()
    )
    return row is not None


def active_vas(db: Session) -> list[VA]:
    return (
        db.query(VA)
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active.is_(True), User.role == UserRole.va, User.is_active.is_(True))
        .order_by(VA.name)
        .all()
    )


def pay_date_expr():
    """SQL expression: coalesce(payable_on, work_date) for payroll period matching."""
    from sqlalchemy import func
    from app.models import WorkLog

    return func.coalesce(WorkLog.payable_on, WorkLog.work_date)


def filter_logs_in_pay_period(query, start: date, end: date):
    """Restrict a WorkLog query to logs whose payroll date falls in [start, end]."""
    eff = pay_date_expr()
    return query.filter(eff >= start, eff <= end)


def va_cannot_edit_log(db: Session, va_id, work_date: date, payable_on: date | None) -> bool:
    """True when the log's payroll period already has an approved (reviewed) timesheet."""
    eff = effective_pay_date(work_date, payable_on)
    return reviewed_sheet_covering(db, va_id, eff) is not None
