from datetime import date, timedelta
from calendar import monthrange


def get_billing_period(year: int, month: int, cutoff: int) -> tuple[date, date, str]:
    """Return period start, end, and label for billing cutoff (15 or 30).

    cutoff 15 → 1st–15th; cutoff 30 → 16th–end of month.
    """
    month_name = date(year, month, 1).strftime("%b")
    last_day = monthrange(year, month)[1]
    if cutoff == 15:
        start = date(year, month, 1)
        end = date(year, month, 15)
        label = f"{month_name} 1 – {month_name} 15, {year}"
    else:
        start = date(year, month, 16)
        end = date(year, month, last_day)
        label = f"{month_name} 16 – {month_name} {last_day}, {year}"
    return start, end, label


def get_week_period(which: str, ref: date | None = None) -> tuple[date, date]:
    """Return Monday-Sunday for this_week or last_week."""
    today = ref or date.today()
    monday = today - timedelta(days=today.weekday())
    if which == "last_week":
        monday -= timedelta(days=7)
    sunday = monday + timedelta(days=6)
    return monday, sunday


def next_invoice_number(existing_numbers: list[str], year: int | None = None) -> str:
    year = year or date.today().year
    prefix = f"SHC-{year}-"
    seq = 0
    for num in existing_numbers:
        if num.startswith(prefix):
            try:
                seq = max(seq, int(num.split("-")[-1]))
            except ValueError:
                pass
    return f"{prefix}{seq + 1:03d}"
