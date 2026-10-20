from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Client, Invoice, Task, TaskStatus, WorkLog, WorkLogStatus
from app.schemas import (
    ReportBreakdown,
    ReportClientSummary,
    ReportClientsResponse,
    ReportDay,
    ReportLine,
    ReportRequest,
    ReportResponse,
)
from app.services.billing import get_billing_period
from app.routers.settings import pricing_hidden

router = APIRouter(prefix="/reports", tags=["reports"])

BILLABLE = [WorkLogStatus.approved, WorkLogStatus.invoiced]


def _prev_period(year: int, month: int, cutoff: int) -> tuple[date, date]:
    if month == 1:
        year, month = year - 1, 12
    else:
        month -= 1
    start, end, _ = get_billing_period(year, month, cutoff)
    return start, end


def _logs(db: Session, client_id, start: date, end: date, statuses):
    return (
        db.query(WorkLog)
        .options(
            joinedload(WorkLog.va),
            joinedload(WorkLog.client),
            joinedload(WorkLog.sub_client),
            joinedload(WorkLog.project),
            joinedload(WorkLog.task),
        )
        .filter(
            WorkLog.client_id == client_id,
            WorkLog.status.in_(statuses),
            WorkLog.work_date >= start,
            WorkLog.work_date <= end,
        )
        .order_by(WorkLog.work_date)
        .all()
    )


@router.get("/clients", response_model=ReportClientsResponse)
def report_clients(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    year: int,
    month: int,
    cutoff: int = 30,
    show_rate: bool = False,
):
    """Every client with their report stats for the period — powers the client list."""
    show_rate = show_rate and not pricing_hidden(db)
    period_start, period_end, period_label = get_billing_period(year, month, cutoff)
    prev_start, prev_end = _prev_period(year, month, cutoff)

    summaries: list[ReportClientSummary] = []
    total_hours = Decimal("0")
    total_pending = Decimal("0")

    for client in db.query(Client).order_by(Client.name).all():
        logs = _logs(db, client.id, period_start, period_end, BILLABLE)
        pending = _logs(db, client.id, period_start, period_end, [WorkLogStatus.submitted])
        prev_logs = _logs(db, client.id, prev_start, prev_end, BILLABLE)

        billable = sum((l.hours for l in logs), Decimal("0"))
        prev_hours = sum((l.hours for l in prev_logs), Decimal("0"))
        invoiced = sum((l.hours for l in logs if l.status == WorkLogStatus.invoiced), Decimal("0"))
        pend_hours = sum((l.hours for l in pending), Decimal("0"))
        invoice = (
            db.query(Invoice)
            .filter(Invoice.client_id == client.id, Invoice.period_start == period_start, Invoice.period_end == period_end)
            .order_by(Invoice.created_at.desc())
            .first()
        )
        change = None
        if prev_hours > 0:
            change = float((billable - prev_hours) / prev_hours * 100)
        total_hours += billable
        total_pending += pend_hours
        summaries.append(
            ReportClientSummary(
                client_id=client.id,
                client_name=client.name,
                billing_type=str(client.billing_type.value if hasattr(client.billing_type, "value") else client.billing_type),
                is_active=bool(client.is_active),
                billable_hours=billable,
                entries=len(logs),
                pending_hours=pend_hours,
                pending_count=len(pending),
                ready_to_invoice_hours=billable - invoiced,
                invoiced_hours=invoiced,
                amount=(sum((l.hours * l.va_rate for l in logs), Decimal("0")) if show_rate else None),
                va_names=sorted({l.va.name for l in logs if l.va}),
                last_activity=max((l.work_date for l in logs), default=None),
                invoice_number=invoice.invoice_number if invoice else None,
                invoice_status=str(invoice.status.value if hasattr(invoice.status, "value") else invoice.status) if invoice else None,
                prev_period_hours=prev_hours,
                change_pct=change,
            )
        )

    summaries.sort(key=lambda s: (s.billable_hours, s.pending_hours), reverse=True)
    return ReportClientsResponse(
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        show_rate=show_rate,
        clients=summaries,
        total_hours=total_hours,
        total_pending_hours=total_pending,
    )


@router.post("/generate", response_model=ReportResponse)
def generate_report(
    body: ReportRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    show_rate = body.show_rate and not pricing_hidden(db)
    client = db.query(Client).filter(Client.id == body.client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    period_start, period_end, period_label = get_billing_period(body.year, body.month, body.cutoff)
    logs = _logs(db, body.client_id, period_start, period_end, BILLABLE)
    pending = _logs(db, body.client_id, period_start, period_end, [WorkLogStatus.submitted])

    lines = []
    total_hours = Decimal("0")
    total_amount = Decimal("0") if show_rate else None
    by_va: dict[str, dict] = {}
    by_project: dict[str, dict] = {}
    by_sub: dict[str, dict] = {}
    by_day: dict[date, Decimal] = {}

    for log in logs:
        line = ReportLine(
            work_date=log.work_date,
            description=log.description_plain,
            hours=log.hours,
            va_name=log.va.name if log.va else None,
            sub_client_name=log.sub_client.name if log.sub_client else None,
            project_name=log.project.name if log.project else None,
            task_title=log.task.title if log.task else None,
            source=log.source or "manual",
            start_time=log.start_time.strftime("%H:%M") if log.start_time else None,
            end_time=log.end_time.strftime("%H:%M") if log.end_time else None,
        )
        if show_rate:
            line.rate = log.va_rate
            line.amount = log.hours * log.va_rate
            total_amount += line.amount
        lines.append(line)
        total_hours += log.hours
        for bucket, key in (
            (by_va, log.va.name if log.va else "Unassigned"),
            (by_project, log.project.name if log.project else "General"),
            (by_sub, log.sub_client.name if log.sub_client else client.name),
        ):
            bucket.setdefault(key, {"hours": Decimal("0"), "entries": 0})
            bucket[key]["hours"] += log.hours
            bucket[key]["entries"] += 1
        by_day[log.work_date] = by_day.get(log.work_date, Decimal("0")) + log.hours

    def to_breakdowns(bucket: dict) -> list[ReportBreakdown]:
        return sorted(
            (ReportBreakdown(label=k, hours=v["hours"], entries=v["entries"]) for k, v in bucket.items()),
            key=lambda b: b.hours,
            reverse=True,
        )

    # Fill every day in the period so the chart reads as a real timeline
    days: list[ReportDay] = []
    d = period_start
    while d <= period_end:
        days.append(ReportDay(work_date=d, hours=by_day.get(d, Decimal("0"))))
        d += timedelta(days=1)

    tasks_done = (
        db.query(Task)
        .filter(
            Task.client_id == body.client_id,
            Task.status == TaskStatus.done,
            Task.completed_at >= period_start,
            Task.completed_at < period_end + timedelta(days=1),
        )
        .count()
    )

    return ReportResponse(
        client_name=client.name,
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        generated_at=date.today(),
        show_rate=show_rate,
        lines=lines,
        total_hours=total_hours,
        total_amount=total_amount,
        by_va=to_breakdowns(by_va),
        by_project=to_breakdowns(by_project),
        by_sub_client=to_breakdowns(by_sub),
        by_day=days,
        pending_hours=sum((l.hours for l in pending), Decimal("0")),
        pending_count=len(pending),
        tasks_done=tasks_done,
        days_worked=len(by_day),
    )
