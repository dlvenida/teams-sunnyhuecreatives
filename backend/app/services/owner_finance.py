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
