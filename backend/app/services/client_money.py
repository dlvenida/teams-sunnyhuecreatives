"""Actual client money, from records Jane already saved.

Client income is paid invoices plus manual earnings. VA pay is the Mark Paid
amount on each payroll run, shared across the clients in that run. A fixed
package is shared by the hours on the approved logs. Approved logs that are
not inside a paid run stay as log pay and are marked not yet paid.

Currencies are never added together. Each paid run converts at the rate saved
on that run. Other amounts use the latest confirmed payday rate when one exists.
"""
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models import (
    Client,
    Invoice,
    ManualEarning,
    PaydayRate,
    PayType,
    PayrollRun,
    RateStatus,
    VA,
    VARate,
    WorkLog,
    WorkLogStatus,
)
from app.services.owner_finance import _paid_on, currency_code, quantize_money, usable_rate

PAYABLE = (WorkLogStatus.approved, WorkLogStatus.invoiced)


class Side:
    def __init__(self) -> None:
        self.usd = Decimal("0")
        self.php = Decimal("0")
        self.conv_usd = Decimal("0")
        self.conv_php = Decimal("0")
        self.complete = True

    def add(self, amount, currency, rate) -> None:
        value = quantize_money(Decimal(str(amount or 0)))
        if value == 0:
            return
        chosen = usable_rate(rate)
        if currency_code(currency) == "PHP":
            self.php += value
        else:
            self.usd += value
        if chosen is None:
            self.complete = False
            return
        if currency_code(currency) == "PHP":
            self.conv_php += value
            self.conv_usd += quantize_money(value / chosen)
        else:
            self.conv_usd += value
            self.conv_php += quantize_money(value * chosen)

    def subtract(self, other: "Side") -> "Side":
        out = Side()
        out.usd = self.usd - other.usd
        out.php = self.php - other.php
        out.conv_usd = self.conv_usd - other.conv_usd
        out.conv_php = self.conv_php - other.conv_php
        out.complete = self.complete and other.complete
        return out


def _view(side: Side) -> dict:
    usd = quantize_money(side.usd)
    php = quantize_money(side.php)
    if usd == 0 and php == 0:
        return {"usd": "0.00", "php": "0.00", "combined_usd": "0.00", "combined_php": "0.00"}
    if not side.complete:
        return {"usd": str(usd), "php": str(php), "combined_usd": None, "combined_php": None}
    return {
        "usd": str(usd),
        "php": str(php),
        "combined_usd": str(quantize_money(side.conv_usd)),
        "combined_php": str(quantize_money(side.conv_php)),
    }


def _rate_text(rate: Decimal) -> str:
    return f"{quantize_money(Decimal(rate))}"


def describe_rates(run_rates: set[Decimal], confirmed: Decimal | None, confirmed_used: bool) -> str | None:
    parts: list[str] = []
    if run_rates:
        shown = " and ".join(_rate_text(rate) for rate in sorted(run_rates))
        if len(run_rates) == 1:
            parts.append(f"Using the rate saved on the paid run: {shown} PHP per 1 USD.")
        else:
            parts.append(f"Using each paid run's saved rate: {shown} PHP per 1 USD.")
    if confirmed_used and confirmed is not None:
        parts.append(f"Confirmed payday rate: {_rate_text(confirmed)} PHP per 1 USD.")
    return " ".join(parts) or None


def scale_weights(weights: dict[UUID, Decimal], total: Decimal) -> dict[UUID, Decimal]:
    """Split an actual paid amount so the shares add back to that amount."""
    total = quantize_money(total)
    clean = {key: Decimal(value) for key, value in weights.items() if Decimal(value) > 0}
    if not clean or total == 0:
        return {}
    weight_sum = sum(clean.values(), Decimal("0"))
    if weight_sum == 0:
        return {}
    rounded = {key: quantize_money(total * value / weight_sum) for key, value in clean.items()}
    drift = total - sum(rounded.values(), Decimal("0"))
    if drift != 0:
        key = max(clean, key=lambda item: (clean[item], str(item)))
        rounded[key] = quantize_money(rounded[key] + drift)
    return rounded


