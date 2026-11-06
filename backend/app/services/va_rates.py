"""Resolve approved VA rates for logging and payroll."""
from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

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
    """Return (va_rate, va_pay, pay_type). Package logs store rate amount but va_pay=0 (flat applied in payroll).

    The company default (often $75) is only a snapshot for a log saved before this VA
    has an approved rate. It is not the client's billable rate. Pay views re-read the
    approved rate through pay_from_approved_rate so a later approval replaces that snapshot.
    """
    rate = get_approved_rate(db, va_id, client_id)
    if not rate:
        fallback = _fallback_rate(db)
        return fallback, calculate_pay(hours, fallback), None
    if rate.pay_type == PayType.package:
        return rate.amount, Decimal("0.00"), PayType.package
    return rate.amount, calculate_pay(hours, rate.amount), PayType.hourly


def approved_rate_amounts(db: Session, va_ids) -> dict[tuple[UUID, UUID], tuple[str, Decimal]]:
    """Latest approved rate for each of these VAs and their clients.

    The key is (va_id, client_id). Another VA's rate is never stored under this VA.
    """
    ids = [va_id for va_id in va_ids if va_id is not None]
    if not ids:
        return {}
    rows = (
        db.query(VARate)
        .filter(VARate.va_id.in_(ids), VARate.status == RateStatus.approved)
        .order_by(VARate.reviewed_at.desc().nullslast(), VARate.created_at.desc())
        .all()
    )
    chosen: dict[tuple[UUID, UUID], tuple[str, Decimal]] = {}
    for rate in rows:
        kind = rate.pay_type.value if hasattr(rate.pay_type, "value") else str(rate.pay_type)
        chosen.setdefault((rate.va_id, rate.client_id), (kind, Decimal(rate.amount).quantize(Decimal("0.01"))))
    return chosen


def pay_from_approved_rate(log, amounts: dict[tuple[UUID, UUID], tuple[str, Decimal]]) -> tuple[Decimal, Decimal]:
    """Rate and pay for one log, from that VA's approved rate for that client.

    Hourly: hours times the approved amount, not the number frozen on the log and not
    the client's billable rate. Package: the log line does not add hourly pay. The
    period package is applied separately. No approved rate: keep the stored snapshot.
    """
    stored_rate = Decimal(log.va_rate or 0)
    stored_pay = Decimal(log.va_pay or 0)
    found = amounts.get((log.va_id, log.client_id))
    if found is None:
        return stored_rate, stored_pay
    kind, amount = found
    if kind == PayType.package.value:
        return amount, Decimal("0.00")
    return amount, calculate_pay(Decimal(log.hours or 0), amount)


