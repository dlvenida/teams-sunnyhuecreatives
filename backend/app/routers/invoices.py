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
from app.schemas import InvoiceGenerateRequest, InvoiceLineItemResponse, InvoicePreviewResponse, InvoiceResponse
from app.services.billing import get_billing_period, next_invoice_number

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
        .filter(
            WorkLog.client_id == client_id,
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
        )
    )
    approved = base.filter(WorkLog.status == WorkLogStatus.approved).order_by(WorkLog.work_date).all()
    submitted_count = base.filter(WorkLog.status == WorkLogStatus.submitted).count()
    return approved, submitted_count


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
    if approved:
        estimated, overage_hrs, overage_amt = _invoice_amount(billing_type, rate, total_hours, included_hours, overage_rate)

    if approved:
        message = f"Ready to invoice {len(approved)} approved entr{'y' if len(approved) == 1 else 'ies'}."
    elif submitted_count:
        message = f"{submitted_count} submitted entr{'y' if submitted_count == 1 else 'ies'} awaiting approval — approve in All Logs first."
    else:
        message = "No approved entries for this period. Approve VA time logs or pick a different month."

    return InvoicePreviewResponse(
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        approved_entries=len(approved),
        submitted_entries=submitted_count,
        total_hours=total_hours,
        estimated_amount=estimated,
        billing_type=billing_type,
        can_generate=len(approved) > 0,
        message=message,
        included_hours=included_hours,
        overage_hours=overage_hrs,
        overage_amount=overage_amt,
    )


@router.post("/generate", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def generate_invoice(
    body: InvoiceGenerateRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = db.query(Client).filter(Client.id == body.client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    period_start, period_end, period_label = get_billing_period(body.year, body.month, body.cutoff)

    logs, _ = _period_logs(db, body.client_id, period_start, period_end)

    if not logs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No approved entries for this period")

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

    client_rate = rate if billing_type == BillingType.hourly else (amount / total_hours if total_hours else rate)

    for log in logs:
        line_amount = (log.hours * client_rate).quantize(Decimal("0.01")) if billing_type == BillingType.hourly else Decimal("0")
        item = InvoiceLineItem(
            invoice_id=invoice.id,
            work_log_id=log.id,
            line_date=log.work_date,
            description=log.description_plain,
            hours=log.hours,
            rate=client_rate if billing_type == BillingType.hourly else rate,
            amount=line_amount if billing_type == BillingType.hourly else Decimal("0"),
        )
        db.add(item)
        log.status = WorkLogStatus.invoiced
        log.invoice_id = invoice.id

    # Package / package_hours: add summary line items
    if billing_type == BillingType.fixed:
        db.add(InvoiceLineItem(
            invoice_id=invoice.id, work_log_id=None, line_date=period_end,
            description="Fixed package", hours=total_hours, rate=rate, amount=amount,
        ))
    elif billing_type == BillingType.package_hours:
        db.add(InvoiceLineItem(
            invoice_id=invoice.id, work_log_id=None, line_date=period_end,
            description=f"Package ({included_hours or 0} hrs included)", hours=min(total_hours, included_hours or total_hours), rate=rate, amount=rate,
        ))
        if overage_hrs and overage_hrs > 0:
            db.add(InvoiceLineItem(
                invoice_id=invoice.id, work_log_id=None, line_date=period_end,
                description="Overage hours", hours=overage_hrs, rate=overage_rate or Decimal("0"), amount=overage_amt or Decimal("0"),
            ))

    db.commit()
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.client), joinedload(Invoice.line_items))
        .filter(Invoice.id == invoice.id)
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
