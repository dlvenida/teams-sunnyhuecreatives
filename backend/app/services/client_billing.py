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
DETAIL_TYPES = ("hourly_task", "hourly_summary")
DRAFT_TYPES = SETUP_TYPES + ("extra",) + DETAIL_TYPES
HOURLY_SUMMARY_LABEL = "Hourly VA services"
PACKAGE_LINE_TYPES = ("package", "flat_fee")


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


def format_duration(hours) -> str:
    """Approved time as `2h 05m`, or `6h` when the minutes are zero."""
    minutes = int((quantize_money(hours) * Decimal("60")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    negative = minutes < 0
    minutes = abs(minutes)
    whole, mins = divmod(minutes, 60)
    text = f"{whole}h" if mins == 0 else f"{whole}h {mins:02d}m"
    return f"-{text}" if negative else text


def task_billing_mode(task) -> str:
    mode = getattr(task, "billing_mode", None) or "hourly"
    return mode if mode in ("hourly", "package") else "hourly"


def _log_status(log) -> str:
    status = getattr(log, "status", None)
    return status.value if hasattr(status, "value") else str(status or "")


def _is_approved(log) -> bool:
    return _log_status(log) == "approved"


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
    if kind in DETAIL_TYPES:
        description = clean_invoice_text(getattr(raw, "description", "") or "")
        if kind == "hourly_summary" and not description.strip():
            description = HOURLY_SUMMARY_LABEL
        hours = quantize_money(raw.hours or 0)
        rate = quantize_money(raw.rate or 0)
        if hours < 0 or rate < 0:
            raise ValueError("Hours and rate cannot be negative")
        amount = quantize_money(raw.amount) if raw.amount is not None else quantize_money(hours * rate)
        return {
            "project_id": getattr(raw, "project_id", None),
            "billing_type": kind,
            "description": description,
            "hours": hours,
            "rate": rate,
            "amount": amount,
        }
    if raw.project_id is None:
        raise ValueError("Each billing line needs a project")
    name = clean_invoice_text(project_name).replace("\n", " ") or "Project"
    if kind == "flat_fee":
        amount = quantize_money(raw.amount or 0)
        if amount < 0:
            raise ValueError("A flat fee cannot be negative")
        typed = clean_invoice_text(getattr(raw, "description", "") or "").replace("\n", " ").strip()
        return {
            "project_id": raw.project_id,
            "billing_type": kind,
            "description": typed or name,
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


def _task_included(task_id, mode: str, *, included_task_ids, excluded_task_ids, unassigned: bool, include_unassigned: bool) -> bool:
    """Hourly tasks are billed unless this invoice leaves them out. Package hours are never billed hourly."""
    if mode == "package":
        return False
    if unassigned:
        return include_unassigned
    if included_task_ids is not None:
        return task_id in set(included_task_ids)
    if excluded_task_ids is not None and task_id in set(excluded_task_ids):
        return False
    return True


def hourly_task_description(title: str, hours, rate, amount, currency: str = "USD") -> str:
    name = clean_invoice_text(title).replace("\n", " ").strip() or "Task"
    return f"{name} - {format_duration(hours)} x {money_usd(rate, currency)}/hr = {money_usd(amount, currency)}"


def package_invoice_text(description: str, amount, covered_hours, currency: str = "USD", show_time: bool = False) -> str:
    """Package fee text. Time spent is a note and is not a second charge."""
    text = clean_invoice_text(description).replace("\n", " ").strip() or "Package"
    if not show_time or quantize_money(covered_hours) <= 0:
        return text
    base = text[:-len("(Package)")].strip() if text.endswith("(Package)") else text
    return f"{base} - Package {money_usd(amount, currency)} (time spent: {format_duration(covered_hours)}, included)"


def _covered_hours(logs, tasks_by_id, line_id) -> Decimal:
    total = Decimal("0.00")
    for log in logs:
        if not _is_approved(log):
            continue
        task = tasks_by_id.get(getattr(log, "task_id", None))
        if task is None or getattr(task, "package_line_id", None) != line_id:
            continue
        total += Decimal(str(log.hours))
    return quantize_money(total)


def compose_invoice(
    setup_lines,
    logs,
    tasks,
    client_rate,
    currency: str = "USD",
    show_hourly_breakdown: bool = True,
    show_package_time: bool = False,
    included_task_ids=None,
    excluded_task_ids=None,
    include_unassigned: bool = True,
) -> dict:
    """Build one invoice from approved logs and the saved billing lines.

    Package-task hours never enter the hourly charges, even on the same project.
    The breakdown and package-time note are for this invoice only.
    """
    tasks_by_id = {task.id: task for task in tasks}
    rate = quantize_money(client_rate or 0)
    actual_projects = {
        line.project_id for line in setup_lines if line.billing_type == "actual_hours" and line.project_id
    }
    has_actual = any(line.billing_type == "actual_hours" for line in setup_lines)
    approved = [log for log in logs if _is_approved(log)]
    scope = [
        log for log in approved
        if not has_actual or not actual_projects or getattr(log, "project_id", None) in actual_projects
    ]

    buckets: dict = {}
    projects: dict = {}
    order = []
    for log in scope:
        task_id = getattr(log, "task_id", None)
        if task_id not in buckets:
            buckets[task_id] = Decimal("0.00")
            projects[task_id] = getattr(log, "project_id", None)
            order.append(task_id)
        buckets[task_id] += Decimal(str(log.hours))

    reviews = []
    for task_id in order:
        task = tasks_by_id.get(task_id) if task_id else None
        mode = task_billing_mode(task) if task else "hourly"
        hours = quantize_money(buckets[task_id])
        included = _task_included(
            task_id,
            mode,
            included_task_ids=included_task_ids,
            excluded_task_ids=excluded_task_ids,
            unassigned=task_id is None,
            include_unassigned=include_unassigned,
        )
        reviews.append({
            "task_id": task_id,
            "title": task.title if task else "Time without a task",
            "hours": hours,
            "billing_mode": mode,
            "included": included,
            "package_line_id": getattr(task, "package_line_id", None) if task and mode == "package" else None,
            "project_id": getattr(task, "project_id", None) if task else projects.get(task_id),
            "amount": quantize_money(hours * rate) if included else Decimal("0.00"),
        })
    reviews.sort(key=lambda row: (row["title"] or "").lower())

    hourly_lines = []
    hourly_hours = Decimal("0.00")
    hourly_amount = Decimal("0.00")
    included_rows = [row for row in reviews if row["included"] and row["hours"] > 0]
    if show_hourly_breakdown:
        for row in included_rows:
            amount = quantize_money(row["hours"] * rate)
            hourly_lines.append({
                "project_id": row["project_id"],
                "billing_type": "hourly_task",
                "description": hourly_task_description(row["title"], row["hours"], rate, amount, currency),
                "hours": row["hours"],
                "rate": rate,
                "amount": amount,
                "preset_id": None,
            })
            hourly_hours += row["hours"]
            hourly_amount += amount
    elif included_rows:
        for row in included_rows:
            hourly_hours += row["hours"]
            hourly_amount += quantize_money(row["hours"] * rate)
        hourly_hours = quantize_money(hourly_hours)
        hourly_amount = quantize_money(hourly_amount)
        hourly_lines.append({
            "project_id": included_rows[0]["project_id"] if len({row["project_id"] for row in included_rows}) == 1 else None,
            "billing_type": "hourly_summary",
            "description": HOURLY_SUMMARY_LABEL,
            "hours": hourly_hours,
            "rate": rate,
            "amount": hourly_amount,
            "preset_id": None,
        })
    hourly_hours = quantize_money(hourly_hours)
    hourly_amount = quantize_money(hourly_amount)

    other_lines = []
    for line in setup_lines:
        kind = line.billing_type
        if kind == "actual_hours":
            continue
        if kind in PACKAGE_LINE_TYPES:
            amount = quantize_money(line.default_amount or 0)
            covered = _covered_hours(approved, tasks_by_id, line.id)
            other_lines.append({
                "project_id": line.project_id,
                "billing_type": kind,
                "description": package_invoice_text(line.description or "", amount, covered, currency, show_package_time),
                "hours": Decimal("0.00"),
                "rate": Decimal("0.00") if kind == "package" else amount,
                "amount": amount,
                "preset_id": line.id,
            })
            continue
        other_lines.extend(build_setup_drafts([line], logs, client_rate, currency, ))

    lines = hourly_lines + other_lines
    package_total = quantize_money(sum(
        (row["amount"] for row in other_lines if row["billing_type"] in PACKAGE_LINE_TYPES),
        Decimal("0.00"),
    ))
    amount = quantize_money(sum((row["amount"] for row in lines), Decimal("0.00")))
    total_hours = quantize_money(sum(
        (row["hours"] or 0 for row in lines if row["billing_type"] not in PACKAGE_LINE_TYPES),
        Decimal("0.00"),
    ))
    package_tasks = []
    seen = set()
    for log in approved:
        task = tasks_by_id.get(getattr(log, "task_id", None))
        if task is None or task_billing_mode(task) != "package" or task.id in seen:
            continue
        seen.add(task.id)
        task_hours = quantize_money(sum(
            (Decimal(str(item.hours)) for item in approved if getattr(item, "task_id", None) == task.id),
            Decimal("0.00"),
        ))
        package_tasks.append({
            "task_id": task.id,
            "title": task.title,
            "hours": task_hours,
            "billing_mode": "package",
            "included": False,
            "package_line_id": getattr(task, "package_line_id", None),
            "project_id": task.project_id,
            "amount": Decimal("0.00"),
        })
    package_tasks.sort(key=lambda row: row["title"].lower())
    return {
        "lines": lines,
        "task_reviews": reviews,
        "package_tasks": package_tasks,
        "hourly_subtotal": hourly_amount,
        "package_total": package_total,
        "amount": amount,
        "total_hours": total_hours,
        "show_hourly_breakdown": show_hourly_breakdown,
        "show_package_time": show_package_time,
    }
