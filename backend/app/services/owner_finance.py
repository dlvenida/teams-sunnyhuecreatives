"""Split owner money into USD and PHP, and combine them only with a rate.

A peso amount is never added to a dollar amount unless the caller passes the
USD to PHP rate from the earnings page. The combined pair is one total shown
twice: dollars, and that same total in pesos.
"""
from decimal import Decimal


def currency_code(currency) -> str:
    raw = getattr(currency, "value", currency)
    return "PHP" if str(raw or "USD").strip().upper() == "PHP" else "USD"


class MoneySplit:
    def __init__(self) -> None:
        self.usd = Decimal("0")
        self.php = Decimal("0")

    def add(self, amount, currency) -> None:
        value = Decimal(str(amount or 0))
        if currency_code(currency) == "PHP":
            self.php += value
        else:
            self.usd += value


def quantize_money(amount: Decimal) -> Decimal:
    return Decimal(amount).quantize(Decimal("0.01"))


def combine(usd: Decimal, php: Decimal, rate: Decimal | None) -> tuple[Decimal | None, Decimal | None]:
    """Return (combined USD, combined PHP) for one total, or (None, None) without a rate."""
    if rate is None or rate <= 0:
        return None, None
    combined_usd = quantize_money(Decimal(usd) + (Decimal(php) / Decimal(rate)))
    combined_php = quantize_money(combined_usd * Decimal(rate))
    return combined_usd, combined_php


def pack_money(split: MoneySplit, rate: Decimal | None) -> dict:
    usd = quantize_money(split.usd)
    php = quantize_money(split.php)
    combined_usd, combined_php = combine(usd, php, rate)
    return {
        "usd": str(usd),
        "php": str(php),
        "combined_usd": str(combined_usd) if combined_usd is not None else None,
        "combined_php": str(combined_php) if combined_php is not None else None,
    }


def usable_rate(rate) -> Decimal | None:
    if rate is None:
        return None
    value = Decimal(str(rate))
    if value <= 0:
        return None
    return value


class CurrencyLedger:
    """Recorded originals, plus each side after a known USD to PHP rate."""

    def __init__(self) -> None:
        self.recorded_usd = Decimal("0")
        self.recorded_php = Decimal("0")
        self.total_usd = Decimal("0")
        self.total_php = Decimal("0")
        self.missing_rate = False
        self.rates: list[Decimal] = []

    def add(self, amount, currency, rate: Decimal | None) -> None:
        value = Decimal(str(amount or 0))
        if value == 0:
            return
        chosen = usable_rate(rate)
        if currency_code(currency) == "PHP":
            part = quantize_money(value)
            self.recorded_php += part
            self.total_php += part
            if chosen is None:
                self.missing_rate = True
            else:
                self.total_usd += quantize_money(part / chosen)
                self.rates.append(chosen)
        else:
            part = quantize_money(value)
            self.recorded_usd += part
            self.total_usd += part
            if chosen is None:
                self.missing_rate = True
            else:
                self.total_php += quantize_money(part * chosen)
                self.rates.append(chosen)


def add_payroll(ledger: CurrencyLedger, amount, currency, run_rate, page_rate) -> None:
    """USD runs become pesos at the payday rate. The page rate is only the fallback."""
    ledger.add(amount, currency, usable_rate(run_rate) or usable_rate(page_rate))


def unique_rate(ledger: CurrencyLedger) -> Decimal | None:
    if not ledger.rates:
        return None
    first = ledger.rates[0]
    if all(rate == first for rate in ledger.rates):
        return first
    return None


def settled_sides(split: MoneySplit, page_rate) -> tuple[Decimal | None, Decimal | None]:
    """(usd, php) for income or business expenses. The page rate converts a mix.

    A single currency is known on its own side. The other side stays unknown until a rate exists.
    """
    usd = quantize_money(split.usd)
    php = quantize_money(split.php)
    rate = usable_rate(page_rate)
    if usd == 0 and php == 0:
        return Decimal("0.00"), Decimal("0.00")
    if rate is not None:
        return combine(usd, php, rate)
    if usd == 0:
        return None, php
    if php == 0:
        return usd, None
    return None, None


