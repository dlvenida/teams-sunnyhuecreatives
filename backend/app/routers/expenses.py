"""Admin-only business expense tracker."""
from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import BusinessExpense
from app.schemas import BusinessExpenseCreate, BusinessExpenseResponse, BusinessExpenseUpdate

router = APIRouter(prefix="/expenses", tags=["expenses"])


@router.get("", response_model=list[BusinessExpenseResponse])
def list_expenses(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
):
    q = db.query(BusinessExpense)
    if date_from:
        q = q.filter(BusinessExpense.expense_date >= date_from)
    if date_to:
        q = q.filter(BusinessExpense.expense_date <= date_to)
    return q.order_by(BusinessExpense.expense_date.desc(), BusinessExpense.created_at.desc()).all()


@router.post("", response_model=BusinessExpenseResponse, status_code=status.HTTP_201_CREATED)
def create_expense(
    body: BusinessExpenseCreate,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if body.amount < 0:
        raise HTTPException(400, "Amount must be zero or positive")
    row = BusinessExpense(
        expense_date=body.expense_date,
        description=body.description.strip(),
        amount=body.amount,
        currency=(body.currency or "USD").upper()[:10],
        created_by=current.user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{expense_id}", response_model=BusinessExpenseResponse)
def update_expense(
    expense_id: UUID,
    body: BusinessExpenseUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(BusinessExpense).filter(BusinessExpense.id == expense_id).first()
    if not row:
        raise HTTPException(404, "Expense not found")
    data = body.model_dump(exclude_unset=True)
    if "description" in data and data["description"] is not None:
        data["description"] = str(data["description"]).strip()
    if "currency" in data and data["currency"]:
        data["currency"] = str(data["currency"]).upper()[:10]
    if "amount" in data and data["amount"] is not None and data["amount"] < 0:
        raise HTTPException(400, "Amount must be zero or positive")
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    row = db.query(BusinessExpense).filter(BusinessExpense.id == expense_id).first()
    if not row:
        raise HTTPException(404, "Expense not found")
    db.delete(row)
    db.commit()
