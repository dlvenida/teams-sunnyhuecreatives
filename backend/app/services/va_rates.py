"""Resolve approved VA rates for logging and payroll."""
from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import PayType, RateStatus, SystemSetting, VARate
from app.services.calculations import calculate_pay


def _fallback_rate(db: Session) -> Decimal:
    row = db.query(SystemSetting).filter(SystemSetting.key == "company").first()
    if row and row.value and row.value.get("default_va_hourly_rate"):
        try:
            return Decimal(str(row.value["default_va_hourly_rate"]))
        except Exception:
            pass
    return Decimal("75.00")


def get_approved_rate(db: Session, va_id: UUID, client_id: UUID) -> VARate | None:
    """Most recent approved rate for this VA+client (prior approved stays while pending exists)."""
    return (
        db.query(VARate)
        .filter(VARate.va_id == va_id, VARate.client_id == client_id, VARate.status == RateStatus.approved)
        .order_by(VARate.reviewed_at.desc().nullslast(), VARate.created_at.desc())
        .first()
    )


def resolve_log_pay(db: Session, va_id: UUID, client_id: UUID, hours: Decimal) -> tuple[Decimal, Decimal, PayType | None]:
    """Return (va_rate, va_pay, pay_type). Package logs store rate amount but va_pay=0 (flat applied in payroll)."""
    rate = get_approved_rate(db, va_id, client_id)
    if not rate:
        fallback = _fallback_rate(db)
        return fallback, calculate_pay(hours, fallback), None
    if rate.pay_type == PayType.package:
        return rate.amount, Decimal("0.00"), PayType.package
    return rate.amount, calculate_pay(hours, rate.amount), PayType.hourly


def frequency_for_save(pay_type: PayType, raw: str | None) -> str | None:
    """Hourly rates do not use a frequency. New package rates default to bi-weekly."""
    if pay_type != PayType.package:
        return None
    value = (raw or "biweekly").strip().lower()
    if value not in ("monthly", "biweekly"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment frequency must be Monthly or Bi-weekly.")
    return value


def resolved_frequency(rate: VARate | None) -> str:
    """Null on an existing package rate means Monthly, so those payslips stay whole."""
    if rate is None or rate.pay_type != PayType.package:
        return "monthly"
    return rate.payment_frequency or "monthly"


def split_biweekly(monthly: Decimal) -> tuple[Decimal, Decimal]:
    """Split a monthly package into the 1st–15th and 16th–end amounts.

    The two halves always add back to the monthly total. An odd centavo goes on the second half.
    """
    cents = int((Decimal(monthly) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    first = cents // 2
    second = cents - first
    return (Decimal(first) / Decimal(100)).quantize(Decimal("0.01")), (Decimal(second) / Decimal(100)).quantize(Decimal("0.01"))


def _overlaps(a0: date, a1: date, b0: date, b1: date) -> bool:
    return a0 <= b1 and b0 <= a1


def package_amount_for_window(monthly: Decimal, frequency: str | None, period_start: date, period_end: date) -> Decimal:
    """Amount due inside this payroll window.

    Bi-weekly: half on each standard period the window touches (1st–15th and 16th–end).
    Monthly, including a blank frequency: the full amount once, on the 1st–15th only.
    """
    freq = frequency or "monthly"
    amount = Decimal(monthly).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    first_share, second_share = split_biweekly(amount) if freq == "biweekly" else (amount, Decimal("0.00"))
    total = Decimal("0.00")
    year, month = period_start.year, period_start.month
    while date(year, month, 1) <= period_end:
        last = monthrange(year, month)[1]
        if _overlaps(period_start, period_end, date(year, month, 1), date(year, month, 15)):
            total += first_share
        if freq == "biweekly" and _overlaps(period_start, period_end, date(year, month, 16), date(year, month, last)):
            total += second_share
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return total.quantize(Decimal("0.01"))


def package_amount_for_dates(monthly: Decimal, frequency: str | None, dates: list[date]) -> Decimal:
    """Same rules, counted from the months and halves that actually have logs."""
    freq = frequency or "monthly"
    amount = Decimal(monthly).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    touched: dict[tuple[int, int], set[str]] = {}
    for day in dates:
        half = "first" if day.day <= 15 else "second"
        touched.setdefault((day.year, day.month), set()).add(half)
    total = Decimal("0.00")
    first_share, second_share = split_biweekly(amount) if freq == "biweekly" else (amount, Decimal("0.00"))
    for halves in touched.values():
        if freq == "monthly":
            if "first" in halves:
                total += amount
        else:
            if "first" in halves:
                total += first_share
            if "second" in halves:
                total += second_share
    return total.quantize(Decimal("0.01"))


def package_flats_for_period(
    db: Session,
    va_id: UUID,
    client_ids: set[UUID],
    *,
    period_start: date | None = None,
    period_end: date | None = None,
    dates_by_client: dict[UUID, list[date]] | None = None,
) -> dict[UUID, Decimal]:
    """Package amount due in this window, by client. Time logs do not change the amount."""
    out: dict[UUID, Decimal] = {}
    for cid in client_ids:
        rate = get_approved_rate(db, va_id, cid)
        if not rate or rate.pay_type != PayType.package:
            continue
        freq = resolved_frequency(rate)
        if dates_by_client is not None and (period_start is None or period_end is None):
            due = package_amount_for_dates(rate.amount, freq, dates_by_client.get(cid, []))
        elif period_start is not None and period_end is not None:
            due = package_amount_for_window(rate.amount, freq, period_start, period_end)
        else:
            due = rate.amount if freq == "monthly" else split_biweekly(rate.amount)[0] + split_biweekly(rate.amount)[1]
        out[cid] = due
    return out