def consistent_net(net_php: Decimal, rate: Decimal) -> tuple[Decimal, Decimal]:
    """One profit figure, shown in both currencies so the signs match."""
    net_usd = quantize_money(Decimal(net_php) / Decimal(rate))
    shown_php = quantize_money(net_usd * Decimal(rate))
    return net_usd, shown_php


def signs_conflict(usd: Decimal, php: Decimal) -> bool:
    if usd == 0 or php == 0:
        return False
    return (usd > 0) != (php > 0)


def _money_dict(usd: Decimal, php: Decimal, combined_usd: Decimal | None, combined_php: Decimal | None) -> dict:
    return {
        "usd": str(quantize_money(usd)),
        "php": str(quantize_money(php)),
        "combined_usd": str(combined_usd) if combined_usd is not None else None,
        "combined_php": str(combined_php) if combined_php is not None else None,
    }


def payroll_ledger(runs, page_rate) -> CurrencyLedger:
    ledger = CurrencyLedger()
    for run in runs:
        add_payroll(
            ledger,
            getattr(run, "total_pay", 0),
            getattr(run, "currency", None),
            getattr(run, "usd_php_rate", None),
            page_rate,
        )
    return ledger


def build_owner_totals(earned: MoneySplit, business: MoneySplit, runs, page_rate) -> dict:
    """VA pay uses each run's payday rate. Income and tools use the page rate.

    Total expenses are VA pay plus business expenses. Net subtracts that sum once.
    """
    va = payroll_ledger(runs, page_rate)
    earned_usd, earned_php = settled_sides(earned, page_rate)
    business_usd, business_php = settled_sides(business, page_rate)
    page = usable_rate(page_rate)
    display = page
    if display is None and quantize_money(earned.usd) == 0 and quantize_money(business.usd) == 0:
        display = unique_rate(va)

    va_combined_usd = None if va.missing_rate else quantize_money(va.total_usd)
    va_combined_php = None if va.missing_rate else quantize_money(va.total_php)
    expense_combined_usd = None
    expense_combined_php = None
    if not va.missing_rate and business_usd is not None and business_php is not None:
        expense_combined_usd = quantize_money(va.total_usd + business_usd)
        expense_combined_php = quantize_money(va.total_php + business_php)

    pair = None
    if not va.missing_rate and earned_php is not None and business_php is not None:
        net_php = quantize_money(earned_php - va.total_php - business_php)
        if display is not None:
            pair = consistent_net(net_php, display)
        elif net_php == 0 and quantize_money(va.total_usd) == 0:
            pair = (Decimal("0.00"), Decimal("0.00"))

    if pair is not None:
        net_usd, net_php_shown = pair
        needs_rate = False
    else:
        net_usd = quantize_money(earned.usd - va.recorded_usd - business.usd)
        net_php_shown = quantize_money(earned.php - va.recorded_php - business.php)
        needs_rate = signs_conflict(net_usd, net_php_shown)

    hint = None
    if needs_rate:
        hint = (
            "Enter a USD to PHP rate to see one net profit in dollars and pesos. "
            "Each payroll run uses its own payday rate when that was saved."
        )

    return {
        "va_payroll": _money_dict(va.recorded_usd, va.recorded_php, va_combined_usd, va_combined_php),
        "business_expenses": pack_money(business, page),
        "expense_totals": _money_dict(
            business.usd,
            business.php,
            expense_combined_usd,
            expense_combined_php,
        ),
        "net": _money_dict(
            net_usd,
            net_php_shown,
            pair[0] if pair is not None else None,
            pair[1] if pair is not None else None,
        ),
        "needs_rate": needs_rate,
        "rate_hint": hint,
    }


def plain_text(value) -> str:
    text = str(value or "")
    for dash in ("\u2014", "\u2013", "\u2012"):
        text = text.replace(dash, " ")
    return " ".join(text.split())


def period_phrase(start, end) -> str:
    def piece(day) -> str:
        label = f"{day.strftime('%b')} {day.day}"
        if start.year != end.year:
            label = f"{label}, {day.year}"
        return label

    return f"{piece(start)} to {piece(end)}"


def _status_value(row) -> str:
    status = getattr(row, "status", "")
    return status.value if hasattr(status, "value") else str(status or "")


