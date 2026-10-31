"""Resolve approved VA rates for logging and payroll."""
from decimal import Decimal
from uuid import UUID

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


def whole_va_package_amount(va) -> tuple[Decimal, str] | None:
    """Flat monthly amount covering every client, or None when this VA is not on that plan.

    Pay is this amount once per payroll period — not hours × rate and not once per client.
    """
    mode = str(getattr(va, "compensation_mode", None) or "hourly")
    if mode != "va_package":
        return None
    amount = getattr(va, "va_package_amount", None)
    if amount is None:
        return None
    currency = str(getattr(va, "va_package_currency", None) or "USD").strip().upper() or "USD"
    if currency not in ("PHP", "USD"):
        currency = "USD"
    return Decimal(str(amount)), currency


def package_flats_for_period(db: Session, va_id: UUID, client_ids: set[UUID]) -> dict[UUID, Decimal]:
    """Flat package amounts by client_id for clients that have approved package rates."""
    out: dict[UUID, Decimal] = {}
    for cid in client_ids:
        rate = get_approved_rate(db, va_id, cid)
        if rate and rate.pay_type == PayType.package:
            out[cid] = rate.amount
    return out
