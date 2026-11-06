"""Hold a possible duplicate time log for a person to decide.

A clock entry and a manual duration for the same VA, client, task, and day, or a
short extra log beside a longer approved one, stay submitted. This never rejects
a log and never approves one. Rows that are already approved, invoiced, or
rejected are left alone.
"""
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session, joinedload

from app.models import WorkLog, WorkLogStatus
from app.services.log_display import log_task_name


def _status(log) -> str:
    status = getattr(log, "status", "")
    return status.value if hasattr(status, "value") else str(status or "")


def _hours(log) -> Decimal:
    return Decimal(str(getattr(log, "hours", 0) or 0))


def _minutes(hours: Decimal) -> str:
    minutes = int((hours * Decimal(60)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return f"{minutes}m"


def _task_key(log) -> str:
    name = log_task_name(log)
    if name:
        return " ".join(name.casefold().split())
    task_id = getattr(log, "task_id", None)
    return f"id:{task_id}" if task_id else ""


def _is_clock(log) -> bool:
    if (getattr(log, "source", None) or "") == "clock":
        return True
    if (getattr(log, "entry_mode", None) or "") == "duration":
        return False
    return getattr(log, "start_time", None) is not None and getattr(log, "end_time", None) is not None


def _is_manual_duration(log) -> bool:
    if _is_clock(log):
        return False
    if (getattr(log, "entry_mode", None) or "") == "duration":
        return True
    return getattr(log, "start_time", None) is None or getattr(log, "end_time", None) is None


def review_reason_for(candidate, others) -> str | None:
    """Why this open log should wait for review. None when nothing is similar."""
    if _status(candidate) in ("approved", "rejected", "invoiced"):
        return None
    key = _task_key(candidate)
    if not key:
        return None
    related = []
    candidate_id = getattr(candidate, "id", None)
    for other in others:
        if other is candidate or (candidate_id is not None and getattr(other, "id", None) == candidate_id):
            continue
        if _task_key(other) != key or _status(other) == "rejected":
            continue
        related.append(other)
    task = log_task_name(candidate) or "this task"
    mine = _hours(candidate)
    for other in related:
        pair = (_is_clock(candidate) and _is_manual_duration(other)) or (_is_manual_duration(candidate) and _is_clock(other))
        if pair and abs(mine - _hours(other)) <= Decimal("0.02"):
            if _is_clock(candidate):
                return (
                    f"This clock entry matches a manual duration for the same client and task on this day "
                    f"({task}, {_minutes(mine)}). It is in review so it can be approved or rejected."
                )
            return (
                f"This manual duration matches a clock entry for the same client and task on this day "
                f"({task}, {_minutes(mine)}). It is in review so it can be approved or rejected."
            )
    for other in related:
        if _status(other) not in ("approved", "invoiced"):
            continue
        theirs = _hours(other)
        if mine < theirs and mine <= Decimal("0.08") and theirs >= Decimal("0.16"):
            return (
                f"This short entry ({_minutes(mine)}) is beside a longer approved log for the same client and task "
                f"on this day ({task}, {_minutes(theirs)}). It is in review so it can be approved or rejected."
            )
    return None


def hold_open_matches(db: Session, anchor: WorkLog) -> None:
    """Mark still-open matches as waiting for review. Decided rows stay as they are."""
    rows = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.task))
        .filter(
            WorkLog.va_id == anchor.va_id,
            WorkLog.client_id == anchor.client_id,
            WorkLog.work_date == anchor.work_date,
        )
        .all()
    )
    if all(row.id != anchor.id for row in rows):
        rows.append(anchor)
    for row in rows:
        if _status(row) != WorkLogStatus.submitted.value:
            continue
        reason = review_reason_for(row, rows)
        if not reason:
            continue
        row.review_reason = reason
        row.status = WorkLogStatus.submitted
