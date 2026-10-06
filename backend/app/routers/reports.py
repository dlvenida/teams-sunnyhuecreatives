from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Client, WorkLog, WorkLogStatus
from app.schemas import ReportLine, ReportRequest, ReportResponse
from app.services.billing import get_billing_period
from app.routers.settings import pricing_hidden

router = APIRouter(prefix="/reports", tags=["reports"])


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

    logs = (
        db.query(WorkLog)
        .filter(
            WorkLog.client_id == body.client_id,
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
        )
        .order_by(WorkLog.work_date)
        .all()
    )

    lines = []
    total_hours = Decimal("0")
    total_amount = Decimal("0") if show_rate else None

    for log in logs:
        line = ReportLine(
            work_date=log.work_date,
            description=log.description_plain,
            hours=log.hours,
        )
        if show_rate:
            line.rate = log.va_rate
            line.amount = log.hours * log.va_rate
            total_amount += line.amount
        lines.append(line)
        total_hours += log.hours

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
    )