def _paid_on(run):
    paid = getattr(run, "paid_at", None)
    if paid is None:
        return getattr(run, "period_end", None)
    if getattr(paid, "tzinfo", None) is not None:
        from datetime import timezone
        return paid.astimezone(timezone.utc).date()
    return paid.date()


def convert_amount(amount, currency, rate, display: str) -> tuple[Decimal | None, bool]:
    """Amount in the statement currency. The second value is true when a rate was required."""
    code = currency_code(currency)
    value = quantize_money(Decimal(str(amount or 0)))
    show = "PHP" if str(display or "PHP").upper() == "PHP" else "USD"
    if code == show:
        return value, False
    chosen = usable_rate(rate)
    if chosen is None:
        return None, True
    if show == "PHP":
        return quantize_money(value * chosen), True
    return quantize_money(value / chosen), True


def _shown(money: dict, display: str) -> Decimal | None:
    if display == "PHP":
        if money.get("combined_php") is not None:
            return Decimal(money["combined_php"])
        if Decimal(money.get("usd") or 0) == 0:
            return Decimal(money.get("php") or 0)
        return None
    if money.get("combined_usd") is not None:
        return Decimal(money["combined_usd"])
    if Decimal(money.get("php") or 0) == 0:
        return Decimal(money.get("usd") or 0)
    return None


def _line(when, description, category, money_in, money_out, original_amount=None, original_currency=None) -> dict:
    return {
        "date": str(when),
        "description": plain_text(description),
        "category": category,
        "money_in": None if money_in is None else str(quantize_money(money_in)),
        "money_out": None if money_out is None else str(quantize_money(money_out)),
        "balance": None,
        "original_amount": None if original_amount is None else str(quantize_money(original_amount)),
        "original_currency": original_currency,
    }


def _sum_side(lines, category, side: str) -> Decimal:
    total = Decimal("0")
    for line in lines:
        if line["category"] != category:
            continue
        raw = line["money_in"] if side == "in" else line["money_out"]
        if raw is None:
            continue
        total += Decimal(raw)
    return quantize_money(total)


def _reconcile(lines, category, target: Decimal | None, when, side: str) -> None:
    """A cent from combining the whole total, kept off the real descriptions."""
    if target is None or when is None:
        return
    gap = quantize_money(target - _sum_side(lines, category, side))
    if gap == 0:
        return
    if gap > 0:
        money_in = gap if side == "in" else Decimal("0")
        money_out = gap if side == "out" else Decimal("0")
    else:
        money_in = abs(gap) if side == "out" else Decimal("0")
        money_out = abs(gap) if side == "in" else Decimal("0")
    lines.append(_line(when, "Rounding to match the earnings total", "Rounding", money_in, money_out))


