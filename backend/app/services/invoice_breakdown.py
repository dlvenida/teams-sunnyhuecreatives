"""Itemized client invoice groups.

Built from approved logs at generate time. This module only reads log fields.
It never changes hours, pay, status, or clock data.
"""
from datetime import date
from decimal import Decimal

from app.services.client_billing import clean_invoice_text, format_hours_number, quantize_money
from app.services.log_display import log_task_name

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_HOURLY_KINDS = {"hourly", "actual_hours", "entered_hours"}


def format_work_date(value) -> str:
    if not isinstance(value, date):
        return ""
    return f"{_MONTHS[value.month - 1]} {value.day}, {value.year}"


def money_str(value) -> str:
    return f"{quantize_money(value or 0):.2f}"


def first_sentence(text: str | None, limit: int = 180) -> str:
    cleaned = clean_invoice_text(text).replace("\n", " ").strip()
    if not cleaned:
        return ""
    cut = cleaned.find(". ")
    sentence = cleaned[: cut + 1] if cut != -1 else cleaned
    if len(sentence) > limit:
        return sentence[: limit - 3].rstrip() + "..."
    return sentence


def compose(*parts: str | None) -> str:
    chunks = []
    for part in parts:
        text = clean_invoice_text(part)
        if text:
            chunks.append(text)
    return "\n".join(chunks)


def task_title(log) -> str:
    return clean_invoice_text(log_task_name(log) or "Logged work").replace("\n", " ") or "Logged work"


def task_note(log) -> str:
    return clean_invoice_text(getattr(log, "description_plain", None) or "")


def _sort_logs(logs) -> list:
    return sorted(
        logs,
        key=lambda log: (getattr(log, "work_date", None) or date.min, str(getattr(log, "id", ""))),
    )


def task_block(log, *, reference: bool) -> str:
    when = format_work_date(getattr(log, "work_date", None))
    hours = format_hours_number(getattr(log, "hours", 0) or 0)
    unit = "hrs logged" if reference else "hrs"
    header = " - ".join(part for part in (when, task_title(log), f"{hours} {unit}") if part)
    note = task_note(log)
    return f"{header}\n{note}" if note else header


def line_description(title: str | None, logs, *, reference: bool) -> str:
    blocks = [task_block(log, reference=reference) for log in _sort_logs(logs)]
    return compose(title, "\n".join(blocks))


def _task_dict(log, *, hours, rate, amount, reference: bool) -> dict:
    work_date = getattr(log, "work_date", None)
    return {
        "date": work_date.isoformat() if isinstance(work_date, date) else "",
        "date_label": format_work_date(work_date),
        "name": task_title(log),
        "description": task_note(log),
        "hours": money_str(hours),
        "rate": None if rate is None else money_str(rate),
        "amount": None if amount is None else money_str(amount),
        "reference_only": reference,
    }


def split_hourly(logs, rate, target_amount) -> list[tuple]:
    """Per-task amounts. The last row absorbs rounding so the rows match the line total."""
    ordered = _sort_logs(logs)
    rate_q = quantize_money(rate or 0)
    rows = []
    for log in ordered:
        hours = quantize_money(getattr(log, "hours", 0) or 0)
        rows.append([log, hours, quantize_money(hours * rate_q)])
    if not rows:
        return []
    if target_amount is None:
        target = sum((row[2] for row in rows), Decimal("0"))
    else:
        target = quantize_money(target_amount)
    diff = target - sum((row[2] for row in rows), Decimal("0"))
    rows[-1][2] = quantize_money(rows[-1][2] + diff)
    return [(row[0], row[1], row[2]) for row in rows]


def group_hourly_logs(logs, rate, target_amount=None) -> list[dict]:
    if not logs:
        return []
    pieces = split_hourly(logs, rate, target_amount)
    buckets: dict[str, list] = {}
    order: list[str] = []
    for log, hours, amount in pieces:
        name = task_title(log)
        if name not in buckets:
            order.append(name)
            buckets[name] = []
        buckets[name].append((log, hours, amount))
    rate_q = quantize_money(rate or 0)
    groups = []
    for name in order:
        items = buckets[name]
        tasks = [
            _task_dict(log, hours=hours, rate=rate_q, amount=amount, reference=False)
            for log, hours, amount in items
        ]
        hours_sum = sum((item[1] for item in items), Decimal("0"))
        amount_sum = sum((item[2] for item in items), Decimal("0"))
        notes = " ".join(task_note(item[0]) for item in items if task_note(item[0]))
        groups.append({
            "name": name,
            "billing": "hourly",
            "summary": first_sentence(notes),
            "detail": "\n".join(task_block(item[0], reference=False) for item in items),
            "client_note": "",
            "hours": money_str(hours_sum),
            "rate": money_str(rate_q),
            "amount": money_str(amount_sum),
            "reference_hours": False,
            "tasks": tasks,
        })
    return groups


