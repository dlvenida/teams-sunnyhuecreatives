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
