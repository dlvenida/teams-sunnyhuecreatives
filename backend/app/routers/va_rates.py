"""VA rate submissions, approvals, and admin overrides."""
from datetime import date, datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin, require_va
from app.models import Client, RateStatus, VA, VARate
from app.schemas import VARateAdminCreate, VARateCreate, VARateResponse
from app.services.notifications import admin_user_ids, push, va_user_id
from app.services.va_rates import get_approved_rate

router = APIRouter(prefix="/va-rates", tags=["va-rates"])


def _serialize(rate: VARate, active_id: UUID | None = None) -> VARateResponse:
    return VARateResponse(
        id=rate.id,
        va_id=rate.va_id,
        va_name=rate.va.name if rate.va else None,
        client_id=rate.client_id,
        client_name=rate.client.name if rate.client else None,
        pay_type=rate.pay_type,
        currency=rate.currency,
        amount=rate.amount,
        status=rate.status,
        set_by_admin=rate.set_by_admin,
        notes=rate.notes,
        effective_from=rate.effective_from,
        created_at=rate.created_at,
        reviewed_at=rate.reviewed_at,
        is_active_approved=bool(active_id and rate.id == active_id),
    )


def _load(db: Session, rate_id: UUID) -> VARate:
    rate = (
        db.query(VARate)
        .options(joinedload(VARate.va), joinedload(VARate.client))
        .filter(VARate.id == rate_id)
        .first()
    )
    if not rate:
        raise HTTPException(status_code=404, detail="Rate not found")
    return rate


def _supersede_approved(db: Session, va_id: UUID, client_id: UUID, *, except_id: UUID | None, reviewer_id: UUID | None) -> None:
    """Ensure at most one approved rate per VA+client (required by unique index)."""
    q = db.query(VARate).filter(
        VARate.va_id == va_id,
        VARate.client_id == client_id,
        VARate.status == RateStatus.approved,
    )
    if except_id:
        q = q.filter(VARate.id != except_id)
    q.update(
        {
            "status": RateStatus.rejected,
            "reviewed_at": datetime.now(timezone.utc),
            "reviewed_by": reviewer_id,
        },
        synchronize_session=False,
    )


@router.get("/mine", response_model=list[VARateResponse])
def my_rates(current: Annotated[CurrentUser, Depends(require_va)], db: Annotated[Session, Depends(get_db)]):
    rows = (
        db.query(VARate)
        .options(joinedload(VARate.va), joinedload(VARate.client))
        .filter(VARate.va_id == current.va_id)
        .order_by(VARate.created_at.desc())
        .all()
    )
    return [_serialize(r, get_approved_rate(db, r.va_id, r.client_id).id if get_approved_rate(db, r.va_id, r.client_id) else None) for r in rows]