def allocate_paid_amount(
    total_pay,
    shares: list[tuple[UUID, Decimal, Decimal]],
    package_client_ids: set[UUID],
) -> dict[UUID, Decimal]:
    """Share one Mark Paid amount across clients.

    `shares` are (client id, hours, log pay) for approved logs in the run.
    Hourly clients keep their log pay, scaled when the paid amount is smaller.
    Fixed-package money that remains is split by each client's hours.
    """
    total = quantize_money(Decimal(str(total_pay or 0)))
    if total == 0:
        return {}
    hours: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0"))
    hourly_pay: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0"))
    package_ids = set(package_client_ids)
    for client_id, log_hours, log_pay in shares:
        hours[client_id] += Decimal(log_hours or 0)
        if client_id not in package_ids:
            hourly_pay[client_id] += Decimal(log_pay or 0)
    hourly_sum = quantize_money(sum((quantize_money(value) for value in hourly_pay.values()), Decimal("0")))
    hourly_weights = {key: quantize_money(value) for key, value in hourly_pay.items() if quantize_money(value) > 0}

    if not package_ids:
        weights = hourly_weights or {key: value for key, value in hours.items() if value > 0}
        return scale_weights(weights, total)

    if hourly_sum <= 0:
        hour_weights = {key: value for key, value in hours.items() if value > 0}
        if hour_weights:
            return scale_weights(hour_weights, total)
        return scale_weights({key: Decimal("1") for key in package_ids}, total)

    if hourly_sum >= total:
        return scale_weights(hourly_weights, total)

    allocated = scale_weights(hourly_weights, hourly_sum)
    remainder = quantize_money(total - hourly_sum)
    package_hours = {key: hours.get(key, Decimal("0")) for key in package_ids}
    package_hours = {key: value for key, value in package_hours.items() if value > 0}
    package_weights = package_hours or {key: Decimal("1") for key in package_ids}
    for key, amount in scale_weights(package_weights, remainder).items():
        allocated[key] = quantize_money(allocated.get(key, Decimal("0")) + amount)
    return allocated


def _paid(status) -> bool:
    return str(getattr(status, "value", status)) == "paid"


def _effective_day(log: WorkLog):
    return log.payable_on or log.work_date


def _assign_logs(runs: list[PayrollRun], logs: list[WorkLog]) -> dict[UUID, UUID]:
    """Each approved log belongs to at most one paid run covering its pay date."""
    assigned: dict[UUID, UUID] = {}
    for log in logs:
        day = _effective_day(log)
        matches = [
            run for run in runs
            if run.va_id == log.va_id and run.period_start <= day <= run.period_end
        ]
        if not matches:
            continue
        matches.sort(key=lambda run: (
            (run.period_end - run.period_start).days,
            -(run.paid_at.timestamp() if isinstance(run.paid_at, datetime) else 0),
        ))
        assigned[log.id] = matches[0].id
    return assigned


def _latest_confirmed_rate(db: Session) -> Decimal | None:
    row = (
        db.query(PaydayRate)
        .order_by(PaydayRate.confirmed_at.desc(), PaydayRate.period_end.desc())
        .first()
    )
    if row is None:
        return None
    return usable_rate(row.usd_php_rate)


def _package_clients(db: Session) -> dict[UUID, set[UUID]]:
    rows = (
        db.query(VARate.va_id, VARate.client_id)
        .filter(VARate.status == RateStatus.approved, VARate.pay_type == PayType.package)
        .all()
    )
    found: dict[UUID, set[UUID]] = defaultdict(set)
    for va_id, client_id in rows:
        found[va_id].add(client_id)
    return found


def _margin(earned: Side, net: Side):
    if earned.complete and quantize_money(earned.conv_usd) != 0 and (earned.usd != 0 or earned.php != 0):
        return round(float(net.conv_usd / earned.conv_usd * 100), 1)
    if quantize_money(earned.php) == 0 and quantize_money(earned.usd) != 0:
        return round(float(net.usd / earned.usd * 100), 1)
    if quantize_money(earned.usd) == 0 and quantize_money(earned.php) != 0:
        return round(float(net.php / earned.php * 100), 1)
    return None


def empty_financials() -> dict:
    zero = {"usd": "0.00", "php": "0.00", "combined_usd": "0.00", "combined_php": "0.00"}
    return {
        "total_hours": "0.00",
        "total_earned": dict(zero),
        "total_collected": dict(zero),
        "total_outstanding": dict(zero),
        "va_earned": dict(zero),
        "va_paid": dict(zero),
        "va_unpaid": dict(zero),
        "net": dict(zero),
        "net_collected": dict(zero),
        "profit_margin_pct": None,
        "rate_label": None,
        "invoices_count": 0,
        "invoices_paid": 0,
        "invoices_unpaid_count": 0,
        "manual_count": 0,
        "by_va": [],
    }


def _covers(day, start, end) -> bool:
    if start is None and end is None:
        return True
    if day is None:
        return False
    if start is not None and day < start:
        return False
    if end is not None and day > end:
        return False
    return True


def client_financials_map(db: Session, date_from=None, date_to=None) -> dict[UUID, dict]:
    return client_money_report(db, date_from, date_to)["clients"]


