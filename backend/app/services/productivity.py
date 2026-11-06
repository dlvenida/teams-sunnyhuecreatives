"""Plain productivity for every VA.

The percentage is how many expected weekdays in the current week already have
logged time, capped at 100. Task counts and dues sit beside it. This does not
change clock-in, work-log approval, or payroll.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models import ClockStatus, Task, TaskStatus, TimeClockEntry, TimesheetSubmission, User, UserRole, VA, WorkLog
from app.services.payroll_calendar import manila_today, payroll_period_for

MANILA = ZoneInfo("Asia/Manila")
OPEN_STATUSES = {
    TaskStatus.todo,
    TaskStatus.in_progress,
    TaskStatus.in_review,
    TaskStatus.approved,
    TaskStatus.blocked,
}
STATUS_WORDS = {
    "todo": "To do",
    "in_progress": "In progress",
    "in_review": "In review",
    "approved": "Approved",
    "blocked": "Blocked",
    "done": "Done",
}
MONEY_KEYS = ("rate", "pay", "payout", "invoice", "amount", "salary", "wage", "price", "profit", "billing", "currency", "usd", "php", "payroll")


def week_bounds(today: date) -> tuple[date, date]:
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


def expected_workdays(today: date) -> list[date]:
    """Monday through Friday, up to and including today. Future days are not expected yet."""
    monday, _sunday = week_bounds(today)
    days = []
    for offset in range(5):
        day = monday + timedelta(days=offset)
        if day <= today:
            days.append(day)
    return days


def previous_payroll_period(today: date) -> tuple[date, date]:
    start, _end = payroll_period_for(today)
    if start.day == 1:
        previous_end = start - timedelta(days=1)
        return date(previous_end.year, previous_end.month, 16), previous_end
    return date(start.year, start.month, 1), date(start.year, start.month, 15)


def productivity_from_counts(
    *,
    days_logged: int,
    expected_days: int,
    tasks_done_this_week: int,
    tasks_open: int,
) -> dict:
    if expected_days <= 0:
        percentage = 100 if days_logged else 0
        status = "on_track"
        label = "On track"
    else:
        percentage = min(100, round(100 * days_logged / expected_days))
        if days_logged <= 0:
            status = "no_hours"
            label = "No hours yet"
        elif days_logged >= expected_days:
            status = "on_track"
            label = "On track"
        else:
            status = "behind"
            label = "Behind"
    if expected_days == 1:
        day_words = "1 workday"
    else:
        day_words = f"{expected_days} workdays"
    summary = (
        f"Logged time on {days_logged} of {day_words} this week. "
        f"{tasks_done_this_week} done this week, {tasks_open} still open."
    )
    return {
        "percentage": percentage,
        "status": status,
        "status_label": label,
        "days_logged": days_logged,
        "expected_workdays": expected_days,
        "tasks_done_this_week": tasks_done_this_week,
        "tasks_open": tasks_open,
        "summary": summary,
    }


def bucket_for_task(due: date | None, status: str, today: date) -> str | None:
    if status == TaskStatus.done.value or status == "done":
        return None
    if due and due < today:
        return "overdue"
    if due == today:
        return "due_today"
    if due and today < due <= today + timedelta(days=7):
        return "due_soon"
    return "pending"


def timesheet_action(status: str | None, *, which: str, start: date, end: date, link: str) -> dict | None:
    """A timesheet still waiting on this VA. Submitted and reviewed sheets are not dues."""
    period = f"{start.strftime('%b')} {start.day} to {end.strftime('%b')} {end.day}"
    if status is None:
        return {
            "kind": "timesheet",
            "tone": "due",
            "title": "Timesheet not submitted",
            "detail": f"{which} timesheet, {period}",
            "link": link,
        }
    if status == "rejected":
        return {
            "kind": "timesheet",
            "tone": "overdue",
            "title": "Timesheet was sent back",
            "detail": f"{which} timesheet, {period}. Submit it again.",
            "link": link,
        }
    return None


def _status_value(status) -> str:
    return status.value if isinstance(status, TaskStatus) else str(status)


def _task_row(task: Task, today: date, link_base: str) -> dict:
    status = _status_value(task.status)
    bucket = bucket_for_task(task.due_date, status, today)
    return {
        "id": str(task.id),
        "title": task.title,
        "client_name": task.client.name if task.client else "",
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "task_status": status,
        "task_status_label": STATUS_WORDS.get(status, status),
        "bucket": bucket,
        "link": f"{link_base}?task={task.id}",
    }


def _sheet_status(db: Session, va_id, start: date, end: date) -> str | None:
    row = (
        db.query(TimesheetSubmission)
        .filter(
            TimesheetSubmission.va_id == va_id,
            TimesheetSubmission.period_start == start,
            TimesheetSubmission.period_end == end,
        )
        .first()
    )
    if not row:
        return None
    return row.status.value if hasattr(row.status, "value") else str(row.status)


def _logged_days(db: Session, va_id, days: list[date], today: date) -> tuple[int, str]:
    if not days:
        return 0, "0.00"
    logs = (
        db.query(WorkLog.work_date, func.coalesce(func.sum(WorkLog.hours), 0))
        .filter(WorkLog.va_id == va_id, WorkLog.work_date >= days[0], WorkLog.work_date <= days[-1])
        .group_by(WorkLog.work_date)
        .all()
    )
    hours_by_day = {row[0]: row[1] for row in logs}
    logged = {day for day, hours in hours_by_day.items() if hours and hours > 0 and day in days}
    if today in days and today not in logged:
        live = (
            db.query(TimeClockEntry)
            .filter(
                TimeClockEntry.va_id == va_id,
                TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]),
            )
            .first()
        )
        if live and live.clock_in:
            clock_in = live.clock_in if live.clock_in.tzinfo else live.clock_in.replace(tzinfo=timezone.utc)
            if clock_in.astimezone(MANILA).date() == today:
                logged.add(today)
    total_hours = sum((hours for hours in hours_by_day.values() if hours), 0)
    return len(logged), f"{total_hours:.2f}"


def build_va_productivity(db: Session, va: VA, *, link_base: str, today: date | None = None) -> dict:
    today = today or manila_today()
    week_start, week_end = week_bounds(today)
    days = expected_workdays(today)
    tasks = (
        db.query(Task)
        .options(joinedload(Task.client))
        .filter(Task.assignee_va_id == va.id)
        .all()
    )
    done_this_week = []
    open_tasks = []
    for task in tasks:
        if task.status == TaskStatus.done:
            completed = task.completed_at
            if completed is not None:
                completed_day = completed.date() if completed.tzinfo is None else completed.astimezone(MANILA).date()
                if week_start <= completed_day <= week_end:
                    done_this_week.append(task)
            continue
        open_tasks.append(task)

    days_logged, hours = _logged_days(db, va.id, days, today)
    score = productivity_from_counts(
        days_logged=days_logged,
        expected_days=len(days),
        tasks_done_this_week=len(done_this_week),
        tasks_open=len(open_tasks),
    )
    grouped = {"overdue": [], "due_today": [], "due_soon": [], "pending": []}
    for task in open_tasks:
        row = _task_row(task, today, link_base)
        bucket = row.get("bucket") or "pending"
        grouped[bucket].append(row)
    for key in grouped:
        grouped[key].sort(key=lambda row: (row["due_date"] or "9999", row["title"].casefold()))

    current_start, current_end = payroll_period_for(today)
    previous_start, previous_end = previous_payroll_period(today)
    timesheet_link = "/va/payroll" if link_base.startswith("/va") else "/admin/payroll"
    timesheets = []
    for status, which, start, end in (
        (_sheet_status(db, va.id, current_start, current_end), "This", current_start, current_end),
        (_sheet_status(db, va.id, previous_start, previous_end), "Last", previous_start, previous_end),
    ):
        item = timesheet_action(status, which=which, start=start, end=end, link=timesheet_link)
        if item:
            timesheets.append(item)

    return {
        "va_id": str(va.id),
        "va_name": va.name,
        "today": today.isoformat(),
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "hours_this_week": hours,
        **score,
        "counts": {
            "overdue": len(grouped["overdue"]),
            "due_today": len(grouped["due_today"]),
            "due_soon": len(grouped["due_soon"]),
            "pending": len(grouped["pending"]),
            "timesheet": len(timesheets),
            "still_open": len(open_tasks),
        },
        "dues": {**grouped, "timesheets": timesheets},
    }


def assert_no_money_keys(payload) -> None:
    """Walk a response and refuse pay, rate, or invoice fields."""
    if isinstance(payload, dict):
        for key, value in payload.items():
            lowered = str(key).casefold()
            if any(word in lowered for word in MONEY_KEYS):
                raise AssertionError(f"Money field in productivity payload: {key}")
            assert_no_money_keys(value)
    elif isinstance(payload, list):
        for item in payload:
            assert_no_money_keys(item)


def team_productivity(db: Session, today: date | None = None, *, include_pay: bool = False) -> dict:
    today = today or manila_today()
    week_start, week_end = week_bounds(today)
    vas = (
        db.query(VA)
        .options(joinedload(VA.user))
        .join(User, VA.user_id == User.id)
        .filter(VA.is_active.is_(True), User.role == UserRole.va, User.is_active.is_(True))
        .order_by(VA.name)
        .all()
    )
    members = []
    for va in vas:
        full = build_va_productivity(db, va, link_base="/admin/tasks", today=today)
        preview = []
        for bucket in ("overdue", "due_today", "due_soon", "pending"):
            for row in full["dues"][bucket][:3]:
                preview.append({
                    "bucket": bucket,
                    "title": row["title"],
                    "client_name": row["client_name"],
                    "due_date": row["due_date"],
                    "task_status_label": row["task_status_label"],
                    "link": row["link"],
                })
            if len(preview) >= 6:
                break
        member = {
            "va_id": full["va_id"],
            "va_name": full["va_name"],
            "percentage": full["percentage"],
            "status": full["status"],
            "status_label": full["status_label"],
            "days_logged": full["days_logged"],
            "expected_workdays": full["expected_workdays"],
            "hours_this_week": full["hours_this_week"],
            "tasks_done_this_week": full["tasks_done_this_week"],
            "tasks_open": full["tasks_open"],
            "summary": full["summary"],
            "counts": full["counts"],
            "timesheet_waiting": full["counts"]["timesheet"] > 0,
            "dues_preview": preview,
        }
        if include_pay:
            from app.services.va_rates import own_month_pay

            pay = own_month_pay(db, va.id, today)
            member["month_pay"] = pay["month_pay"]
            member["period_pay"] = pay["period_pay"]
            member["pay_currency"] = pay["currency"]
            member["month_label"] = pay["month_label"]
            member["period_label"] = pay["period_label"]
        members.append(member)
    order = {"no_hours": 0, "behind": 1, "on_track": 2}
    members.sort(key=lambda row: (order.get(row["status"], 9), -row["counts"]["overdue"], -row["counts"]["pending"], row["va_name"].casefold()))
    return {
        "today": today.isoformat(),
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "members": members,
        "counts": {
            "on_track": len([row for row in members if row["status"] == "on_track"]),
            "behind": len([row for row in members if row["status"] == "behind"]),
            "no_hours": len([row for row in members if row["status"] == "no_hours"]),
        },
    }


def reporting_now() -> datetime:
    return datetime.now(MANILA)
