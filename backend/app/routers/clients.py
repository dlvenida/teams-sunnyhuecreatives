from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser, require_admin
from app.models import Client, SubClient, WorkLog, Invoice
from app.schemas import (
    ClientCreate,
    ClientResponse,
    ClientUpdate,
    SubClientCreate,
    SubClientResponse,
    SubClientUpdate,
)

router = APIRouter(prefix="/clients", tags=["clients"])


@router.get("", response_model=list[ClientResponse])
def list_clients(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    active_only: bool = False,
    include_archived: bool = True,
):
    q = db.query(Client)
    if active_only:
        q = q.filter(Client.is_active == True)
    elif not include_archived:
        q = q.filter(Client.is_active == True)
    return q.order_by(Client.name).all()


@router.post("", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(
    body: ClientCreate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if db.query(Client).filter(Client.name == body.name).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client already exists")
    client = Client(**body.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


@router.patch("/{client_id}", response_model=ClientResponse)
def update_client(
    client_id: UUID,
    body: ClientUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    if body.name and body.name != client.name:
        if db.query(Client).filter(Client.name == body.name, Client.id != client_id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client name already exists")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(client, k, v)
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(
    client_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    has_logs = db.query(WorkLog).filter(WorkLog.client_id == client_id).first()
    has_invoices = db.query(Invoice).filter(Invoice.client_id == client_id).first()
    if has_logs or has_invoices:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete client with work logs or invoices. Archive instead.",
        )
    db.delete(client)
    db.commit()


@router.get("/sub-clients", response_model=list[SubClientResponse])
def list_sub_clients(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    active_only: bool = False,
    include_archived: bool = True,
):
    q = db.query(SubClient)
    if client_id:
        q = q.filter(SubClient.client_id == client_id)
    if active_only or not include_archived:
        q = q.filter(SubClient.is_active == True)
    return q.order_by(SubClient.name).all()


@router.post("/sub-clients", response_model=SubClientResponse, status_code=status.HTTP_201_CREATED)
def create_sub_client(
    body: SubClientCreate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = db.query(Client).filter(Client.id == body.client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    sub = SubClient(**body.model_dump())
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.patch("/sub-clients/{sub_client_id}", response_model=SubClientResponse)
def update_sub_client(
    sub_client_id: UUID,
    body: SubClientUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    sub = db.query(SubClient).filter(SubClient.id == sub_client_id).first()
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sub-client not found")
    if body.client_id:
        client = db.query(Client).filter(Client.id == body.client_id).first()
        if not client:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(sub, k, v)
    db.commit()
    db.refresh(sub)
    return sub


@router.delete("/sub-clients/{sub_client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sub_client(
    sub_client_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    sub = db.query(SubClient).filter(SubClient.id == sub_client_id).first()
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sub-client not found")
    has_logs = db.query(WorkLog).filter(WorkLog.sub_client_id == sub_client_id).first()
    if has_logs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete sub-client with work logs. Archive instead.",
        )
    db.delete(sub)
    db.commit()
