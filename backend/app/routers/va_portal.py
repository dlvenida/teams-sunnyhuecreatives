from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_va
from app.models import Client, SubClient, VA, WorkLog, WorkLogStatus
from app.schemas import ClientResponse, SubClientResponse
from app.schemas import WorkLogCreate, WorkLogResponse
from app.services.calculations import calculate_hours, calculate_pay
from app.services.email import send_va_submission_notification

router = APIRouter(prefix="/va", tags=["va"])


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


@router.get("/clients", response_model=list[ClientResponse])
def list_clients_for_va(
    _: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    return db.query(Client).filter(Client.is_active == True).order_by(Client.name).all()


@router.get("/sub-clients", response_model=list[SubClientResponse])
def list_sub_clients_for_va(
    _: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
    client_id: str | None = None,
):
    q = db.query(SubClient).filter(SubClient.is_active == True)
    if client_id:
        q = q.filter(SubClient.client_id == client_id)
    return q.order_by(SubClient.name).all()


@router.get("/me")
def get_va_profile(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    va = db.query(VA).filter(VA.id == current.va_id).first()
    if not va:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VA not found")
    return {"id": va.id, "name": va.name, "currency": va.currency, "email": current.user.email}


@router.get("/work-logs", response_model=list[WorkLogResponse])
def list_my_work_logs(
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    logs = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.va))
        .filter(WorkLog.va_id == current.va_id)
        .order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc())
        .all()
    )
    return [_serialize_log(log) for log in logs]


@router.post("/work-logs", response_model=WorkLogResponse, status_code=status.HTTP_201_CREATED)
def submit_work_log(
    body: WorkLogCreate,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    hours = calculate_hours(body.start_time, body.end_time)
    pay = calculate_pay(hours, body.va_rate)

    log = WorkLog(
        work_date=body.work_date,
        va_id=current.va_id,
        client_id=body.client_id,
        sub_client_id=body.sub_client_id,
        description_lexical=body.description_lexical,
        description_plain=body.description_plain,
        start_time=body.start_time,
        end_time=body.end_time,
        hours=hours,
        va_rate=body.va_rate,
        va_pay=pay,
        notes=body.notes,
        status=WorkLogStatus.submitted,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    log = (
        db.query(WorkLog)
        .options(joinedload(WorkLog.client), joinedload(WorkLog.sub_client), joinedload(WorkLog.va))
        .filter(WorkLog.id == log.id)
        .first()
    )

    send_va_submission_notification(
        va_name=log.va.name,
        client_name=log.client.name,
        hours=str(log.hours),
        work_date=str(log.work_date),
        description=log.description_plain[:200],
    )

    return _serialize_log(log)
