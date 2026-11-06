"""Admin-only manual client earnings. Current and past clients are both allowed."""
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Client, ManualEarning
from app.schemas import ManualEarningCreate, ManualEarningResponse, ManualEarningUpdate

router = APIRouter(prefix="/manual-earnings", tags=["manual-earnings"])

_CURRENCIES = {"USD", "PHP"}


def _currency(value: str | None) -> str:
    code = (value or "USD").strip().upper()
    if code not in _CURRENCIES:
        raise HTTPException(status_code=400, detail="Currency must be USD or PHP")
    return code


def _amount(value: Decimal) -> Decimal:
    amount = Decimal(value).quantize(Decimal("0.01"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    return amount


def _note(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _client(db: Session, client_id: UUID) -> Client:
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _out(row: ManualEarning) -> dict:
    client = row.client
    return {
        "id": row.id,
        "client_id": row.client_id,
        "client_name": client.name if client else None,
        "client_active": bool(client.is_active) if client else None,
        "earned_date": row.earned_date,
        "description": row.description,
        "amount": row.amount,
        "currency": row.currency,
        "created_at": row.created_at,
    }


def _load(db: Session, earning_id: UUID) -> ManualEarning:
    row = (
        db.query(ManualEarning)
        .options(joinedload(ManualEarning.client))
        .filter(ManualEarning.id == earning_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Earning not found")
    return row


@router.get("", response_model=list[ManualEarningResponse])
def list_manual_earnings(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = (
        db.query(ManualEarning)
        .options(joinedload(ManualEarning.client))
        .order_by(ManualEarning.earned_date.desc(), ManualEarning.created_at.desc())
        .all()
    )
    return [_out(row) for row in rows]


@router.post("", response_model=ManualEarningResponse, status_code=status.HTTP_201_CREATED)
def create_manual_earning(
    body: ManualEarningCreate,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = _client(db, body.client_id)
    row = ManualEarning(
        client_id=client.id,
        earned_date=body.earned_date,
        description=_note(body.description),
        amount=_amount(body.amount),
        currency=_currency(body.currency),
        created_by=current.user.id,
    )
    db.add(row)
    db.commit()
    return _out(_load(db, row.id))


@router.patch("/{earning_id}", response_model=ManualEarningResponse)
def update_manual_earning(
    earning_id: UUID,
    body: ManualEarningUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = _load(db, earning_id)
    data = body.model_dump(exclude_unset=True)
    if "client_id" in data and data["client_id"] is not None:
        row.client_id = _client(db, data["client_id"]).id
    if "earned_date" in data and data["earned_date"] is not None:
        row.earned_date = data["earned_date"]
    if "description" in data:
        row.description = _note(data["description"])
    if "amount" in data and data["amount"] is not None:
        row.amount = _amount(data["amount"])
    if "currency" in data and data["currency"] is not None:
        row.currency = _currency(data["currency"])
    db.commit()
    return _out(_load(db, row.id))


@router.delete("/{earning_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_manual_earning(
    earning_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(ManualEarning).filter(ManualEarning.id == earning_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Earning not found")
    db.delete(row)
    db.commit()
