"""Reject duplicate / overlapping time entries for the same VA on the same day."""

from datetime import date, time
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import WorkLog, WorkLogStatus

ACTIVE_STATUSES = (
    WorkLogStatus.submitted,
    WorkLogStatus.approved,
    WorkLogStatus.invoiced,
)


def _to_minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def ranges_overlap(start_a: time, end_a: time, start_b: time, end_b: time) -> bool:
    """True when [start, end) intervals overlap. Overnight spans are expanded past midnight."""
    a0, a1 = _to_minutes(start_a), _to_minutes(end_a)
    b0, b1 = _to_minutes(start_b), _to_minutes(end_b)
    if a1 <= a0:
        a1 += 24 * 60
    if b1 <= b0:
        b1 += 24 * 60
    return a0 < b1 and b0 < a1


def assert_no_time_overlap(
    db: Session,
    *,
    va_id: UUID,
    work_date: date,
    start_time: time,
    end_time: time,
    exclude_id: UUID | None = None,
) -> None:
    q = db.query(WorkLog).filter(
        WorkLog.va_id == va_id,
        WorkLog.work_date == work_date,
        WorkLog.status.in_(ACTIVE_STATUSES),
    )
    if exclude_id is not None:
        q = q.filter(WorkLog.id != exclude_id)

    for other in q.all():
        if ranges_overlap(start_time, end_time, other.start_time, other.end_time):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Overlapping time entry on {work_date}: "
                    f"you already have {other.start_time.strftime('%H:%M')}–{other.end_time.strftime('%H:%M')} "
                    f"({other.hours} hrs). Pick a different time range."
                ),
            )
