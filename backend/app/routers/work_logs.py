import csv
import io
from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Client, SubClient, VA, WorkLog, WorkLogStatus
from app.schemas import WorkLogResponse, WorkLogUpdate
from app.services.calculations import calculate_hours, calculate_pay

router = APIRouter(prefix="/work-logs", tags=["work-logs"])


def _serialize_log(log: WorkLog) -> WorkLogResponse:
    return WorkLogResponse(
        id=log.id,
        work_date=log.work_date,
        va_id=log.va_id,
        va_name=log.va.name if log.va else None,
        client_id=log.client_id,
        client_name=log.client.name if log.client else None,
        sub_client_id=log.sub_client_id,
        sub_client_name=log.sub_client.name if log.sub_client else None,
        description_lexical=log.description_lexical,
        description_plain=log.description_plain,
        start_time=log.start_time,
        end_time=log.end_time,
        hours=log.hours,
        va_rate=log.va_rate,
        va_pay=log.va_pay,
        notes=log.notes,
        status=log.status,
        invoice_id=log.invoice_id,
        created_at=log.created_at,
    )


@router.get("", response_model=list[WorkLogResponse])
def list_work_logs(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    va_id: UUID | None = None,
    status_filter: WorkLogStatus | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
):
    return [_serialize_log(log) for log in _query_logs(db, client_id, va_id, status_filter, date_from, date_to)]


def _query_logs(
    db: Session,
    client_id: UUID | None = None,
    va_id: UUID | None = None,
    status_filter: WorkLogStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[WorkLog]:
    q = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client))
        .order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc())
    )
    if client_id:
        q = q.filter(WorkLog.client_id == client_id)
    if va_id:
        q = q.filter(WorkLog.va_id == va_id)
    if status_filter:
        q = q.filter(WorkLog.status == status_filter)
    if date_from:
        q = q.filter(WorkLog.work_date >= date_from)
    if date_to:
        q = q.filter(WorkLog.work_date <= date_to)
    return q.all()


@router.get("/export")
def export_csv(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    va_id: UUID | None = None,
    status_filter: WorkLogStatus | None = Query(None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
):
    logs = [_serialize_log(log) for log in _query_logs(db, client_id, va_id, status_filter, date_from, date_to)]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "VA", "Client", "Sub-client", "Description", "Hours", "VA Rate", "VA Pay", "Status"])
    for log in logs:
        writer.writerow([
            log.work_date, log.va_name, log.client_name, log.sub_client_name or "",
            log.description_plain, log.hours, log.va_rate, log.va_pay, log.status.value,
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=work-logs.csv"},
    )


@router.patch("/{log_id}", response_model=WorkLogResponse)
def update_work_log(
    log_id: UUID,
    body: WorkLogUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    log = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.va), joinedload(WorkLog.client), joinedload(WorkLog.sub_client))
        .filter(WorkLog.id == log_id)
        .first()
    )
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work log not found")

    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(log, k, v)

    if body.start_time or body.end_time or body.va_rate is not None:
        start = body.start_time or log.start_time
        end = body.end_time or log.end_time
        rate = body.va_rate if body.va_rate is not None else log.va_rate
        log.hours = calculate_hours(start, end)
        log.va_pay = calculate_pay(log.hours, rate)

    db.commit()
    db.refresh(log)
    return _serialize_log(log)


@router.post("/{log_id}/approve", response_model=WorkLogResponse)
def approve_log(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return update_work_log(log_id, WorkLogUpdate(status=WorkLogStatus.approved), _, db)


@router.post("/{log_id}/reject", response_model=WorkLogResponse)
def reject_log(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    return update_work_log(log_id, WorkLogUpdate(status=WorkLogStatus.rejected), _, db)


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    log_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    log = db.query(WorkLog).filter(WorkLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work log not found")
    if log.status == WorkLogStatus.invoiced:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete invoiced entry")
    db.delete(log)
    db.commit()
