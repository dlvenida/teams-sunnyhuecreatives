"""Flexible client invoices.

Saved billing lines pre-fill a client's invoices. A manual line starts blank.
Editing one invoice does not change a preset. One-off invoices do not create a client.
VA time logs are read for Actual hours and are never written here.
"""
from decimal import Decimal, ROUND_HALF_UP

MONEY = Decimal("0.01")
PROJECT_TYPES = ("entered_hours", "actual_hours", "flat_fee")
MANUAL_TYPES = ("hourly", "package", "manual")
SETUP_TYPES = PROJECT_TYPES + MANUAL_TYPES
ONE_OFF_TYPES = MANUAL_TYPES + ("extra",)
DRAFT_TYPES = SETUP_TYPES + ("extra",)


def quantize_money(value) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def clean_invoice_text(value: str | None) -> str:
    """Keep line breaks. Turn em and en dashes into a plain hyphen."""
    text = (value or "").replace("\u2014", "-").replace("\u2013", "-").replace("\u2012", "-")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in text.split("\n")).strip("\n")


def description_lines(value: str | None) -> list[str]:
    """PDF lines, exactly as typed, including blank lines between breaks."""
    return clean_invoice_text(value).split("\n") if value is not None else [""]


def format_hours_number(hours) -> str:
    quantized = quantize_money(hours)
    text = f"{quantized:.2f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def money_usd(amount, currency: str = "USD") -> str:
    symbol = "₱" if (currency or "USD").upper() == "PHP" else "$"
    return f"{symbol}{quantize_money(amount):.2f}"


def hour_description(project_name: str, hours, rate, amount=None, currency: str = "USD") -> str:
    total = quantize_money(hours) * quantize_money(rate)
    shown = quantize_money(total if amount is None else amount)
    name = clean_invoice_text(project_name).replace("\n", " ")
    return f"{name} - {format_hours_number(hours)} hrs x {money_usd(rate, currency)}/hr = {money_usd(shown, currency)}"


def blank_manual_line() -> dict:
    """A new manual line. The description is empty on purpose."""
    return {
        "project_id": None,
        "project_name": None,
        "billing_type": "manual",
        "description": "",
        "hours": None,
        "rate": None,
        "amount": None,
    }


def _filled(value) -> bool:
    return value is not None and str(value).strip() != ""


def resolve_amount(kind: str, hours, rate, amount) -> Decimal:
    """Hours x rate when both are filled. Otherwise the typed flat amount. Package is always flat."""
    if kind == "package":
        if not _filled(amount):
            raise ValueError("A package line needs an amount")
        total = quantize_money(amount)
    elif kind in ("hourly", "manual", "extra") and _filled(hours) and _filled(rate):
        total = quantize_money(Decimal(str(hours)) * Decimal(str(rate)))
    elif _filled(amount):
        total = quantize_money(amount)
    elif kind == "extra":
        raise ValueError("An extra charge needs an amount")
    else:
        total = Decimal("0.00")
    if total < 0:
        raise ValueError("Amount cannot be negative")
    return total


def approved_hours_for_project(logs, project_id) -> Decimal:
    total = Decimal("0.00")
    for log in logs:
        status = getattr(log, "status", None)
        status_value = status.value if hasattr(status, "value") else str(status or "")
        if status_value != "approved":
            continue
        if getattr(log, "project_id", None) != project_id:
            continue
        total += Decimal(str(log.hours))
    return quantize_money(total)