def build_statement(invoices, manuals, runs, expenses, page_rate, display: str = "PHP") -> dict:
    """A readable ledger whose summary matches the earnings page for the same range."""
    show = "PHP" if str(display or "PHP").upper() == "PHP" else "USD"
    page = usable_rate(page_rate)
    earned = MoneySplit()
    business = MoneySplit()
    lines: list[dict] = []

    for inv in invoices:
        client = getattr(inv, "client", None)
        name = plain_text(getattr(client, "name", None) or getattr(inv, "one_off_name", None) or "Client")
        number = plain_text(getattr(inv, "invoice_number", "") or "")
        paid = _status_value(inv) == "paid"
        label = "Client payment" if paid else "Invoice issued"
        description = f"{label}: {name} (Invoice #{number})" if number else f"{label}: {name}"
        amount = getattr(inv, "amount", 0)
        currency = getattr(inv, "currency", "USD")
        earned.add(amount, currency)
        converted, changed = convert_amount(amount, currency, page, show)
        lines.append(_line(
            getattr(inv, "issue_date"),
            description,
            "Income",
            converted,
            Decimal("0") if converted is not None else None,
            amount if changed else None,
            currency_code(currency) if changed else None,
        ))

    for item in manuals:
        client = getattr(item, "client", None)
        name = plain_text(getattr(client, "name", None) or "Client")
        note = plain_text(getattr(item, "description", None) or "")
        description = f"Manual earning: {name} {note}".strip()
        amount = getattr(item, "amount", 0)
        currency = getattr(item, "currency", "USD")
        earned.add(amount, currency)
        converted, changed = convert_amount(amount, currency, page, show)
        lines.append(_line(
            getattr(item, "earned_date"),
            description,
            "Income",
            converted,
            Decimal("0") if converted is not None else None,
            amount if changed else None,
            currency_code(currency) if changed else None,
        ))

    for expense in expenses:
        amount = getattr(expense, "amount", 0)
        currency = getattr(expense, "currency", "USD")
        business.add(amount, currency)
        converted, changed = convert_amount(amount, currency, page, show)
        lines.append(_line(
            getattr(expense, "expense_date"),
            f"Business expense: {plain_text(getattr(expense, 'description', None) or 'Expense')}",
            "Business expense",
            Decimal("0") if converted is not None else None,
            converted,
            amount if changed else None,
            currency_code(currency) if changed else None,
        ))

    for run in runs:
        amount = getattr(run, "total_pay", 0)
        currency = getattr(run, "currency", "PHP")
        rate = usable_rate(getattr(run, "usd_php_rate", None)) or page
        va = getattr(run, "va", None)
        name = plain_text(getattr(va, "name", None) or "VA")
        start = getattr(run, "period_start", None)
        end = getattr(run, "period_end", None)
        span = period_phrase(start, end) if start and end else "this period"
        rate_bit = f" at {_rate_label(rate)} PHP/USD" if rate is not None else ""
        converted, changed = convert_amount(amount, currency, rate, show)
        lines.append(_line(
            _paid_on(run),
            f"VA pay: {name} ({span}){rate_bit}",
            "VA pay",
            Decimal("0") if converted is not None else None,
            converted,
            amount if changed else None,
            currency_code(currency) if changed else None,
        ))

    totals = build_owner_totals(earned, business, runs, page)
    total_in = _shown(pack_money(earned, page), show)
    va_pay = _shown(totals["va_payroll"], show)
    business_total = _shown(totals["business_expenses"], show)
    total_out = _shown(totals["expense_totals"], show)
    net = _shown(totals["net"], show)
    needs_rate = total_in is None or va_pay is None or business_total is None or total_out is None or net is None or totals["needs_rate"]

    end_date = None
    for source in list(invoices) + list(manuals) + list(expenses) + list(runs):
        when = getattr(source, "issue_date", None) or getattr(source, "earned_date", None) or getattr(source, "expense_date", None) or _paid_on(source)
        if when is not None and (end_date is None or when > end_date):
            end_date = when

    if not needs_rate:
        _reconcile(lines, "Income", total_in, end_date, "in")
        _reconcile(lines, "VA pay", va_pay, end_date, "out")
        _reconcile(lines, "Business expense", business_total, end_date, "out")

    lines.sort(key=lambda row: (
        row["date"] or "",
        {"Income": 0, "Business expense": 1, "VA pay": 2, "Rounding": 3}.get(row["category"], 9),
        row["description"],
    ))

    if not needs_rate and net is not None and total_in is not None and total_out is not None:
        gap = quantize_money(net - (total_in - total_out))
        if gap != 0 and end_date is not None:
            lines.append(_line(
                end_date,
                "Rounding to the earnings net profit",
                "Rounding",
                gap if gap > 0 else Decimal("0"),
                abs(gap) if gap < 0 else Decimal("0"),
            ))

    balance = Decimal("0.00")
    complete = True
    for line in lines:
        if line["money_in"] is None or line["money_out"] is None:
            complete = False
            line["balance"] = None
            continue
        balance = quantize_money(balance + Decimal(line["money_in"]) - Decimal(line["money_out"]))
        line["balance"] = str(balance)

    return {
        "display_currency": show,
        "usd_php_rate": str(page) if page else None,
        "needs_rate": needs_rate or not complete,
        "rate_hint": totals["rate_hint"] if needs_rate or not complete else None,
        "opening_balance": "0.00",
        "total_in": None if total_in is None else str(total_in),
        "va_pay": None if va_pay is None else str(va_pay),
        "business_expenses": None if business_total is None else str(business_total),
        "total_out": None if total_out is None else str(total_out),
        "net": None if net is None else str(net),
        "lines": lines,
    }


def _rate_label(rate: Decimal | None) -> str:
    if rate is None:
        return ""
    return f"{Decimal(rate).quantize(Decimal('0.01'))}"
