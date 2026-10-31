from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP


def calculate_hours(start: time, end: time) -> Decimal:
    start_dt = datetime.combine(datetime.today(), start)
    end_dt = datetime.combine(datetime.today(), end)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)
    diff = end_dt - start_dt
    hours = Decimal(str(diff.total_seconds() / 3600))
    return hours.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def hours_from_duration(hours: int, minutes: int) -> Decimal:
    """Total hours from a typed duration, e.g. 2 hours and 30 minutes."""
    if hours < 0 or hours > 24 or minutes < 0 or minutes > 59:
        raise ValueError("Enter hours from 0 to 24 and minutes from 0 to 59.")
    total_minutes = hours * 60 + minutes
    if total_minutes <= 0:
        raise ValueError("Enter how long you worked — hours, minutes, or both.")
    if total_minutes > 24 * 60:
        raise ValueError("One entry can be at most 24 hours.")
    return (Decimal(total_minutes) / Decimal(60)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def resolve_manual_time(
    *,
    entry_mode: str | None,
    start: time | None,
    end: time | None,
    duration_hours: int | None,
    duration_minutes: int | None,
) -> tuple[str, time | None, time | None, Decimal]:
    """Return (mode, start, end, hours). Duration entries have no clock range."""
    mode = entry_mode or "range"
    if mode == "duration":
        return (
            "duration",
            None,
            None,
            hours_from_duration(duration_hours or 0, duration_minutes or 0),
        )
    if start is None or end is None:
        raise ValueError("Enter a start time and an end time, or switch to hours and minutes.")
    return "range", start, end, calculate_hours(start, end)


def calculate_pay(hours: Decimal, rate: Decimal) -> Decimal:
    return (hours * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