def build_setup_drafts(setup_lines, logs, client_rate, currency: str = "USD") -> list[dict]:
    """Copy saved lines into one invoice. Extras are never included."""
    rate_default = quantize_money(client_rate or 0)
    drafts = []
    for line in setup_lines:
        kind = line.billing_type
        project_name = line.project.name if getattr(line, "project", None) else ""
        if kind == "entered_hours":
            hours = quantize_money(line.default_hours or 0)
            amount = quantize_money(hours * rate_default)
            drafts.append({
                "project_id": line.project_id,
                "project_name": project_name,
                "billing_type": kind,
                "hours": hours,
                "rate": rate_default,
                "amount": amount,
                "description": hour_description(project_name, hours, rate_default, amount, currency),
                "preset_id": line.id,
            })
        elif kind == "actual_hours":
            hours = approved_hours_for_project(logs, line.project_id)
            amount = quantize_money(hours * rate_default)
            drafts.append({
                "project_id": line.project_id,
                "project_name": project_name,
                "billing_type": kind,
                "hours": hours,
                "rate": rate_default,
                "amount": amount,
                "description": hour_description(project_name, hours, rate_default, amount, currency),
                "preset_id": line.id,
            })
        elif kind == "flat_fee":
            amount = quantize_money(line.default_amount or 0)
            drafts.append({
                "project_id": line.project_id,
                "project_name": project_name,
                "billing_type": kind,
                "hours": Decimal("0.00"),
                "rate": amount,
                "amount": amount,
                "description": clean_invoice_text(project_name) or "Flat fee",
                "preset_id": line.id,
            })
        elif kind in MANUAL_TYPES:
            hours = quantize_money(line.default_hours) if line.default_hours is not None else None
            rate = quantize_money(line.default_rate) if line.default_rate is not None else None
            stored = quantize_money(line.default_amount) if line.default_amount is not None else None
            amount = resolve_amount(kind, hours, rate, stored)
            drafts.append({
                "project_id": None,
                "project_name": None,
                "billing_type": kind,
                "hours": hours if kind != "package" else None,
                "rate": rate if kind != "package" else None,
                "amount": amount,
                "description": clean_invoice_text(line.description),
                "preset_id": line.id,
            })
        else:
            raise ValueError("Unknown billing type")
    return drafts


def normalize_invoice_line(raw, project_name: str, *, one_off: bool = False, currency: str = "USD") -> dict:
    kind = raw.billing_type
    allowed = ONE_OFF_TYPES if one_off else DRAFT_TYPES
    if kind not in allowed:
        if one_off:
            raise ValueError("A one-off invoice can only use manual lines and extra charges")
        raise ValueError("Choose a billing type for each line")
    if kind == "extra":
        description = clean_invoice_text(raw.description)
        if not description:
            raise ValueError("An extra charge needs a description")
        amount = resolve_amount(kind, raw.hours, raw.rate, raw.amount)
        return {
            "project_id": None,
            "billing_type": "extra",
            "description": description,
            "hours": Decimal("0.00"),
            "rate": Decimal("0.00"),
            "amount": amount,
        }
    if kind in MANUAL_TYPES:
        description = clean_invoice_text(getattr(raw, "description", "") or "")
        hours = quantize_money(raw.hours) if _filled(raw.hours) and kind != "package" else None
        rate = quantize_money(raw.rate) if _filled(raw.rate) and kind != "package" else None
        amount = resolve_amount(kind, hours, rate, raw.amount)
        return {
            "project_id": None,
            "billing_type": kind,
            "description": description,
            "hours": hours or Decimal("0.00"),
            "rate": rate or Decimal("0.00"),
            "amount": amount,
        }
    if raw.project_id is None:
        raise ValueError("Each billing line needs a project")
    name = clean_invoice_text(project_name).replace("\n", " ") or "Project"
    if kind == "flat_fee":
        amount = quantize_money(raw.amount or 0)
        if amount < 0:
            raise ValueError("A flat fee cannot be negative")
        return {
            "project_id": raw.project_id,
            "billing_type": kind,
            "description": name,
            "hours": Decimal("0.00"),
            "rate": amount,
            "amount": amount,
        }
    hours = quantize_money(raw.hours or 0)
    rate = quantize_money(raw.rate or 0)
    if hours < 0 or rate < 0:
        raise ValueError("Hours and rate cannot be negative")
    amount = quantize_money(raw.amount) if raw.amount is not None else quantize_money(hours * rate)
    return {
        "project_id": raw.project_id,
        "billing_type": kind,
        "description": hour_description(name, hours, rate, amount, currency),
        "hours": hours,
        "rate": rate,
        "amount": amount,
    }
