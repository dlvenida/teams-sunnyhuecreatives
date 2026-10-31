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
    ClientPackage,
    Invoice,
    InvoiceLineItem,
    InvoiceStatus,
    WorkLog,
    WorkLogStatus,
)
from app.schemas import (
    InvoiceGenerateRequest,
    InvoiceLineItemResponse,
    InvoiceLineItemUpdate,
    InvoicePreviewResponse,
    InvoiceResponse,
)
from app.services.billing import get_billing_period, next_invoice_number


class InvoiceGenerateBody(InvoiceGenerateRequest):
    """Same generate payload, plus an optional admin-computed total.

    Used when the form has extracted hours and a rate (amount = hours × rate)
    or the admin edited that total. Omitted or ignored when the description is blank.
    """

    amount: Decimal | None = None

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
        client_name=inv.client.name if inv.client else None,
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
                description=li.description,
                hours=li.hours,
                rate=li.rate,
                amount=li.amount,
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


@router.get("/extract")
def extract_time_logs(
    client_id: UUID,
    year: int,
    month: int,
    cutoff: int,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Exact work-log wording for the same period preview uses.

    Includes submitted, approved, and already-invoiced logs. Timesheet approval
    is not required. Descriptions are concatenated unchanged — not summarized.
    """
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    period_start, period_end, period_label = get_billing_period(year, month, cutoff)
    logs = (
        db.query(WorkLog)
        .filter(
            WorkLog.client_id == client_id,
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
            WorkLog.status.in_([
                WorkLogStatus.submitted,
                WorkLogStatus.approved,
                WorkLogStatus.invoiced,
            ]),
        )
        .order_by(WorkLog.work_date, WorkLog.start_time, WorkLog.created_at)
        .all()
    )
    parts = [log.description_plain for log in logs if log.description_plain]
    total_hours = sum((log.hours for log in logs), Decimal("0")).quantize(Decimal("0.01"))
    return {
        "description": "\n\n".join(parts),
        "total_hours": str(total_hours),
        "period_label": period_label,
        "entry_count": len(logs),
    }


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


@router.post("/generate", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def generate_invoice(
    body: InvoiceGenerateBody,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
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
    computed_amount, overage_hrs, overage_amt = _invoice_amount(
        billing_type, rate, total_hours, included_hours, overage_rate
    )
    custom = (body.service_description or "").strip()
    # Blank description keeps the service-title + period total. A saved description
    # can carry the admin's hours × rate figure (or their edit of that figure).
    if custom and body.amount is not None:
        amount = body.amount.quantize(Decimal("0.01"))
    else:
        amount = computed_amount

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

    # Never invent package marketing copy. Blank → service title + period only.
    default_service = f"Social Media VA Services — {period_label}"

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
                        description=_client_desc(f"Social Media VA Services — {label} — {period_label}"),
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
                    description=f"Additional services — {period_label}",
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
