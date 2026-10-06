from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Client, Invoice, InvoiceStatus, VA, WorkLog, WorkLogStatus
from app.routers.work_logs import _serialize_log
from app.schemas import DashboardSummary
from app.services.billing import get_week_period

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    total_invoiced = db.query(func.coalesce(func.sum(Invoice.amount), 0)).scalar() or Decimal("0")
    paid_by_clients = (
        db.query(func.coalesce(func.sum(Invoice.amount), 0))
        .filter(Invoice.status == InvoiceStatus.paid)
        .scalar()
        or Decimal("0")
    )
    total_va_payout = (
        db.query(func.coalesce(func.sum(WorkLog.va_pay), 0))
        .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
        .scalar()
        or Decimal("0")
    )
    pending_entries = db.query(WorkLog).filter(WorkLog.status == WorkLogStatus.submitted).count()
    approved_hours = (
        db.query(func.coalesce(func.sum(WorkLog.hours), 0))
        .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
        .scalar()
        or Decimal("0")
    )
    active_clients = db.query(Client).filter(Client.is_active == True).count()
    invoices_issued = db.query(Invoice).count()
    unpaid_invoices = db.query(Invoice).filter(Invoice.status == InvoiceStatus.unpaid).count()
    active_vas = db.query(VA).filter(VA.is_active == True).count()

    week_start, week_end = get_week_period("this_week")
    this_week_va_pay = (
        db.query(func.coalesce(func.sum(WorkLog.va_pay), 0))
        .filter(
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= week_start,
            WorkLog.work_date <= week_end,
        )
        .scalar()
        or Decimal("0")
    )

    hours_by_client = (
        db.query(Client.name, func.sum(WorkLog.hours).label("hours"))
        .join(WorkLog, WorkLog.client_id == Client.id)
        .filter(WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]))
        .group_by(Client.name)
        .order_by(func.sum(WorkLog.hours).desc())
        .all()
    )

    va_pay_rows = (
        db.query(VA.id, VA.name, VA.currency, func.sum(WorkLog.va_pay).label("pay"), func.sum(WorkLog.hours).label("hours"))
        .join(WorkLog, WorkLog.va_id == VA.id)
        .filter(
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= week_start,
            WorkLog.work_date <= week_end,
        )
        .group_by(VA.id, VA.name, VA.currency)
        .all()
    )

    pending_logs = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client))
        .filter(WorkLog.status == WorkLogStatus.submitted)
        .order_by(WorkLog.created_at.desc())
        .limit(10)
        .all()
    )

    return DashboardSummary(
        total_invoiced=Decimal(str(total_invoiced)),
        paid_by_clients=Decimal(str(paid_by_clients)),
        total_va_payout=Decimal(str(total_va_payout)),
        estimated_profit=Decimal(str(total_invoiced)) - Decimal(str(total_va_payout)),
        pending_entries=pending_entries,
        approved_hours=Decimal(str(approved_hours)),
        active_clients=active_clients,
        invoices_issued=invoices_issued,
        unpaid_invoices=unpaid_invoices,
        this_week_va_pay=Decimal(str(this_week_va_pay)),
        active_vas=active_vas,
        hours_by_client=[{"client": r.name, "hours": float(r.hours)} for r in hours_by_client],
        va_pay_this_week=[
            {"va_id": str(r.id), "name": r.name, "currency": r.currency.value, "pay": float(r.pay), "hours": float(r.hours)}
            for r in va_pay_rows
        ],
        pending_logs=[_serialize_log(log) for log in pending_logs],
    )
