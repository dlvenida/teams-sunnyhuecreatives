"""Compute years/months with the company from a hire/start date."""
from __future__ import annotations

from datetime import date


def tenure_parts(hire_date: date | None, *, as_of: date | None = None) -> tuple[int, int] | None:
    if not hire_date:
        return None
    today = as_of or date.today()
    if hire_date > today:
        return (0, 0)
    years = today.year - hire_date.year
    months = today.month - hire_date.month
    if today.day < hire_date.day:
        months -= 1
    if months < 0:
        years -= 1
        months += 12
    if years < 0:
        return (0, 0)
    return (years, months)


def tenure_label(hire_date: date | None, *, company: str = "Sunny Hue Creatives", as_of: date | None = None) -> str | None:
    parts = tenure_parts(hire_date, as_of=as_of)
    if parts is None:
        return None
    years, months = parts
    if years == 0 and months == 0:
        bit = "Less than a month"
    elif years == 0:
        bit = f"{months} month{'s' if months != 1 else ''}"
    elif months == 0:
        bit = f"{years} year{'s' if years != 1 else ''}"
    else:
        bit = f"{years} year{'s' if years != 1 else ''} and {months} month{'s' if months != 1 else ''}"
    return f"{bit} with {company}"