@router.get("/mine/for-client/{client_id}", response_model=VARateResponse | None)
def my_rate_for_client(
    client_id: UUID,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    rate = get_approved_rate(db, current.va_id, client_id)
    if not rate:
        return None
    rate = _load(db, rate.id)
    return _serialize(rate, rate.id)


@router.post("/mine", response_model=VARateResponse, status_code=status.HTTP_201_CREATED)
def submit_rate(
    body: VARateCreate,
    current: Annotated[CurrentUser, Depends(require_va)],
    db: Annotated[Session, Depends(get_db)],
):
    if not db.query(Client).filter(Client.id == body.client_id, Client.is_active == True).first():
        raise HTTPException(404, "Client not found")
    # One active request/rate per client: replace any pending; approved stays until this one is approved
    db.query(VARate).filter(
        VARate.va_id == current.va_id,
        VARate.client_id == body.client_id,
        VARate.status == RateStatus.pending,
    ).update({"status": RateStatus.rejected, "reviewed_at": datetime.now(timezone.utc)})
    rate = VARate(
        va_id=current.va_id,
        client_id=body.client_id,
        pay_type=body.pay_type,
        currency=body.currency,
        amount=body.amount,
        status=RateStatus.pending,
        set_by_admin=False,
        notes=body.notes,
        effective_from=date.today(),
    )
    db.add(rate)
    db.commit()
    rate = _load(db, rate.id)
    push(
        db,
        admin_user_ids(db),
        "system",
        f"💵 Rate request from {rate.va.name if rate.va else 'VA'}",
        f"{rate.client.name if rate.client else 'Client'} · {rate.pay_type.value} · {rate.currency.value} {rate.amount}",
        "/admin/va-rates",
    )
    return _serialize(rate)


@router.get("", response_model=list[VARateResponse])
def list_rates(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    status_filter: str | None = None,
    va_id: UUID | None = None,
):
    q = db.query(VARate).options(joinedload(VARate.va), joinedload(VARate.client))
    if status_filter:
        q = q.filter(VARate.status == status_filter)
    if va_id:
        q = q.filter(VARate.va_id == va_id)
    rows = q.order_by(VARate.created_at.desc()).all()
    out = []
    for r in rows:
        active = get_approved_rate(db, r.va_id, r.client_id)
        out.append(_serialize(r, active.id if active else None))
    return out


@router.post("", response_model=VARateResponse, status_code=status.HTTP_201_CREATED)
def admin_set_rate(
    body: VARateAdminCreate,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if not db.query(VA).filter(VA.id == body.va_id).first():
        raise HTTPException(404, "VA not found")
    if not db.query(Client).filter(Client.id == body.client_id).first():
        raise HTTPException(404, "Client not found")
    # Auto-approve admin override — only one approved rate per VA+client
    db.query(VARate).filter(
        VARate.va_id == body.va_id,
        VARate.client_id == body.client_id,
        VARate.status == RateStatus.pending,
    ).update({"status": RateStatus.rejected, "reviewed_at": datetime.now(timezone.utc), "reviewed_by": current.user.id})
    _supersede_approved(db, body.va_id, body.client_id, except_id=None, reviewer_id=current.user.id)
    rate = VARate(
        va_id=body.va_id,
        client_id=body.client_id,
        pay_type=body.pay_type,
        currency=body.currency,
        amount=body.amount,
        status=RateStatus.approved,
        set_by_admin=True,
        notes=body.notes,
        effective_from=date.today(),
        reviewed_at=datetime.now(timezone.utc),
        reviewed_by=current.user.id,
    )
    db.add(rate)
    db.commit()
    rate = _load(db, rate.id)
    push(
        db,
        [va_user_id(db, body.va_id)],
        "system",
        "💵 Your rate was updated",
        f"{rate.client.name if rate.client else 'Client'} · {rate.pay_type.value} · {rate.currency.value} {rate.amount} (set by admin)",
        "/va/rates",
    )
    return _serialize(rate, rate.id)


@router.post("/{rate_id}/approve", response_model=VARateResponse)
def approve_rate(
    rate_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    rate = _load(db, rate_id)
    if rate.status != RateStatus.pending:
        raise HTTPException(400, "Only pending rates can be approved")
    now = datetime.now(timezone.utc)
    # One approved rate per VA+client — prior approved becomes history (rejected)
    _supersede_approved(db, rate.va_id, rate.client_id, except_id=rate.id, reviewer_id=current.user.id)
    rate.status = RateStatus.approved
    rate.reviewed_at = now
    rate.reviewed_by = current.user.id
    rate.effective_from = date.today()
    db.commit()
    rate = _load(db, rate.id)
    push(
        db,
        [va_user_id(db, rate.va_id)],
        "system",
        "✅ Rate approved",
        f"{rate.client.name if rate.client else 'Client'} · {rate.pay_type.value} · {rate.currency.value} {rate.amount}",
        "/va/rates",
    )
    return _serialize(rate, rate.id)


@router.post("/{rate_id}/reject", response_model=VARateResponse)
def reject_rate(
    rate_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    rate = _load(db, rate_id)
    if rate.status != RateStatus.pending:
        raise HTTPException(400, "Only pending rates can be rejected")
    rate.status = RateStatus.rejected
    rate.reviewed_at = datetime.now(timezone.utc)
    rate.reviewed_by = current.user.id
    db.commit()
    rate = _load(db, rate.id)
    push(
        db,
        [va_user_id(db, rate.va_id)],
        "system",
        "❌ Rate rejected",
        f"{rate.client.name if rate.client else 'Client'} · please submit a new rate or contact Jane.",
        "/va/rates",
    )
    return _serialize(rate)
