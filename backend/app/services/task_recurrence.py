"""Compute next due dates and spawn the next task in a recurring series."""
from __future__ import annotations

import calendar
import uuid
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Task, TaskRecurrence, TaskStatus


def _add_months(d: date, months: int) -> date:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def _add_years(d: date, years: int) -> date:
    try:
        return date(d.year + years, d.month, d.day)
    except ValueError:
        # Feb 29 → Feb 28 on non-leap years
        return date(d.year + years, d.month, 28)


def next_due_date(
    from_date: date,
    recurrence: TaskRecurrence | str,
    *,
    interval: int = 1,
    unit: str | None = None,
    weekdays: list[int] | None = None,
) -> date | None:
    """Return the next due date after `from_date` for the given schedule."""
    if isinstance(recurrence, str):
        recurrence = TaskRecurrence(recurrence)
    if recurrence == TaskRecurrence.none:
        return None

    interval = max(1, int(interval or 1))

    if recurrence == TaskRecurrence.daily:
        return from_date + timedelta(days=interval)
    if recurrence == TaskRecurrence.weekly:
        return from_date + timedelta(weeks=interval)
    if recurrence == TaskRecurrence.biweekly:
        return from_date + timedelta(weeks=2)
    if recurrence == TaskRecurrence.monthly:
        return _add_months(from_date, interval)
    if recurrence == TaskRecurrence.annually:
        return _add_years(from_date, interval)
    if recurrence == TaskRecurrence.weekdays:
        # Next calendar weekday (Mon–Fri)
        d = from_date + timedelta(days=1)
        while d.weekday() >= 5:  # Sat/Sun
            d += timedelta(days=1)
        return d
    if recurrence == TaskRecurrence.custom:
        u = (unit or "day").lower()
        if u == "day":
            return from_date + timedelta(days=interval)
        if u == "week":
            days = sorted({int(x) % 7 for x in (weekdays or [from_date.weekday()])})
            if interval <= 1:
                d = from_date + timedelta(days=1)
                for _ in range(14):
                    if d.weekday() in days:
                        return d
                    d += timedelta(days=1)
                return from_date + timedelta(weeks=1)
            d = from_date + timedelta(weeks=interval)
            for _ in range(7):
                if d.weekday() in days:
                    return d
                d += timedelta(days=1)
            return from_date + timedelta(weeks=interval)
        if u == "month":
            return _add_months(from_date, interval)
        if u == "year":
            return _add_years(from_date, interval)
        return from_date + timedelta(days=interval)
    return None


def spawn_next_occurrence(db: Session, done_task: Task) -> Task | None:
    """If `done_task` is recurring, create the next open occurrence and return it."""
    if not done_task.recurrence or done_task.recurrence == TaskRecurrence.none:
        return None

    base = done_task.due_date or date.today()
    nxt = next_due_date(
        base,
        done_task.recurrence,
        interval=done_task.recurrence_interval or 1,
        unit=done_task.recurrence_unit,
        weekdays=done_task.recurrence_weekdays,
    )
    if not nxt:
        return None
    if done_task.recurrence_until and nxt > done_task.recurrence_until:
        return None

    # Avoid duplicate open tasks already spawned for this due date in the series
    series = done_task.series_id or done_task.id
    existing = (
        db.query(Task)
        .filter(
            Task.series_id == series,
            Task.due_date == nxt,
            Task.status != TaskStatus.done,
        )
        .first()
    )
    if existing:
        return None

    span_days = 0
    if done_task.start_date and done_task.due_date:
        span_days = (done_task.due_date - done_task.start_date).days
    next_start = nxt - timedelta(days=span_days) if span_days > 0 else None

    max_pos = db.query(func.coalesce(func.max(Task.position), 0)).filter(Task.status == TaskStatus.todo).scalar() or 0
    child = Task(
        id=uuid.uuid4(),
        title=done_task.title,
        description=done_task.description,
        client_id=done_task.client_id,
        sub_client_id=done_task.sub_client_id,
        project_id=done_task.project_id,
        assignee_va_id=done_task.assignee_va_id,
        created_by=done_task.created_by,
        status=TaskStatus.todo,
        priority=done_task.priority,
        start_date=next_start,
        due_date=nxt,
        estimated_hours=done_task.estimated_hours,
        position=int(max_pos) + 1,
        tags=list(done_task.tags) if done_task.tags else None,
        checklist=[{"text": c.get("text"), "done": False} for c in (done_task.checklist or [])] or None,
        recurrence=done_task.recurrence,
        recurrence_interval=done_task.recurrence_interval or 1,
        recurrence_unit=done_task.recurrence_unit,
        recurrence_weekdays=list(done_task.recurrence_weekdays) if done_task.recurrence_weekdays else None,
        recurrence_until=done_task.recurrence_until,
        series_id=series,
        parent_task_id=done_task.id,
    )
    # Ensure the completed task carries the series id for future lookups
    if not done_task.series_id:
        done_task.series_id = series
    db.add(child)
    return child


def recurrence_label(
    recurrence: TaskRecurrence | str | None,
    *,
    interval: int = 1,
    unit: str | None = None,
    weekdays: list[int] | None = None,
) -> str | None:
    if not recurrence or recurrence == TaskRecurrence.none or recurrence == "none":
        return None
    labels = {
        "daily": "Daily",
        "weekly": "Weekly",
        "weekdays": "Mon–Fri",
        "biweekly": "Every 2 weeks",
        "monthly": "Monthly",
        "annually": "Annually",
    }
    key = recurrence.value if isinstance(recurrence, TaskRecurrence) else str(recurrence)
    if key == "custom":
        u = (unit or "day").lower()
        unit_label = {"day": "day", "week": "week", "month": "month", "year": "year"}.get(u, u)
        plural = "s" if interval != 1 else ""
        base = f"Every {interval} {unit_label}{plural}"
        if u == "week" and weekdays:
            names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            days = ", ".join(names[i] for i in sorted(weekdays) if 0 <= i <= 6)
            return f"{base} ({days})" if days else base
        return base
    return labels.get(key, key)