def flat_group(typed_description: str | None, amount, logs) -> dict:
    ordered = _sort_logs(logs)
    names: list[str] = []
    for log in ordered:
        title = task_title(log)
        if title not in names:
            names.append(title)
    typed = clean_invoice_text(typed_description)
    typed_first = typed.split("\n", 1)[0].strip() if typed else ""
    if len(names) == 1:
        name = names[0]
    elif typed_first:
        name = typed_first
    else:
        name = "Package"
    note_bits = [task_note(log) for log in ordered if task_note(log)]
    summary_source = typed if typed and typed != name else (note_bits[0] if note_bits else "")
    detail = compose(
        typed if typed and typed != name else "",
        "\n".join(task_block(log, reference=True) for log in ordered),
    )
    hours_sum = sum((quantize_money(getattr(log, "hours", 0) or 0) for log in ordered), Decimal("0"))
    flat = quantize_money(amount or 0)
    single = len(ordered) == 1
    tasks = [
        _task_dict(
            log,
            hours=quantize_money(getattr(log, "hours", 0) or 0),
            rate=None,
            amount=flat if single else None,
            reference=True,
        )
        for log in ordered
    ]
    return {
        "name": name,
        "billing": "flat",
        "summary": first_sentence(summary_source),
        "detail": detail or typed or name,
        "client_note": typed if typed and typed != name else "",
        "hours": money_str(hours_sum),
        "rate": None,
        "amount": money_str(flat),
        "reference_hours": True,
        "tasks": tasks,
    }


def plain_group(description: str | None, hours, rate, amount, billing: str) -> dict | None:
    text = clean_invoice_text(description)
    hours_q = quantize_money(hours or 0)
    amount_q = quantize_money(amount or 0)
    rate_q = quantize_money(rate or 0)
    if not text and amount_q == 0 and hours_q == 0:
        return None
    lines = [line for line in (text.split("\n") if text else []) if line.strip()]
    name = lines[0].strip() if lines else "Services"
    rest = "\n".join(text.split("\n")[1:]).strip() if text else ""
    hourly = billing in _HOURLY_KINDS or (billing == "manual" and hours_q > 0 and rate_q > 0)
    return {
        "name": name,
        "billing": "hourly" if hourly else ("extra" if billing == "extra" else "flat"),
        "summary": first_sentence(rest or text),
        "detail": rest or text or name,
        "client_note": rest if rest else "",
        "hours": money_str(hours_q),
        "rate": money_str(rate_q) if hourly else None,
        "amount": money_str(amount_q),
        "reference_hours": False,
        "tasks": [],
    }


def groups_for_charge(row: dict) -> list[dict]:
    logs = list(row.get("task_logs") or [])
    if logs and not row.get("reference_only"):
        return group_hourly_logs(logs, row.get("rate") or 0, row.get("amount"))
    if row.get("reference_only"):
        return [flat_group(row.get("typed_description") or "", row.get("amount") or 0, logs)]
    group = plain_group(
        row.get("typed_description") or row.get("description") or "",
        row.get("hours") or 0,
        row.get("rate") or 0,
        row.get("amount") or 0,
        row.get("billing_type") or "manual",
    )
    return [group] if group else []


def breakdown_payload(service_title: str | None, groups: list[dict]) -> dict:
    return {
        "service_title": clean_invoice_text(service_title) or "",
        "groups": groups,
    }


def attach_log_text(row: dict, logs, *, reference: bool, title: str | None = None) -> dict:
    """Copy task name, date, and description onto the charge line. Hours on a reference line stay off the amount."""
    ordered = _sort_logs(list(logs))
    updated = dict(row)
    typed = clean_invoice_text(updated.get("typed_description") or updated.get("description") or "")
    updated["typed_description"] = typed
    updated["task_logs"] = ordered
    updated["reference_only"] = reference
    heading = clean_invoice_text(title) if title is not None else typed
    if reference:
        updated["description"] = compose(typed, "\n".join(task_block(log, reference=True) for log in ordered))
        updated["hours"] = Decimal("0.00")
        updated["rate"] = Decimal("0.00")
    else:
        updated["description"] = line_description(heading, ordered, reference=False)
    return updated


def pop_private(row: dict) -> dict:
    clean = dict(row)
    clean.pop("task_logs", None)
    clean.pop("reference_only", None)
    clean.pop("typed_description", None)
    return clean


def walk_strings(value) -> list[str]:
    found: list[str] = []
    if isinstance(value, str):
        found.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            found.extend(walk_strings(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(walk_strings(item))
    return found
