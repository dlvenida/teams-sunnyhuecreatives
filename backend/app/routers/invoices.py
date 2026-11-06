from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import (
    BillingType,
    Client,
    ClientBillingLine,
    ClientPackage,
    Invoice,
    InvoiceLineItem,
    InvoiceStatus,
    Project,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import (
    ClientBillingLineResponse,
    ClientBillingLineWrite,
    InvoiceDraftLineResponse,
    InvoiceGenerateRequest,
    PeriodLogRow,
    InvoiceLineItemResponse,
    InvoiceLineItemUpdate,
    InvoicePrepareResponse,
    InvoicePreviewResponse,
    InvoiceResponse,
)
from app.services.billing import get_billing_period, next_invoice_number
from app.services.client_billing import (
    MANUAL_TYPES,
    ONE_OFF_TYPES,
    PROJECT_TYPES,
    SETUP_TYPES,
    build_setup_drafts,
    clean_invoice_text,
    hour_description,
    normalize_invoice_line,
    quantize_money,
)

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _invoice_amount(
    billing_type: BillingType,
    rate: Decimal,
    total_hours: Decimal,
    included_hours: Decimal | None = None,
    overage_rate: Decimal | None = None,
) -> tuple[Decimal, Decimal | None, Decimal | None]:
    """Return (amount, overage_hours, overage_amount)."""
    if billing_type == BillingType.hourly:
        return (total_hours * rate).quantize(Decimal("0.01")), None, None
    if billing_type == BillingType.package_hours:
        included = included_hours or Decimal("0")
        overage_hrs = max(Decimal("0"), total_hours - included)
        overage_amt = (overage_hrs * (overage_rate or Decimal("0"))).quantize(Decimal("0.01"))
        return (rate + overage_amt).quantize(Decimal("0.01")), overage_hrs, overage_amt
    return rate, None, None


def _serialize_invoice(inv: Invoice) -> InvoiceResponse:
    return InvoiceResponse(
        id=inv.id,
        invoice_number=inv.invoice_number,
        client_id=inv.client_id,
        client_name=(inv.client.name if inv.client else None) or inv.one_off_name,
        one_off_name=inv.one_off_name,
        one_off_email=inv.one_off_email,
        one_off_business=inv.one_off_business,
        one_off_address=inv.one_off_address,
        currency=inv.currency or "USD",
        period_label=inv.period_label,
        period_start=inv.period_start,
        period_end=inv.period_end,
        total_hours=inv.total_hours,
        billing_type=inv.billing_type,
        rate=inv.rate,
        amount=inv.amount,
        status=inv.status,
        payment_method=inv.payment_method,
        bank_details=inv.bank_details,
        payment_terms_days=inv.payment_terms_days,
        issue_date=inv.issue_date,
        due_date=inv.due_date,
        paid_at=inv.paid_at,
        line_items=[
            InvoiceLineItemResponse(
                id=li.id,
                line_date=li.line_date,
                description=clean_invoice_text(li.description),
                hours=li.hours,
                rate=li.rate,
                amount=li.amount,
                line_kind=li.line_kind,
                project_id=li.project_id,
            )
            for li in inv.line_items
        ],
    )


@router.get("", response_model=list[InvoiceResponse])
def list_invoices(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    invoices = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .order_by(Invoice.created_at.desc())
        .all()
    )
    return [_serialize_invoice(inv) for inv in invoices]


@router.get("/next-number")
def get_next_invoice_number(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    year: int | None = None,
):
    numbers = [inv.invoice_number for inv in db.query(Invoice.invoice_number).all()]
    return {"invoice_number": next_invoice_number(numbers, year)}


@router.get("/period-logs", response_model=list[PeriodLogRow])
def list_period_logs(
    client_id: UUID,
    year: int,
    month: int,
    cutoff: int,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Approved logs for one client and billing period. Nothing is changed."""
    period_start, period_end, _label = get_billing_period(year, month, cutoff)
    logs = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.task), joinedload(WorkLog.va))
        .filter(
            WorkLog.client_id == client_id,
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
            WorkLog.status == WorkLogStatus.approved,
        )
        .order_by(WorkLog.work_date, WorkLog.created_at)
        .all()
    )
    rows = []
    for log in logs:
        task_name = (log.task_name or "").strip()
        if not task_name and log.task is not None:
            task_name = log.task.title
        rows.append(PeriodLogRow(
            id=log.id,
            work_date=log.work_date,
            task_name=task_name or "Logged work",
            description=log.description_plain or "",
            hours=log.hours,
            va_name=log.va.name if log.va else None,
            project_id=log.project_id,
        ))
    return rows


def _period_logs(db: Session, client_id: UUID, period_start, period_end):
    base = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.sub_client))
        .filter(
            WorkLog.client_id == client_id,
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
        )
    )
    approved = base.filter(WorkLog.status == WorkLogStatus.approved).order_by(WorkLog.work_date).all()
    submitted_count = (
        db.query(WorkLog)
        .filter(
            WorkLog.client_id == client_id,
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
            WorkLog.status == WorkLogStatus.submitted,
        )
        .count()
    )
    return approved, submitted_count


def _format_hours_label(hours: Decimal) -> str:
    total_mins = int(round(float(hours) * 60))
    h, m = divmod(total_mins, 60)
    if h == 0:
        return f"{m} mins"
    if m == 0:
        return f"{h} hrs"
    return f"{h} hrs {m} mins"


def _format_date_span(dates: list[date]) -> str:
    unique = sorted(set(dates))
    if not unique:
        return ""
    if len(unique) == 1:
        d = unique[0]
        return f"{d.strftime('%B')} {d.day}, {d.year}"
    if len(unique) == 2:
        a, b = unique
        if a.month == b.month and a.year == b.year:
            return f"{a.strftime('%B')} {a.day} and {b.day}, {a.year}"
        return f"{a.strftime('%B')} {a.day}, {a.year} and {b.strftime('%B')} {b.day}, {b.year}"
    a, b = unique[0], unique[-1]
    if a.month == b.month and a.year == b.year:
        return f"{a.strftime('%B')} {a.day} to {b.day}, {a.year}"
    return f"{a.strftime('%B')} {a.day}, {a.year} to {b.strftime('%B')} {b.day}, {b.year}"


@router.get("/preview", response_model=InvoicePreviewResponse)
def preview_invoice(
    client_id: UUID,
    year: int,
    month: int,
    cutoff: int,
    billing_type: BillingType,
    rate: Decimal,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    package_id: UUID | None = None,
    included_hours: Decimal | None = None,
    overage_rate: Decimal | None = None,
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    if package_id:
        pkg = db.query(ClientPackage).filter(ClientPackage.id == package_id, ClientPackage.client_id == client_id).first()
        if pkg:
            billing_type = pkg.billing_type
            rate = pkg.amount
            included_hours = pkg.included_hours
            overage_rate = pkg.overage_rate

    period_start, period_end, period_label = get_billing_period(year, month, cutoff)
    approved, submitted_count = _period_logs(db, client_id, period_start, period_end)
    total_hours = sum((log.hours for log in approved), Decimal("0"))

    estimated = overage_hrs = overage_amt = None
    # Client invoices are independent of VA timesheet/payroll approval.
    # Fixed/package can generate with just a rate; hourly uses approved hours when present.
    package_ok = billing_type in (BillingType.fixed, BillingType.package_hours) and rate > 0
    if approved or package_ok:
        hours_for_est = total_hours if billing_type == BillingType.hourly else total_hours
        estimated, overage_hrs, overage_amt = _invoice_amount(
            billing_type, rate, hours_for_est, included_hours, overage_rate
        )

    can_generate = package_ok or (billing_type == BillingType.hourly and rate > 0 and len(approved) > 0)
    # Allow hourly with rate even without logs → admin can edit a single service line after generate
    if billing_type == BillingType.hourly and rate > 0 and not approved:
        can_generate = True
        estimated = Decimal("0.00")
        message = (
            "No approved time logs yet — you can still generate a client invoice and customize the "
            "service description. (Independent of VA timesheet / payroll approval.)"
        )
    elif approved:
        message = (
            f"Ready to invoice{f' {len(approved)} approved entries' if approved else ''}. "
            "Client invoice is independent of VA timesheet approval."
        )
    elif package_ok:
        message = (
            f"Ready to generate a {billing_type.replace('_', ' ')} invoice for {period_label} "
            "(no VA timesheet approval required)."
        )
    elif submitted_count:
        message = (
            f"{submitted_count} submitted entries awaiting approval — optional for client invoices. "
            "You can still generate a package invoice, or approve logs for hourly billing."
        )
    else:
        message = "Set a rate/amount to generate. Client invoices do not require VA timesheet approval."

    return InvoicePreviewResponse(
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        approved_entries=len(approved),
        submitted_entries=submitted_count,
        total_hours=total_hours,
        estimated_amount=estimated,
        billing_type=billing_type,
        can_generate=can_generate,
        message=message,
        included_hours=included_hours,
        overage_hours=overage_hrs,
        overage_amount=overage_amt,
    )


def _billing_line_response(line: ClientBillingLine) -> ClientBillingLineResponse:
    return ClientBillingLineResponse(
        id=line.id,
        client_id=line.client_id,
        project_id=line.project_id,
        project_name=line.project.name if line.project else None,
        billing_type=line.billing_type,
        description=line.description,
        default_hours=line.default_hours,
        default_rate=line.default_rate,
        default_amount=line.default_amount,
        sort_order=line.sort_order,
    )


def _load_billing_lines(db: Session, client_id: UUID) -> list[ClientBillingLine]:
    return (
        db.query(ClientBillingLine)
        .options(joinedload(ClientBillingLine.project))
        .filter(ClientBillingLine.client_id == client_id)
        .order_by(ClientBillingLine.sort_order, ClientBillingLine.created_at)
        .all()
    )


def _project_for_client(db: Session, client_id: UUID, project_id: UUID) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.client_id == client_id).first()
    if not project:
        raise HTTPException(status_code=400, detail="Choose a project that belongs to this client")
    return project


@router.get("/clients/{client_id}/billing-lines", response_model=list[ClientBillingLineResponse])
def list_billing_lines(
    client_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if not db.query(Client.id).filter(Client.id == client_id).first():
        raise HTTPException(status_code=404, detail="Client not found")
    return [_billing_line_response(line) for line in _load_billing_lines(db, client_id)]


@router.put("/clients/{client_id}/billing-lines", response_model=list[ClientBillingLineResponse])
def save_billing_lines(
    client_id: UUID,
    body: list[ClientBillingLineWrite],
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Replace the saved setup. This does not change invoices already created."""
    if not db.query(Client.id).filter(Client.id == client_id).first():
        raise HTTPException(status_code=404, detail="Client not found")
    for item in body:
        if item.billing_type not in SETUP_TYPES:
            raise HTTPException(status_code=400, detail="Billing type is not supported")
        if item.billing_type in PROJECT_TYPES:
            if item.project_id is None:
                raise HTTPException(status_code=400, detail="Choose a project that belongs to this client")
            _project_for_client(db, client_id, item.project_id)
        elif item.project_id is not None:
            _project_for_client(db, client_id, item.project_id)
        if item.billing_type == "entered_hours" and (item.default_hours is None or item.default_hours < 0):
            raise HTTPException(status_code=400, detail="Entered hours need a default hour amount")
        if item.billing_type in ("flat_fee", "package") and (item.default_amount is None or item.default_amount < 0):
            raise HTTPException(status_code=400, detail="This line needs an amount")
    db.query(ClientBillingLine).filter(ClientBillingLine.client_id == client_id).delete(synchronize_session=False)
    for index, item in enumerate(body):
        db.add(
            ClientBillingLine(
                client_id=client_id,
                project_id=item.project_id,
                billing_type=item.billing_type,
                description=clean_invoice_text(item.description) if item.description else None,
                default_hours=quantize_money(item.default_hours) if item.default_hours is not None else None,
                default_rate=quantize_money(item.default_rate) if item.default_rate is not None else None,
                default_amount=quantize_money(item.default_amount) if item.default_amount is not None else None,
                sort_order=index,
            )
        )
    db.commit()
    return [_billing_line_response(line) for line in _load_billing_lines(db, client_id)]


@router.post("/clients/{client_id}/billing-lines", response_model=ClientBillingLineResponse, status_code=status.HTTP_201_CREATED)
def add_billing_preset(
    client_id: UUID,
    body: ClientBillingLineWrite,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Append one preset. Existing presets and any open invoice stay as they are."""
    if not db.query(Client.id).filter(Client.id == client_id).first():
        raise HTTPException(status_code=404, detail="Client not found")
    if body.billing_type not in SETUP_TYPES:
        raise HTTPException(status_code=400, detail="Billing type is not supported")
    if body.billing_type in PROJECT_TYPES:
        if body.project_id is None:
            raise HTTPException(status_code=400, detail="Choose a project that belongs to this client")
        _project_for_client(db, client_id, body.project_id)
    elif body.project_id is not None:
        _project_for_client(db, client_id, body.project_id)
    if body.billing_type in ("flat_fee", "package") and (body.default_amount is None or body.default_amount < 0):
        raise HTTPException(status_code=400, detail="This line needs an amount")
    current = _load_billing_lines(db, client_id)
    row = ClientBillingLine(
        client_id=client_id,
        project_id=body.project_id,
        billing_type=body.billing_type,
        description=clean_invoice_text(body.description) if body.description else None,
        default_hours=quantize_money(body.default_hours) if body.default_hours is not None else None,
        default_rate=quantize_money(body.default_rate) if body.default_rate is not None else None,
        default_amount=quantize_money(body.default_amount) if body.default_amount is not None else None,
        sort_order=len(current),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    row = (
        db.query(ClientBillingLine)
        .options(joinedload(ClientBillingLine.project))
        .filter(ClientBillingLine.id == row.id)
        .first()
    )
    return _billing_line_response(row)


@router.delete("/clients/{client_id}/billing-lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_billing_preset(
    client_id: UUID,
    line_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(ClientBillingLine).filter(
        ClientBillingLine.id == line_id,
        ClientBillingLine.client_id == client_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(row)
    db.commit()


@router.get("/prepare", response_model=InvoicePrepareResponse)
def prepare_invoice(
    client_id: UUID,
    year: int,
    month: int,
    cutoff: int,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Pre-fill one period from the saved setup. Nothing is stored."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    period_start, period_end, period_label = get_billing_period(year, month, cutoff)
    approved, _submitted = _period_logs(db, client_id, period_start, period_end)
    setup = _load_billing_lines(db, client_id)
    drafts = build_setup_drafts(setup, approved, client.default_rate or 0)
    if setup:
        message = "Lines are filled from this client's billing setup. Changes here stay on this invoice."
    else:
        message = "This client has no saved billing lines yet. Add lines for this invoice, or save a setup on the client."
    return InvoicePrepareResponse(
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        client_rate=quantize_money(client.default_rate or 0),
        lines=[InvoiceDraftLineResponse(**row) for row in drafts],
        message=message,
    )


def _remaining_hourly_line(
    db: Session,
    client_id: UUID,
    period_start,
    period_end,
    period_label: str,
    rate: Decimal,
    pulled_ids: set[UUID],
) -> dict | None:
    """Hourly charge for approved logs that were not pulled onto a manual line."""
    approved, _submitted = _period_logs(db, client_id, period_start, period_end)
    remaining = [log for log in approved if log.id not in pulled_ids]
    hours = sum((log.hours for log in remaining), Decimal("0"))
    if hours <= 0:
        return None
    amount = (hours * rate).quantize(Decimal("0.01"))
    label = period_label.replace("\u2013", "-").replace("\u2014", "-")
    return {
        "project_id": None,
        "billing_type": "hourly",
        "description": f"Social Media VA Services - {label}",
        "hours": quantize_money(hours),
        "rate": quantize_money(rate),
        "amount": amount,
    }


def _project_hours_excluding(db: Session, client_id: UUID, period_start, period_end, project_id: UUID, pulled_ids: set[UUID]) -> Decimal:
    approved, _submitted = _period_logs(db, client_id, period_start, period_end)
    hours = sum(
        (log.hours for log in approved if log.project_id == project_id and log.id not in pulled_ids),
        Decimal("0"),
    )
    return quantize_money(hours)


def _generate_flexible(db: Session, body: InvoiceGenerateRequest, client: Client | None, period_start, period_end, period_label) -> Invoice:
    """Create an invoice from the reviewed lines. Logs, presets, and the client list stay as they are."""
    one_off = bool((body.one_off_name or "").strip())
    if one_off and client is not None:
        raise HTTPException(status_code=400, detail="A one-off invoice does not use a saved client")
    if not one_off and client is None:
        raise HTTPException(status_code=400, detail="Choose a client or type a one-off client name")
    if not body.lines:
        raise HTTPException(status_code=400, detail="Add at least one billing line or extra charge")
    pulled_ids: set[UUID] = set()
    prepared_lines = []
    for raw in body.lines:
        if raw.billing_type == "manual" and raw.pulled_log_ids:
            pulled_ids.update(raw.pulled_log_ids)
            # Hours on a pulled line are a reference in the admin screen only.
            raw = raw.model_copy(update={"hours": None, "rate": None})
        prepared_lines.append(raw)
    body = body.model_copy(update={"lines": prepared_lines})
    currency = (body.currency or "USD").upper()
    if currency not in ("USD", "PHP"):
        raise HTTPException(status_code=400, detail="Currency must be USD or PHP")
    normalized = []
    for raw in body.lines:
        project_name = "Project"
        if raw.billing_type in PROJECT_TYPES:
            if one_off or client is None or raw.project_id is None:
                raise HTTPException(status_code=400, detail="A one-off invoice can only use manual lines and extra charges")
            project_name = _project_for_client(db, client.id, raw.project_id).name
        try:
            row = normalize_invoice_line(raw, project_name, one_off=one_off, currency=currency)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if raw.billing_type == "actual_hours" and pulled_ids and raw.project_id is not None and client is not None:
            hours = _project_hours_excluding(db, client.id, period_start, period_end, raw.project_id, pulled_ids)
            if hours <= 0:
                continue
            rate = quantize_money(raw.rate if raw.rate is not None else (body.rate or 0))
            amount = quantize_money(hours * rate)
            row = {
                "project_id": raw.project_id,
                "billing_type": "actual_hours",
                "description": hour_description(project_name, hours, rate, amount, currency),
                "hours": hours,
                "rate": rate,
                "amount": amount,
            }
        normalized.append(row)
    has_hour_line = any(row["billing_type"] in {"entered_hours", "actual_hours", "hourly"} for row in normalized)
    if (
        pulled_ids
        and not has_hour_line
        and client is not None
        and body.billing_type == BillingType.hourly
        and body.rate is not None
    ):
        hourly_line = _remaining_hourly_line(
            db, client.id, period_start, period_end, period_label, body.rate, pulled_ids,
        )
        if hourly_line is not None:
            normalized.insert(0, hourly_line)
    hour_kinds = {"entered_hours", "actual_hours", "hourly", "manual"}
    kinds = {row["billing_type"] for row in normalized if row["billing_type"] != "extra"}
    if kinds <= {"flat_fee", "package", "extra"} or not kinds:
        billing_type = BillingType.fixed
    else:
        billing_type = BillingType.hourly
    total_hours = sum((row["hours"] for row in normalized if row["billing_type"] in hour_kinds), Decimal("0"))
    amount = sum((row["amount"] for row in normalized), Decimal("0")).quantize(Decimal("0.01"))
    rate = next((row["rate"] for row in normalized if row["billing_type"] in hour_kinds), amount)
    numbers = [inv.invoice_number for inv in db.query(Invoice.invoice_number).all()]
    invoice_number = body.invoice_number or next_invoice_number(numbers, body.year)
    if db.query(Invoice).filter(Invoice.invoice_number == invoice_number).first():
        raise HTTPException(status_code=400, detail="Invoice number already exists")
    issue_date = date.today()
    invoice = Invoice(
        invoice_number=invoice_number,
        client_id=None if one_off else client.id,
        one_off_name=clean_invoice_text(body.one_off_name) if one_off else None,
        one_off_email=(body.one_off_email or "").strip() or None if one_off else None,
        one_off_business=clean_invoice_text(body.one_off_business) if one_off and body.one_off_business else None,
        one_off_address=clean_invoice_text(body.one_off_address) if one_off and body.one_off_address else None,
        currency=currency,
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        total_hours=quantize_money(total_hours),
        billing_type=billing_type,
        rate=quantize_money(rate or 0),
        amount=amount,
        status=InvoiceStatus.unpaid,
        payment_method=body.payment_method,
        bank_details=body.bank_details,
        payment_terms_days=body.payment_terms_days,
        issue_date=issue_date,
        due_date=issue_date + timedelta(days=body.payment_terms_days),
    )
    db.add(invoice)
    db.flush()
    for row in normalized:
        db.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                work_log_id=None,
                project_id=row["project_id"],
                line_kind=row["billing_type"],
                line_date=period_end,
                description=row["description"],
                hours=row["hours"],
                rate=row["rate"],
                amount=row["amount"],
            )
        )
    db.commit()
    return (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice.id)
        .first()
    )


@router.post("/generate", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def generate_invoice(
    body: InvoiceGenerateRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    one_off_name = (body.one_off_name or "").strip()
    if one_off_name or body.lines is not None:
        client = None
        if not one_off_name:
            client = db.query(Client).filter(Client.id == body.client_id).first()
            if not client:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
        elif body.client_id is not None:
            raise HTTPException(status_code=400, detail="A one-off invoice does not use a saved client")
        before_clients = db.query(Client).count()
        period_start, period_end, period_label = get_billing_period(body.year, body.month, body.cutoff)
        invoice = _generate_flexible(db, body, client, period_start, period_end, period_label)
        if db.query(Client).count() != before_clients:
            raise HTTPException(status_code=500, detail="A one-off invoice must not create a client")
        return _serialize_invoice(invoice)

    client = db.query(Client).filter(Client.id == body.client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    period_start, period_end, period_label = get_billing_period(body.year, body.month, body.cutoff)

    logs, _ = _period_logs(db, body.client_id, period_start, period_end)

    billing_type = body.billing_type
    rate = body.rate
    included_hours = body.included_hours
    overage_rate = body.overage_rate
    if body.package_id:
        pkg = db.query(ClientPackage).filter(ClientPackage.id == body.package_id, ClientPackage.client_id == body.client_id).first()
        if pkg:
            billing_type = body.billing_type or pkg.billing_type
            if body.included_hours is None:
                included_hours = pkg.included_hours
            if body.overage_rate is None:
                overage_rate = pkg.overage_rate
            # body.rate is Jane's override (auto-filled from package in UI)

    if billing_type is None or rate is None:
        raise HTTPException(status_code=400, detail="Choose a billing type and a rate")

    # Client invoices are independent of VA timesheet / payroll approval.
    # Fixed & package invoices can be created with no work logs.
    if not logs and billing_type == BillingType.hourly and rate <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter a rate to generate, or wait for approved time logs",
        )
    if not logs and billing_type not in (BillingType.fixed, BillingType.package_hours, BillingType.hourly):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to invoice for this period")

    total_hours = sum((log.hours for log in logs), Decimal("0"))
    amount, overage_hrs, overage_amt = _invoice_amount(billing_type, rate, total_hours, included_hours, overage_rate)

    numbers = [inv.invoice_number for inv in db.query(Invoice.invoice_number).all()]
    invoice_number = body.invoice_number or next_invoice_number(numbers, body.year)

    if db.query(Invoice).filter(Invoice.invoice_number == invoice_number).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice number already exists")

    issue_date = date.today()
    due_date = issue_date + timedelta(days=body.payment_terms_days)

    invoice = Invoice(
        invoice_number=invoice_number,
        client_id=body.client_id,
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        total_hours=total_hours,
        billing_type=billing_type,
        rate=rate,
        amount=amount,
        status=InvoiceStatus.unpaid,
        payment_method=body.payment_method,
        bank_details=body.bank_details,
        payment_terms_days=body.payment_terms_days,
        issue_date=issue_date,
        due_date=due_date,
    )
    db.add(invoice)
    db.flush()

    for log in logs:
        log.status = WorkLogStatus.invoiced
        log.invoice_id = invoice.id

    custom = (body.service_description or "").strip()
    # Never invent package marketing copy. Blank → service title + period only.
    default_service = f"Social Media VA Services - {period_label}"

    def _client_desc(fallback_title: str) -> str:
        if custom:
            return custom
        return fallback_title

    # Client-facing lines: custom text exactly as typed, or a clean service + period default.
    if custom:
        db.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                work_log_id=None,
                line_date=period_end,
                description=custom,
                hours=total_hours,
                rate=rate,
                amount=amount,
            )
        )
    elif billing_type == BillingType.hourly:
        if logs:
            groups: dict[UUID | None, list[WorkLog]] = {}
            for log in logs:
                groups.setdefault(log.sub_client_id, []).append(log)

            for group_logs in groups.values():
                label = (
                    group_logs[0].sub_client.name
                    if group_logs[0].sub_client is not None
                    else client.name
                )
                group_hours = sum((log.hours for log in group_logs), Decimal("0"))
                group_amount = (group_hours * rate).quantize(Decimal("0.01"))
                db.add(
                    InvoiceLineItem(
                        invoice_id=invoice.id,
                        work_log_id=None,
                        line_date=period_end,
                        description=_client_desc(f"Social Media VA Services - {label} - {period_label}"),
                        hours=group_hours,
                        rate=rate,
                        amount=group_amount,
                    )
                )
        else:
            db.add(
                InvoiceLineItem(
                    invoice_id=invoice.id,
                    work_log_id=None,
                    line_date=period_end,
                    description=default_service,
                    hours=Decimal("0"),
                    rate=rate,
                    amount=Decimal("0.00"),
                )
            )

    elif billing_type == BillingType.fixed:
        db.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                work_log_id=None,
                line_date=period_end,
                description=default_service,
                hours=total_hours,
                rate=rate,
                amount=amount,
            )
        )
    elif billing_type == BillingType.package_hours:
        included = included_hours or Decimal("0")
        package_hours = min(total_hours, included) if included else total_hours
        db.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                work_log_id=None,
                line_date=period_end,
                description=default_service,
                hours=package_hours,
                rate=rate,
                amount=rate,
            )
        )
        if overage_hrs and overage_hrs > 0:
            db.add(
                InvoiceLineItem(
                    invoice_id=invoice.id,
                    work_log_id=None,
                    line_date=period_end,
                    description=f"Additional services - {period_label}",
                    hours=overage_hrs,
                    rate=overage_rate or Decimal("0"),
                    amount=overage_amt or Decimal("0"),
                )
            )

    db.commit()
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice.id)
        .first()
    )
    return _serialize_invoice(invoice)


@router.post("/{invoice_id}/send")
def send_invoice(
    invoice_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Email the invoice. A one-off invoice goes to the address typed on it."""
    import html as html_lib

    from app.services.email import send_email

    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    to_email = (invoice.one_off_email or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Type an email address on this invoice before sending")
    name = (invoice.client.name if invoice.client else None) or invoice.one_off_name or "there"
    rows = []
    for line in invoice.line_items:
        text = html_lib.escape(clean_invoice_text(line.description)).replace("\n", "<br>")
        rows.append(f"<p><strong>{text}</strong><br>{invoice.currency} {line.amount}</p>")
    body = (
        f"<p>Hello {html_lib.escape(name)},</p>"
        f"<p>Invoice {html_lib.escape(invoice.invoice_number)} for {html_lib.escape(invoice.period_label)}.</p>"
        + "".join(rows)
        + f"<p>Total due: {invoice.currency} {invoice.amount}</p>"
    )
    sent = send_email(to_email, f"Invoice {invoice.invoice_number}", body, "invoice_sent")
    return {"sent": sent, "to": to_email}


@router.patch("/{invoice_id}/line-items/{line_id}", response_model=InvoiceResponse)
def update_invoice_line_item(
    invoice_id: UUID,
    line_id: UUID,
    body: InvoiceLineItemUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Let admin customize client-facing service descriptions (and amounts) before sending."""
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    line = next((li for li in invoice.line_items if li.id == line_id), None)
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found")

    data = body.model_dump(exclude_unset=True)
    if "description" in data and data["description"] is not None:
        line.description = data["description"].strip() or line.description
    if "rate" in data and data["rate"] is not None:
        line.rate = data["rate"]
    if "amount" in data and data["amount"] is not None:
        line.amount = data["amount"]

    invoice.amount = sum((li.amount for li in invoice.line_items), Decimal("0")).quantize(Decimal("0.01"))
    db.commit()
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    return _serialize_invoice(invoice)


@router.post("/{invoice_id}/mark-paid", response_model=InvoiceResponse)
def mark_paid(
    invoice_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    invoice.status = InvoiceStatus.paid
    invoice.paid_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invoice)
    return _serialize_invoice(invoice)


@router.post("/{invoice_id}/mark-unpaid", response_model=InvoiceResponse)
def mark_unpaid(
    invoice_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    invoice.status = InvoiceStatus.unpaid
    invoice.paid_at = None
    db.commit()
    db.refresh(invoice)
    return _serialize_invoice(invoice)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    db.query(WorkLog).filter(WorkLog.invoice_id == invoice_id).update(
        {"status": WorkLogStatus.approved, "invoice_id": None}
    )
    db.delete(invoice)
    db.commit()
