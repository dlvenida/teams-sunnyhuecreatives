"""Compute next due dates and spawn the next task in a recurring series.

Rules:
- Next occurrence is created when the current task is marked Done.
- If the current open task is overdue, we do NOT spawn a duplicate — wait until Done.
- Spawning advances the due date until it is today or in the future (late completions).
- Cycle continues until recurrence is set to none or recurrence_until is passed.
"""
from __future__ import annotations

import calendar
import uuid
from datetime import date, timedelta

from sqlalchemy import func, or_
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


def next_future_due_date(
    from_date: date,
    recurrence: TaskRecurrence | str,
    *,
    interval: int = 1,
    unit: str | None = None,
    weekdays: list[int] | None = None,
    until: date | None = None,
    not_before: date | None = None,
) -> date | None:
    """Advance the schedule until the due date is on/after `not_before` (default: today)."""
    floor = not_before or date.today()
    cursor = from_date
    nxt = next_due_date(
        cursor, recurrence, interval=interval, unit=unit, weekdays=weekdays,
    )
    guard = 0
    while nxt and nxt < floor and guard < 500:
        cursor = nxt
        nxt = next_due_date(
            cursor, recurrence, interval=interval, unit=unit, weekdays=weekdays,
        )
        guard += 1
    if nxt and until and nxt > until:
        return None
    return nxt


def _series_id(task: Task):
    return task.series_id or task.id


def _has_open_successor(db: Session, series, after_task_id) -> bool:
    """True if an open (not done) task already exists in this series after this one."""
    q = db.query(Task).filter(
        or_(Task.series_id == series, Task.id == series),
        Task.status != TaskStatus.done,
        Task.id != after_task_id,
    )
    return q.first() is not None


def spawn_next_occurrence(db: Session, done_task: Task) -> Task | None:
    """If `done_task` is recurring and Done, create the next open occurrence and return it.

    Does nothing if recurrence is off, end date passed, or an open successor already exists
    (prevents duplicates while an overdue copy is still unfinished).
    """
    if not done_task.recurrence or done_task.recurrence == TaskRecurrence.none:
        return None
    if done_task.status != TaskStatus.done:
        # Never auto-spawn a twin while the current task is still open / overdue
        return None

    series = _series_id(done_task)
    if not done_task.series_id:
        done_task.series_id = series

    if _has_open_successor(db, series, done_task.id):
        return None

    base = done_task.due_date or date.today()
    nxt = next_future_due_date(
        base,
        done_task.recurrence,
        interval=done_task.recurrence_interval or 1,
        unit=done_task.recurrence_unit,
        weekdays=done_task.recurrence_weekdays,
        until=done_task.recurrence_until,
        not_before=date.today(),
    )
    if not nxt:
        return None

    # Avoid duplicate open tasks already spawned for this due date in the series
    existing = (
        db.query(Task)
        .filter(
            or_(Task.series_id == series, Task.id == series),
            Task.due_date == nxt,
            Task.status != TaskStatus.done,
        )
        .first()
    )
    if existing:
        return None

    span_days = 0
    if done_task.start_date and done_task.due_date:
        span_days = max(0, (done_task.due_date - done_task.start_date).days)
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
        assignee_role=done_task.assignee_role,
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
    db.add(child)
    return child


def recover_missing_occurrences(db: Session, limit: int = 50) -> list[Task]:
    """Create next tasks for Done recurring parents that never got a successor (recovery)."""
    done_recurring = (
        db.query(Task)
        .filter(
            Task.status == TaskStatus.done,
            Task.recurrence != TaskRecurrence.none,
            Task.recurrence.isnot(None),
        )
        .order_by(Task.completed_at.desc().nullslast())
        .limit(200)
        .all()
    )
    spawned: list[Task] = []
    seen_series: set = set()
    for t in done_recurring:
        sid = _series_id(t)
        if sid in seen_series:
            continue
        # Only recover from the latest done task in the series
        if _has_open_successor(db, sid, t.id):
            seen_series.add(sid)
            continue
        child = spawn_next_occurrence(db, t)
        seen_series.add(sid)
        if child:
            spawned.append(child)
            if len(spawned) >= limit:
                break
    return spawned


def overdue_recurring_tasks(db: Session, limit: int = 20) -> list[Task]:
    """Open repeating tasks past their deadline — warn admin; do not auto-spawn next."""
    today = date.today()
    return (
        db.query(Task)
        .filter(
            Task.status != TaskStatus.done,
            Task.recurrence != TaskRecurrence.none,
            Task.recurrence.isnot(None),
            Task.due_date.isnot(None),
            Task.due_date < today,
        )
        .order_by(Task.due_date.asc())
        .limit(limit)
        .all()
    )


def due_unfinished_repeating(db: Session, limit: int = 30) -> list[Task]:
    """Open repeating tasks whose repeat date has arrived. Do not spawn a duplicate."""
    today = date.today()
    return (
        db.query(Task)
        .options()
        .filter(
            Task.status != TaskStatus.done,
            Task.recurrence != TaskRecurrence.none,
            Task.recurrence.isnot(None),
            Task.due_date.isnot(None),
            Task.due_date <= today,
        )
        .order_by(Task.due_date.asc())
        .limit(limit)
        .all()
    )


def process_due_repeating(db: Session) -> dict:
    """On the repeat date: create the next copy only if the current one is already Done.

    If it is still open, warn admin and Project Manager and do not make a duplicate.
    """
    spawned = recover_missing_occurrences(db)
    due = due_unfinished_repeating(db)
    warned = 0
    if due:
        from app.models import User, UserRole
        from app.services.email import branded_email, send_email
        from app.services.notifications import admin_and_auditor_user_ids, push
        from app.config import settings

        for task in due:
            title = f"Repeating task not completed on time: {task.title}"
            detail = (
                f"Due {task.due_date}. The next copy waits until this one is marked Done "
                "so it is not duplicated."
            )
            link = f"/tasks?task={task.id}"
            recipients = admin_and_auditor_user_ids(db)
            fresh = []
            from app.models import Notification
            from datetime import datetime, timedelta, timezone
            since = datetime.now(timezone.utc) - timedelta(hours=20)
            for uid in recipients:
                already = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == uid,
                        Notification.title == title,
                        Notification.created_at >= since,
                    )
                    .first()
                )
                if not already:
                    fresh.append(uid)
            if not fresh:
                continue
            push(db, fresh, "task", title, detail, link)
            warned += 1
            users = db.query(User).filter(User.id.in_(fresh), User.is_active.is_(True)).all()
            html = branded_email(
                title,
                detail,
                f"<p><strong>{task.title}</strong> was due {task.due_date} and is still open.</p>"
                "<p>The next repeating copy is not created until this one is marked Done.</p>",
                "Open the task",
                f"{(settings.app_url or '').rstrip('/')}/admin/tasks?task={task.id}",
            )
            for user in users:
                if user.role not in (UserRole.admin, UserRole.auditor) or not user.email:
                    continue
                send_email(user.email, title, html, template_key="task_updated")
    return {"spawned": spawned, "warned": warned}


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
