"""Resolve a manual time log as either a start/end range or a duration."""

from datetime import time
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status

from app.services.calculations import calculate_hours

MAX_ENTRY_MINUTES = 24 * 60


def resolve_timing(
    *,
    entry_mode: str | None,
    start_time: time | None,
    end_time: time | None,
    duration_hours: int | None,
    duration_minutes: int | None,
) -> tuple[str, Decimal, time | None, time | None]:
    """Return (entry_mode, hours, start_time, end_time). Duration logs store no clock times."""
    mode = (entry_mode or "range").strip().lower()
    if mode == "duration":
        if duration_hours is None or duration_minutes is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter hours and minutes.")
        if duration_hours < 0 or duration_hours > 24:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hours must be a whole number from 0 to 24.")
        if duration_minutes < 0 or duration_minutes > 59:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Minutes must be a whole number from 0 to 59.")
        total_minutes = duration_hours * 60 + duration_minutes
        if total_minutes <= 0:
            from app.services.task_board import ZERO_DURATION_MESSAGE
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ZERO_DURATION_MESSAGE)
        if total_minutes > MAX_ENTRY_MINUTES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A single entry cannot be more than 24 hours.")
        hours = (Decimal(total_minutes) / Decimal(60)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return "duration", hours, None, None
    if mode != "range":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose start and end time, or enter a duration.")
    if start_time is None or end_time is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start time and end time are required.")
    hours = calculate_hours(start_time, end_time)
    if hours <= 0 or hours > Decimal("24"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A single entry cannot be more than 24 hours.")
    return "range", hours, start_time, end_time


def timing_mode_for_update(body, log) -> str:
    """Which mode an edit should land in. Explicit fields win over the stored mode."""
    fields = getattr(body, "model_fields_set", set())
    if "entry_mode" in fields and getattr(body, "entry_mode", None):
        return str(body.entry_mode).strip().lower()
    if "duration_hours" in fields or "duration_minutes" in fields:
        return "duration"
    if ("start_time" in fields or "end_time" in fields) and (getattr(body, "start_time", None) or getattr(body, "end_time", None)):
        return "range"
    stored = getattr(log, "entry_mode", None) or ""
    if stored in ("duration", "range"):
        return stored
    if log.start_time is None or log.end_time is None:
        return "duration"
    return "range"


def apply_work_log_timing(db, log, body) -> bool:
    """Write hours and clock times when an edit touches them. Duration edits skip overlap."""
    fields = getattr(body, "model_fields_set", set())
    if not (fields & {"entry_mode", "start_time", "end_time", "duration_hours", "duration_minutes", "work_date"}):
        return False

    from app.services.work_log_overlap import assert_no_time_overlap

    mode = timing_mode_for_update(body, log)
    if mode == "duration":
        changing_amount = "duration_hours" in fields or "duration_minutes" in fields or (getattr(log, "entry_mode", None) != "duration" and "entry_mode" in fields)
        if changing_amount:
            mode, hours, start, end = resolve_timing(
                entry_mode="duration",
                start_time=None,
                end_time=None,
                duration_hours=getattr(body, "duration_hours", None),
                duration_minutes=getattr(body, "duration_minutes", None),
            )
        else:
            hours, start, end = log.hours, None, None
            mode = "duration"
    else:
        start_in = body.start_time if "start_time" in fields else log.start_time
        end_in = body.end_time if "end_time" in fields else log.end_time
        mode, hours, start, end = resolve_timing(
            entry_mode="range",
            start_time=start_in,
            end_time=end_in,
            duration_hours=None,
            duration_minutes=None,
        )
        assert_no_time_overlap(
            db,
            va_id=log.va_id,
            work_date=log.work_date,
            start_time=start,
            end_time=end,
            exclude_id=log.id,
        )
    log.entry_mode = mode
    log.start_time = start
    log.end_time = end
    log.hours = hours
    return True
