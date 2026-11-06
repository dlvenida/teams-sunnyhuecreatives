"""Semi-monthly VA payroll calendar for Sunny Hue Creatives.

Cutoff / pay schedule:
  • Period 1–15  → submit by the 15th  → paid on the 16th
  • Period 16–EOM → submit by last day → paid on the 1st of next month
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

MANILA = ZoneInfo("Asia/Manila")

from app.models import TimesheetStatus, TimesheetSubmission, VA, User, UserRole

REMINDER_DAYS = 3  # show / notify this many days before the submit deadline


def payroll_period_for(d: date) -> tuple[date, date]:
    """Return (period_start, period_end) containing date d."""
    last = monthrange(d.year, d.month)[1]
    if d.day <= 15:
        return date(d.year, d.month, 1), date(d.year, d.month, 15)
    return date(d.year, d.month, 16), date(d.year, d.month, last)


def manila_today(now: datetime | None = None) -> date:
    """Calendar date in Asia/Manila. Payroll halves follow this, not the server UTC date."""
    current = now or datetime.now(MANILA)
    if current.tzinfo is None:
        current = current.replace(tzinfo=MANILA)
    return current.astimezone(MANILA).date()


def calendar_half(which: str, today: date | None = None) -> tuple[date, date]:
    """1st-15th or 16th-end of the calendar month that contains today.

    `today` is the Asia/Manila date. Both presets are that month, so a VA on the 6th
    can still open the 16th-end half of the same month.
    """
    today = today or manila_today()
    last = monthrange(today.year, today.month)[1]
    if which == "first_half":
        return date(today.year, today.month, 1), date(today.year, today.month, 15)
    if which == "second_half":
        return date(today.year, today.month, 16), date(today.year, today.month, last)
    raise ValueError("which must be first_half or second_half")


def snap_payroll_period(start: date, end: date) -> tuple[date, date]:
    """Turn a Manila-midnight period that was saved as the previous UTC date back into the real half.

    Nov 1 00:00 in Asia/Manila is still Oct 31 in UTC, and Nov 15 00:00 is Nov 14.
    A timesheet saved that way reads Oct 31 to Nov 14 and overlaps both bi-weekly halves,
    so the package total becomes the whole month. The real period is Nov 1 to Nov 15.
    """
    if end.day == 14 and start.day >= 28:
        next_year = start.year + 1 if start.month == 12 else start.year
        next_month = 1 if start.month == 12 else start.month + 1
        last_of_start = monthrange(start.year, start.month)[1]
        if start.day == last_of_start and end.year == next_year and end.month == next_month:
            return date(end.year, end.month, 1), date(end.year, end.month, 15)
    if start.day == 15 and start.year == end.year and start.month == end.month:
        last = monthrange(end.year, end.month)[1]
        if end.day == last - 1:
            return date(start.year, start.month, 16), end.replace(day=last)
    return start, end


def period_lookup_keys(start: date, end: date) -> set[tuple[date, date]]:
    """Canonical period plus the one-day-early form already stored on some timesheets."""
    snapped = snap_payroll_period(start, end)
    keys = {(start, end), snapped}
    if snapped[0].day == 1 and snapped[1].day == 15 and snapped[0].month == snapped[1].month:
        keys.add((snapped[0] - timedelta(days=1), date(snapped[1].year, snapped[1].month, 14)))
    elif snapped[0].day == 16 and snapped[0].month == snapped[1].month:
        last = monthrange(snapped[1].year, snapped[1].month)[1]
        if snapped[1].day == last:
            keys.add((date(snapped[0].year, snapped[0].month, 15), date(snapped[1].year, snapped[1].month, last - 1)))
    return keys


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
