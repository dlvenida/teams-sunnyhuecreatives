from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Currency, VA, WorkLog, WorkLogStatus
from app.schemas import PayrollEntry, PayrollRequest, PayrollResponse, PayrollVAResult
from app.services.billing import get_week_period

router = APIRouter(prefix="/payroll", tags=["payroll"])


@router.post("/calculate", response_model=PayrollResponse)
def calculate_payroll(
    body: PayrollRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if body.period == "custom" and body.date_from and body.date_to:
        period_start, period_end = body.date_from, body.date_to
    elif body.period == "last_week":
        period_start, period_end = get_week_period("last_week")
    else:
        period_start, period_end = get_week_period("this_week")

    q = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.va), joinedload(WorkLog.client))
        .filter(
            WorkLog.status.in_([WorkLogStatus.approved, WorkLogStatus.invoiced]),
            WorkLog.work_date >= period_start,
            WorkLog.work_date <= period_end,
        )
    )
    if body.va_id:
        q = q.filter(WorkLog.va_id == body.va_id)

    logs = q.order_by(WorkLog.va_id, WorkLog.work_date).all()

    va_map: dict = {}
    for log in logs:
        if log.va_id not in va_map:
            va_map[log.va_id] = {"va": log.va, "entries": [], "total_hours": Decimal("0"), "total_pay": Decimal("0")}
        va_map[log.va_id]["entries"].append(log)
        va_map[log.va_id]["total_hours"] += log.hours
        va_map[log.va_id]["total_pay"] += log.va_pay

    results = []
    total_php = Decimal("0")
    total_usd = Decimal("0")

    for data in va_map.values():
        va = data["va"]
        entries = [
            PayrollEntry(
                id=e.id,
                work_date=e.work_date,
                client_name=e.client.name,
                description=e.description_plain,
                hours=e.hours,
                rate=e.va_rate,
                pay=e.va_pay,
            )
            for e in data["entries"]
        ]
        results.append(
            PayrollVAResult(
                va_id=va.id,
                va_name=va.name,
                currency=va.currency,
                total_hours=data["total_hours"],
                total_pay=data["total_pay"],
                entry_count=len(entries),
                entries=entries,
            )
        )
        if va.currency == Currency.PHP:
            total_php += data["total_pay"]
        else:
            total_usd += data["total_pay"]

    return PayrollResponse(
        period_start=period_start,
        period_end=period_end,
        vas=results,
        total_php=total_php,
        total_usd=total_usd,
    )
