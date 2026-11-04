"""Per-period Fixed Package overrides. They never change the saved VA Rate."""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import PackagePeriodOverride

MONEY = Decimal("0.01")
NOTE_LIMIT = 500


def quantize_money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def effective_package_amount(
    calculated: Decimal,
    *,
    skipped: bool = False,
    amount: Decimal | None = None,
) -> tuple[Decimal, bool, bool]:
    """Return (effective pay, skipped, adjusted).

    Skipped pays 0. An amount replaces the calculated package for this period only.
    The same number as the calculation is not an adjustment.
    """
    base = quantize_money(calculated)
    if skipped:
        return Decimal("0.00"), True, False
    if amount is None:
        return base, False, False
    chosen = quantize_money(amount)
    if chosen < 0:
        raise ValueError("Amount cannot be negative")
    return chosen, False, chosen != base


@dataclass
class OverridePlan:
    action: str  # "save" or "delete"
    skipped: bool
    amount: Decimal | None
    note: str | None


def plan_override(
    calculated: Decimal,
    *,
    skipped: bool,
    amount: Decimal | None,
    note: str | None,
) -> OverridePlan:
    """Decide what to store. A blank override is deleted so the next read uses the rate."""
    if amount is not None and amount < 0:
        raise ValueError("Amount cannot be negative")
    stored_amount = None if amount is None else quantize_money(amount)
    if stored_amount is not None and stored_amount == quantize_money(calculated):
        stored_amount = None
    cleaned = (note or "").strip()
    if len(cleaned) > NOTE_LIMIT:
        raise ValueError("Note is too long")
    cleaned_note = cleaned or None
    if not skipped and stored_amount is None and cleaned_note is None:
        return OverridePlan("delete", False, None, None)
    return OverridePlan("save", bool(skipped), stored_amount, cleaned_note)


def apply_for_period(
    calculated: Decimal,
    overrides_by_period: dict[tuple[date, date], tuple[bool, Decimal | None]],
    period: tuple[date, date],
) -> tuple[Decimal, bool, bool]:
    """An override applies only to its own period. The next period keeps the calculated amount."""
    found = overrides_by_period.get(period)
    if not found:
        return effective_package_amount(calculated)
    skipped, amount = found
    return effective_package_amount(calculated, skipped=skipped, amount=amount)


def load_overrides(
    db: Session,
    va_ids: set[UUID],
    period_start: date,
    period_end: date,
) -> dict[tuple[UUID, UUID], PackagePeriodOverride]:
    if not va_ids:
        return {}
    rows = (
        db.query(PackagePeriodOverride)
        .filter(
            PackagePeriodOverride.va_id.in_(va_ids),
            PackagePeriodOverride.period_start == period_start,
            PackagePeriodOverride.period_end == period_end,
        )
        .all()
    )
    return {(row.va_id, row.client_id): row for row in rows}


def describe_package_review(
    calculated: Decimal,
    *,
    skipped: bool = False,
    amount: Decimal | None = None,
    note: str | None = None,
) -> dict:
    """Fields the timesheet review screen shows for one Fixed Package client."""
    effective, is_skipped, adjusted = effective_package_amount(calculated, skipped=skipped, amount=amount)
    reason = (note or "").strip() or None
    return {
        "calculated_amount": quantize_money(calculated),
        "amount": effective,
        "pay_this_period": not is_skipped,
        "reason": reason,
        "adjusted": adjusted,
    }


def include_package_pay(role: str) -> bool:
    """Project Managers never receive package amounts or edit controls."""
    return role == "admin"


def period_is_paid(db: Session, va_id: UUID, period_start: date, period_end: date) -> bool:
    from app.models import PayrollRun

    return (
        db.query(PayrollRun.id)
        .filter(
            PayrollRun.va_id == va_id,
            PayrollRun.period_start == period_start,
            PayrollRun.period_end == period_end,
        )
        .first()
        is not None
    )