def frequency_for_save(pay_type: PayType, raw: str | None) -> str | None:
    """Hourly rates do not use a frequency.

    Creating a package rate with the frequency left blank saves Bi-weekly.
    This is only the create path. It does not rewrite rates that are already stored.
    """
    if pay_type != PayType.package:
        return None
    value = _frequency_token(raw)
    if not value:
        value = "biweekly"
    if value not in ("monthly", "biweekly"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment frequency must be Monthly or Bi-weekly.")
    return value


def _frequency_token(raw: str | None) -> str:
    return (raw or "").strip().lower().replace("-", "").replace(" ", "")


def frequency_for_update(raw: str | None) -> str:
    """An edit must say Monthly or Bi-weekly. A blank value is not turned into either one."""
    value = _frequency_token(raw)
    if value not in ("monthly", "biweekly"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment frequency must be Monthly or Bi-weekly.")
    return value


def resolved_frequency(rate: VARate | None) -> str:
    """Null on an existing package rate means Monthly, so those payslips stay whole.

    Rates saved before payment frequency existed, and any row still missing it,
    keep the full monthly amount. New saves go through frequency_for_save and
    store biweekly when the client omits the field. Do not backfill nulls.
    """
    if rate is None or rate.pay_type != PayType.package:
        return "monthly"
    return rate.payment_frequency or "monthly"


def currency_code(value) -> str:
    """PHP or USD. Anything else is shown as USD."""
    if value is None:
        return "USD"
    raw = value.value if hasattr(value, "value") else value
    return "PHP" if str(raw).upper() == "PHP" else "USD"


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


def approved_package_rates(db: Session, va_id: UUID) -> list[VARate]:
    """One approved package rate per client: the latest reviewed rate."""
    rows = (
        db.query(VARate)
        .options(joinedload(VARate.client))
        .filter(VARate.va_id == va_id, VARate.status == RateStatus.approved, VARate.pay_type == PayType.package)
        .order_by(VARate.reviewed_at.desc().nullslast(), VARate.created_at.desc())
        .all()
    )
    chosen: dict[UUID, VARate] = {}
    for rate in rows:
        chosen.setdefault(rate.client_id, rate)
    return list(chosen.values())


def package_period_amounts(
    db: Session,
    va_id: UUID,
    period_start: date,
    period_end: date,
) -> list[tuple[UUID, str, Decimal, str]]:
    """Period package pay for every approved client. Logged hours are not an input.

    The fourth value is the rate currency (PHP or USD), not a display default.
    """
    out: list[tuple[UUID, str, Decimal, str]] = []
    for rate in approved_package_rates(db, va_id):
        due = package_amount_for_window(rate.amount, resolved_frequency(rate), period_start, period_end)
        if due <= 0:
            continue
        name = rate.client.name if rate.client else "Client"
        out.append((rate.client_id, name, due, currency_code(rate.currency)))
    return out


def earned_for_window(db: Session, va_id: UUID, start: date, end: date) -> tuple[Decimal, Decimal]:
    """Approved pay for a date window. Same rules as the VA earnings page.

    Package clients use the period amount, including bi-weekly halves and any
    saved period override. Hourly clients use this VA's approved rate for each client.
    """
    from app.models import WorkLog, WorkLogStatus
    from app.services.package_overrides import effective_package_amount, load_overrides

    logs = (
        db.query(WorkLog)
        .filter(
            WorkLog.va_id == va_id,
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= start,
            WorkLog.work_date <= end,
        )
        .all()
    )
    hours = sum((log.hours for log in logs), Decimal("0"))
    amounts = approved_rate_amounts(db, [va_id])
    log_pay: dict[UUID, Decimal] = {}
    for log in logs:
        _rate, pay = pay_from_approved_rate(log, amounts)
        log_pay[log.client_id] = log_pay.get(log.client_id, Decimal("0")) + pay
    saved = load_overrides(db, {va_id}, start, end)
    dues: dict[UUID, Decimal] = {}
    for client_id, _name, calculated, _currency in package_period_amounts(db, va_id, start, end):
        row = saved.get((va_id, client_id))
        effective, _skipped, _adjusted = effective_package_amount(
            calculated,
            skipped=bool(row.skipped) if row else False,
            amount=row.amount if row else None,
            deduction=row.deduction if row else None,
        )
        dues[client_id] = effective
    return combine_period_pay(dues, log_pay), hours


def own_month_pay(db: Session, va_id: UUID, today: date | None = None) -> dict:
    """This calendar month and the current payroll half, for the signed-in VA only."""
    from app.models import VA
    from app.services.payroll_calendar import payroll_period_for

    today = today or date.today()
    month_start = date(today.year, today.month, 1)
    month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])
    period_start, period_end = payroll_period_for(today)
    month_pay, month_hours = earned_for_window(db, va_id, month_start, month_end)
    period_pay, period_hours = earned_for_window(db, va_id, period_start, period_end)
    va = db.query(VA).filter(VA.id == va_id).first()
    currency = currency_code(va.currency if va else None)
    return {
        "month_label": today.strftime("%B %Y"),
        "month_start": month_start.isoformat(),
        "month_end": month_end.isoformat(),
        "month_pay": str(month_pay),
        "month_hours": str(month_hours),
        "period_label": f"{period_start.strftime('%b')} {period_start.day} to {period_end.strftime('%b')} {period_end.day}",
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "period_pay": str(period_pay),
        "period_hours": str(period_hours),
        "currency": currency,
    }


def combine_period_pay(package_dues: dict[UUID, Decimal], log_pay_by_client: dict[UUID, Decimal]) -> Decimal:
    """Package clients are paid the period amount. Hourly clients keep the sum of their logs."""
    hourly = sum(
        (pay for cid, pay in log_pay_by_client.items() if cid not in package_dues),
        Decimal("0"),
    )
    return (hourly + sum(package_dues.values(), Decimal("0"))).quantize(Decimal("0.01"))


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
