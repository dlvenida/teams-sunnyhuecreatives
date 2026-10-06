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


def calculate_pay(hours: Decimal, rate: Decimal) -> Decimal:
    return (hours * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