def client_money_report(db: Session, date_from=None, date_to=None) -> dict:
    """Client money, plus anything that could not be tied to a client.

    With dates, invoices use issue date, manual earnings use their date, and
    payroll uses the day it was marked paid. That is the same window as Earnings.
    """
    confirmed = _latest_confirmed_rate(db)
    all_runs = db.query(PayrollRun).all()
    runs = [run for run in all_runs if _covers(_paid_on(run), date_from, date_to)]
    va_names = {row.id: row for row in db.query(VA).all()}
    known_clients = {row.id for row in db.query(Client.id).all()}
    logs = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.va))
        .filter(WorkLog.status.in_(PAYABLE))
        .all()
    )
    invoices = db.query(Invoice).all()
    manuals = db.query(ManualEarning).all()
    package_clients = _package_clients(db)
    assigned = _assign_logs(all_runs, logs)

    earned: dict[UUID, Side] = defaultdict(Side)
    collected: dict[UUID, Side] = defaultdict(Side)
    outstanding: dict[UUID, Side] = defaultdict(Side)
    va_paid: dict[UUID, Side] = defaultdict(Side)
    va_unpaid: dict[UUID, Side] = defaultdict(Side)
    hours: dict[UUID, Decimal] = defaultdict(lambda: Decimal("0"))
    invoice_counts: dict[UUID, dict] = defaultdict(lambda: {"all": 0, "paid": 0, "unpaid": 0})
    manual_counts: dict[UUID, int] = defaultdict(int)
    run_rates: dict[UUID, set[Decimal]] = defaultdict(set)
    confirmed_used: dict[UUID, bool] = defaultdict(bool)
    by_va: dict[UUID, dict[UUID, dict]] = defaultdict(dict)
    unassigned_earned = Side()
    unassigned_va = Side()
    unassigned_runs: list[dict] = []

    def va_row(client_id: UUID, log: WorkLog) -> dict:
        va = log.va
        row = by_va[client_id].get(log.va_id)
        if row is None:
            row = {
                "va_id": str(log.va_id),
                "va_name": va.name if va else "VA",
                "currency": currency_code(va.currency) if va else "USD",
                "hours": Decimal("0"),
                "logs": 0,
                "paid_usd": Decimal("0"),
                "paid_php": Decimal("0"),
                "unpaid_usd": Decimal("0"),
                "unpaid_php": Decimal("0"),
            }
            by_va[client_id][log.va_id] = row
        return row

    for invoice in invoices:
        if not _covers(invoice.issue_date, date_from, date_to):
            continue
        client_id = invoice.client_id if invoice.client_id in known_clients else None
        amount = invoice.amount
        currency = getattr(invoice, "currency", None) or "USD"
        rate = confirmed
        if client_id is None:
            unassigned_earned.add(amount, currency, rate)
            continue
        invoice_counts[client_id]["all"] += 1
        if rate is not None and quantize_money(Decimal(str(amount or 0))) != 0:
            confirmed_used[client_id] = True
        # Issued invoices count as earned, paid or not. That matches You earned.
        earned[client_id].add(amount, currency, rate)
        if _paid(invoice.status):
            invoice_counts[client_id]["paid"] += 1
            collected[client_id].add(amount, currency, rate)
        else:
            invoice_counts[client_id]["unpaid"] += 1
            outstanding[client_id].add(amount, currency, rate)

    for manual in manuals:
        if not _covers(manual.earned_date, date_from, date_to):
            continue
        client_id = manual.client_id if manual.client_id in known_clients else None
        rate = confirmed
        amount = manual.amount
        if client_id is None:
            unassigned_earned.add(amount, manual.currency, rate)
            continue
        manual_counts[client_id] += 1
        if rate is not None and quantize_money(Decimal(str(amount or 0))) != 0:
            confirmed_used[client_id] = True
        earned[client_id].add(amount, manual.currency, rate)
        collected[client_id].add(amount, manual.currency, rate)

    logs_by_run: dict[UUID, list[WorkLog]] = defaultdict(list)
    for log in logs:
        hours[log.client_id] += Decimal(log.hours or 0)
        row = va_row(log.client_id, log)
        row["hours"] += Decimal(log.hours or 0)
        row["logs"] += 1
        run_id = assigned.get(log.id)
        if run_id is not None:
            logs_by_run[run_id].append(log)

    for run in runs:
        saved_rate = usable_rate(run.usd_php_rate)
        if saved_rate is None:
            rate = confirmed
            used_saved = False
        else:
            rate = saved_rate
            used_saved = True
        shares = [
            (log.client_id, Decimal(log.hours or 0), Decimal(log.va_pay or 0))
            for log in logs_by_run.get(run.id, [])
        ]
        allocated = allocate_paid_amount(run.total_pay, shares, package_clients.get(run.va_id, set()))
        currency = run.currency
        va = va_names.get(run.va_id)
        placed = Decimal("0")
        for client_id, amount in allocated.items():
            amount = quantize_money(amount)
            if amount == 0:
                continue
            placed += amount
            if client_id not in known_clients:
                unassigned_va.add(amount, currency, rate)
                continue
            if used_saved and rate is not None:
                run_rates[client_id].add(quantize_money(rate))
            elif rate is not None:
                confirmed_used[client_id] = True
            va_paid[client_id].add(amount, currency, rate)
            row = by_va[client_id].get(run.va_id)
            if row is None:
                row = {
                    "va_id": str(run.va_id),
                    "va_name": va.name if va else "VA",
                    "currency": currency_code(va.currency) if va else currency_code(currency),
                    "hours": Decimal("0"),
                    "logs": 0,
                    "paid_usd": Decimal("0"),
                    "paid_php": Decimal("0"),
                    "unpaid_usd": Decimal("0"),
                    "unpaid_php": Decimal("0"),
                }
                by_va[client_id][run.va_id] = row
            if currency_code(currency) == "PHP":
                row["paid_php"] += amount
            else:
                row["paid_usd"] += amount
        gap = quantize_money(quantize_money(Decimal(str(run.total_pay or 0))) - placed)
        if gap != 0:
            unassigned_va.add(gap, currency, rate)
            unassigned_runs.append({
                "va_name": va.name if va else "VA",
                "amount": str(gap),
                "currency": currency_code(currency),
                "label": "not assigned to a client",
            })

    for log in logs:
        if log.id in assigned:
            continue
        if not _covers(_effective_day(log), date_from, date_to):
            continue
        if log.client_id not in known_clients:
            continue
        rate = confirmed
        if rate is not None and quantize_money(Decimal(str(log.va_pay or 0))) != 0:
            confirmed_used[log.client_id] = True
        currency = log.va.currency if log.va else "USD"
        va_unpaid[log.client_id].add(log.va_pay, currency, rate)
        row = va_row(log.client_id, log)
        if currency_code(currency) == "PHP":
            row["unpaid_php"] += quantize_money(Decimal(str(log.va_pay or 0)))
        else:
            row["unpaid_usd"] += quantize_money(Decimal(str(log.va_pay or 0)))

    client_ids = set(hours) | set(earned) | set(va_paid) | set(va_unpaid) | set(outstanding) | set(invoice_counts)
    out: dict[UUID, dict] = {}
    for client_id in client_ids:
        earned_side = earned[client_id]
        collected_side = collected[client_id]
        va_side = Side()
        va_side.usd = va_paid[client_id].usd + va_unpaid[client_id].usd
        va_side.php = va_paid[client_id].php + va_unpaid[client_id].php
        va_side.conv_usd = va_paid[client_id].conv_usd + va_unpaid[client_id].conv_usd
        va_side.conv_php = va_paid[client_id].conv_php + va_unpaid[client_id].conv_php
        va_side.complete = va_paid[client_id].complete and va_unpaid[client_id].complete
        net_side = earned_side.subtract(va_side)
        net_collected = collected_side.subtract(va_side)
        people = []
        for row in sorted(by_va[client_id].values(), key=lambda item: item["va_name"].lower()):
            people.append({
                "va_id": row["va_id"],
                "va_name": row["va_name"],
                "currency": row["currency"],
                "hours": str(quantize_money(row["hours"])),
                "logs": row["logs"],
                "va_pay": str(quantize_money(row["paid_usd"] + row["unpaid_usd"] if row["currency"] != "PHP" else row["paid_php"] + row["unpaid_php"])),
                "va_pay_usd": str(quantize_money(row["paid_usd"] + row["unpaid_usd"])),
                "va_pay_php": str(quantize_money(row["paid_php"] + row["unpaid_php"])),
                "unpaid_usd": str(quantize_money(row["unpaid_usd"])),
                "unpaid_php": str(quantize_money(row["unpaid_php"])),
            })
        counts = invoice_counts[client_id]
        out[client_id] = {
            "total_hours": str(quantize_money(hours[client_id])),
            "total_earned": _view(earned_side),
            "total_collected": _view(collected_side),
            "total_outstanding": _view(outstanding[client_id]),
            "va_earned": _view(va_side),
            "va_paid": _view(va_paid[client_id]),
            "va_unpaid": _view(va_unpaid[client_id]),
            "net": _view(net_side),
            "net_collected": _view(net_collected),
            "profit_margin_pct": _margin(earned_side, net_side),
            "rate_label": describe_rates(run_rates[client_id], confirmed, confirmed_used[client_id]),
            "invoices_count": counts["all"],
            "invoices_paid": counts["paid"],
            "invoices_unpaid_count": counts["unpaid"],
            "manual_count": manual_counts[client_id],
            "by_va": people,
        }
    return {
        "clients": out,
        "unassigned": {
            "label": "not assigned to a client",
            "earned": _view(unassigned_earned),
            "va_paid": _view(unassigned_va),
            "runs": unassigned_runs,
        },
    }
