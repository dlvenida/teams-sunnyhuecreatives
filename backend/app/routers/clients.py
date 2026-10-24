from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, require_admin, require_admin_or_auditor
from app.models import (
    Client,
    ClientApprovalStatus,
    ClientPackage,
    Currency,
    SubClient,
    UserRole,
    WorkLog,
    Invoice,
)
from app.schemas import (
    ClientApproveRequest,
    ClientCreate,
    ClientPackageCreate,
    ClientPackageResponse,
    ClientPackageUpdate,
    ClientResponse,
    ClientUpdate,
    SubClientCreate,
    SubClientResponse,
    SubClientUpdate,
)
from app.services.notifications import admin_user_ids, push

router = APIRouter(prefix="/clients", tags=["clients"])


def _proposer_name(client: Client) -> str | None:
    u = getattr(client, "proposer", None)
    if not u:
        return None
    return (u.display_name or u.email or "").strip() or None


def _client_response(client: Client, redact_money: bool = False) -> ClientResponse:
    status_val = client.approval_status or ClientApprovalStatus.approved
    return ClientResponse(
        id=client.id,
        name=client.name,
        billing_type=client.billing_type,
        default_rate=None if redact_money else client.default_rate,
        is_active=client.is_active,
        approval_status=status_val,
        proposed_by_name=_proposer_name(client),
        proposed_at=client.proposed_at,
        reviewed_at=client.reviewed_at,
    )


def _ensure_default_package(db: Session, client: Client, included=None, overage=None) -> None:
    pkg = (
        db.query(ClientPackage)
        .filter(ClientPackage.client_id == client.id, ClientPackage.is_default == True)
        .first()
    )
    if pkg:
        pkg.billing_type = client.billing_type
        pkg.amount = client.default_rate or 0
        pkg.is_active = True
        if included is not None:
            pkg.included_hours = included
        if overage is not None:
            pkg.overage_rate = overage
        return
    db.add(ClientPackage(
        client_id=client.id,
        name=f"{client.name} — Default",
        billing_type=client.billing_type,
        amount=client.default_rate or 0,
        included_hours=included,
        overage_rate=overage,
        currency=Currency.USD,
        is_default=True,
        is_active=True,
    ))


@router.get("", response_model=list[ClientResponse])
def list_clients(
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
    active_only: bool = False,
    include_archived: bool = True,
    include_pending: bool = True,
):
    q = db.query(Client).options(joinedload(Client.proposer))
    if active_only:
        q = q.filter(Client.is_active == True, Client.approval_status == ClientApprovalStatus.approved)
    elif not include_archived:
        q = q.filter(Client.is_active == True)
    if current.role == UserRole.auditor:
        # Auditors see live approved clients + any pending/rejected proposals (for status)
        if not include_pending:
            q = q.filter(Client.approval_status == ClientApprovalStatus.approved)
    elif current.role != UserRole.admin and not include_pending:
        q = q.filter(Client.approval_status == ClientApprovalStatus.approved)
    redact = current.role == UserRole.auditor
    return [_client_response(c, redact) for c in q.order_by(Client.name).all()]


@router.post("", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(
    body: ClientCreate,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    if db.query(Client).filter(Client.name == body.name).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client already exists")
    data = body.model_dump()
    included = data.pop("included_hours", None)
    overage = data.pop("overage_rate", None)
    is_auditor = current.role == UserRole.auditor
    if is_auditor:
        # Auditor proposals never go live and never carry money fields
        data["default_rate"] = None
        client = Client(
            **data,
            is_active=False,
            approval_status=ClientApprovalStatus.pending,
            proposed_by=current.user.id,
            proposed_at=datetime.now(timezone.utc),
        )
        db.add(client)
        db.flush()
        db.commit()
        db.refresh(client)
        push(
            db,
            admin_user_ids(db),
            "system",
            f"New client proposal: {client.name}",
            f"{current.user.display_name or current.user.email} requested a new client. Review, set the rate, and approve.",
            "/admin/clients",
            exclude_user_id=current.user.id,
        )
        client = (
            db.query(Client)
            .options(joinedload(Client.proposer))
            .filter(Client.id == client.id)
            .first()
        )
        return _client_response(client, redact_money=True)

    client = Client(**data, approval_status=ClientApprovalStatus.approved, is_active=True)
    db.add(client)
    db.flush()
    _ensure_default_package(db, client, included=included, overage=overage)
    db.commit()
    db.refresh(client)
    return _client_response(client)


@router.post("/{client_id}/approve", response_model=ClientResponse)
def approve_client(
    client_id: UUID,
    body: ClientApproveRequest,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = (
        db.query(Client)
        .options(joinedload(Client.proposer))
        .filter(Client.id == client_id)
        .first()
    )
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    if body.billing_type is not None:
        client.billing_type = body.billing_type
    if body.default_rate is not None:
        client.default_rate = body.default_rate
    client.approval_status = ClientApprovalStatus.approved
    client.is_active = True
    client.reviewed_by = current.user.id
    client.reviewed_at = datetime.now(timezone.utc)
    _ensure_default_package(db, client, included=body.included_hours, overage=body.overage_rate)
    db.commit()
    db.refresh(client)
    if client.proposed_by:
        push(
            db,
            [client.proposed_by],
            "system",
            f"Client approved: {client.name}",
            "The admin reviewed your client proposal, set the rate, and approved it. It’s now live.",
            "/admin/clients",
        )
    client = (
        db.query(Client)
        .options(joinedload(Client.proposer))
        .filter(Client.id == client_id)
        .first()
    )
    return _client_response(client)


@router.post("/{client_id}/reject", response_model=ClientResponse)
def reject_client(
    client_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    client = (
        db.query(Client)
        .options(joinedload(Client.proposer))
        .filter(Client.id == client_id)
        .first()
    )
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    client.approval_status = ClientApprovalStatus.rejected
    client.is_active = False
    client.reviewed_by = current.user.id
    client.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(client)
    if client.proposed_by:
        push(
            db,
            [client.proposed_by],
            "system",
            f"Client proposal declined: {client.name}",
            "The admin declined this client proposal. It will not go live.",
            "/admin/clients",
        )
    client = (
        db.query(Client)
        .options(joinedload(Client.proposer))
        .filter(Client.id == client_id)
        .first()
    )
    return _client_response(client)


@router.get("/financials")
def clients_financials(
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """ADMIN ONLY — lifetime financials per client since the client was created.

    total_earned = sum of all invoice amounts (billed); collected = paid invoices;
    va_earned = VA pay on approved+invoiced logs; net = earned − VA earned.
    Amounts are invoice currency (USD) vs VA pay in the VA's own currency —
    see per-VA breakdown for currency. Net is the billed-minus-VA-cost figure
    the admin uses in payroll currency terms as stored on the logs.
    """
    from decimal import Decimal
    from app.models import WorkLogStatus

    rows = []
    for client in db.query(Client).order_by(Client.name).all():
        logs = db.query(WorkLog).filter(WorkLog.client_id == client.id).all()
        billable = [l for l in logs if l.status in (WorkLogStatus.approved, WorkLogStatus.invoiced)]
        invoices = db.query(Invoice).filter(Invoice.client_id == client.id).all()
        total_hours = sum((l.hours for l in billable), Decimal("0"))
        va_earned = sum((l.va_pay for l in billable), Decimal("0"))
        total_earned = sum((i.amount for i in invoices), Decimal("0"))
        collected = sum((i.amount for i in invoices if str(getattr(i.status, "value", i.status)) == "paid"), Decimal("0"))
        rows.append({
            "client_id": str(client.id), "client_name": client.name, "is_active": bool(client.is_active),
            "created_at": client.created_at.isoformat() if client.created_at else None,
            "total_hours": str(total_hours), "total_earned": str(total_earned),
            "total_collected": str(collected), "total_outstanding": str(total_earned - collected),
            "va_earned": str(va_earned), "net": str(total_earned - va_earned),
            "net_collected": str(collected - va_earned),
            "invoices_count": len(invoices),
        })
    return rows


@router.get("/{client_id}/detail")
def client_detail(
    client_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    """Everything connected to a client: stats, sub-clients, projects, tasks, logs, invoices."""
    from datetime import date as _date
    from decimal import Decimal
    from sqlalchemy import func as _func
    from sqlalchemy.orm import joinedload as _jl
    from app.models import Project, Task, TaskStatus, WorkLogStatus
    from app.routers.tasks import _serialize as serialize_task
    from app.routers.work_logs import _serialize_log

    redact = current.role == UserRole.auditor
    client = db.query(Client).options(_jl(Client.sub_clients)).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")

    today = _date.today()
    month_start = today.replace(day=1)
    logs = db.query(WorkLog).filter(WorkLog.client_id == client_id).all()
    billable = [l for l in logs if l.status in (WorkLogStatus.approved, WorkLogStatus.invoiced)]
    pending = [l for l in logs if l.status == WorkLogStatus.submitted]
    tasks = db.query(Task).filter(Task.client_id == client_id).all()
    open_tasks = [t for t in tasks if t.status != TaskStatus.done]
    projects = db.query(Project).filter(Project.client_id == client_id).order_by(Project.created_at.desc()).all()
    invoices = db.query(Invoice).filter(Invoice.client_id == client_id).order_by(Invoice.created_at.desc()).all()

    def hours(items):
        return sum((l.hours for l in items), Decimal("0"))

    sub_rows = []
    for s in client.sub_clients:
        s_logs = [l for l in billable if l.sub_client_id == s.id]
        sub_rows.append({
            "id": str(s.id), "name": s.name, "is_active": bool(s.is_active),
            "hours": str(hours(s_logs)), "logs": len(s_logs),
            "tasks": len([t for t in tasks if t.sub_client_id == s.id]),
        })

    project_rows = []
    for p in projects:
        p_tasks = [t for t in tasks if t.project_id == p.id]
        project_rows.append({
            "id": str(p.id), "name": p.name, "status": p.status.value if hasattr(p.status, "value") else str(p.status),
            "cadence": p.cadence.value if hasattr(p.cadence, "value") else str(p.cadence), "color": p.color,
            "sub_client_name": p.sub_client.name if p.sub_client else None,
            "task_total": len(p_tasks), "task_done": len([t for t in p_tasks if t.status == TaskStatus.done]),
            "hours": str(hours([l for l in billable if l.project_id == p.id])),
            "due_date": str(p.due_date) if p.due_date else None,
        })

    recent_tasks = sorted(tasks, key=lambda t: t.updated_at or t.created_at, reverse=True)[:20]
    recent_logs = sorted(logs, key=lambda l: (l.work_date, l.created_at), reverse=True)[:20]

    # ── Lifetime financials (admin view in the UI; since client created) ──
    total_earned = sum((i.amount for i in invoices), Decimal("0"))
    total_collected = sum((i.amount for i in invoices if str(getattr(i.status, "value", i.status)) == "paid"), Decimal("0"))
    va_earned = sum((l.va_pay for l in billable), Decimal("0"))
    net = total_earned - va_earned
    by_va_map: dict[str, dict] = {}
    for l in billable:
        key = str(l.va_id)
        row = by_va_map.setdefault(key, {"va_id": key, "va_name": l.va.name if l.va else "VA", "currency": (l.va.currency.value if l.va and hasattr(l.va.currency, "value") else str(l.va.currency) if l.va else ""), "hours": Decimal("0"), "va_pay": Decimal("0"), "logs": 0})
        row["hours"] += l.hours; row["va_pay"] += l.va_pay; row["logs"] += 1
    by_va = [{**r, "hours": str(r["hours"]), "va_pay": str(r["va_pay"])} for r in sorted(by_va_map.values(), key=lambda x: x["va_name"].lower())]
    financials = {
        "since": client.created_at.isoformat() if client.created_at else None,
        "total_hours": str(hours(billable)),
        "total_earned": str(total_earned), "total_collected": str(total_collected),
        "total_outstanding": str(total_earned - total_collected),
        "va_earned": str(va_earned), "net": str(net), "net_collected": str(total_collected - va_earned),
        "profit_margin_pct": round(float(net / total_earned * 100), 1) if total_earned else None,
        "invoices_count": len(invoices),
        "invoices_paid": len([i for i in invoices if str(getattr(i.status, "value", i.status)) == "paid"]),
        "invoices_unpaid_count": len([i for i in invoices if str(getattr(i.status, "value", i.status)) == "unpaid"]),
        "by_va": by_va,
    }

    if redact:
        financials = {
            "since": client.created_at.isoformat() if client.created_at else None,
            "total_hours": str(hours(billable)),
            "total_earned": None, "total_collected": None, "total_outstanding": None,
            "va_earned": None, "net": None, "net_collected": None, "profit_margin_pct": None,
            "invoices_count": len(invoices),
            "invoices_paid": len([i for i in invoices if str(getattr(i.status, "value", i.status)) == "paid"]),
            "invoices_unpaid_count": len([i for i in invoices if str(getattr(i.status, "value", i.status)) == "unpaid"]),
            "by_va": [{"va_id": r["va_id"], "va_name": r["va_name"], "currency": "", "hours": r["hours"], "va_pay": None, "logs": r["logs"]} for r in by_va],
        }

    return {
        "client": {
            "id": str(client.id), "name": client.name,
            "billing_type": client.billing_type.value if hasattr(client.billing_type, "value") else str(client.billing_type),
            "default_rate": None if redact else (str(client.default_rate) if client.default_rate is not None else None),
            "is_active": bool(client.is_active),
            "approval_status": (client.approval_status.value if hasattr(client.approval_status, "value") else str(client.approval_status or "approved")),
            "created_at": client.created_at.isoformat() if client.created_at else None,
        },
        "stats": {
            "total_hours": str(hours(billable)),
            "hours_this_month": str(hours([l for l in billable if l.work_date >= month_start])),
            "pending_hours": str(hours(pending)), "pending_count": len(pending),
            "invoiced_hours": str(hours([l for l in billable if l.status == WorkLogStatus.invoiced])),
            "ready_to_invoice_hours": str(hours([l for l in billable if l.status == WorkLogStatus.approved])),
            "logs_count": len(logs),
            "tasks_total": len(tasks), "tasks_open": len(open_tasks),
            "tasks_done": len([t for t in tasks if t.status == TaskStatus.done]),
            "tasks_overdue": len([t for t in open_tasks if t.due_date and t.due_date < today]),
            "invoices_count": len(invoices), "invoices_unpaid": len([i for i in invoices if str(getattr(i.status, "value", i.status)) == "unpaid"]),
            "va_names": sorted({l.va.name for l in logs if l.va}),
            "last_activity": str(max((l.work_date for l in logs), default=None)) if logs else None,
        },
        "financials": financials,
        "sub_clients": sub_rows,
        "projects": project_rows,
        "tasks": [serialize_task(db, t).model_dump(mode="json") for t in recent_tasks],
        "logs": [_serialize_log(l, redact_money=redact).model_dump(mode="json") for l in recent_logs],
        "invoices": [{
            "id": str(i.id), "invoice_number": i.invoice_number, "period_label": i.period_label,
            "total_hours": str(i.total_hours), "amount": None if redact else str(i.amount),
            "status": i.status.value if hasattr(i.status, "value") else str(i.status),
            "issue_date": str(i.issue_date), "due_date": str(i.due_date),
            "paid_at": i.paid_at.isoformat() if i.paid_at else None,
        } for i in invoices],
    }


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
    data = body.model_dump(exclude_unset=True)
    included = data.pop("included_hours", None)
    overage = data.pop("overage_rate", None)
    for k, v in data.items():
        setattr(client, k, v)
    default_pkg = (
        db.query(ClientPackage)
        .filter(ClientPackage.client_id == client_id, ClientPackage.is_default == True)
        .first()
    )
    if default_pkg:
        if "billing_type" in data:
            default_pkg.billing_type = client.billing_type
        if "default_rate" in data:
            default_pkg.amount = client.default_rate or 0
        if included is not None:
            default_pkg.included_hours = included
        if overage is not None:
            default_pkg.overage_rate = overage
    db.commit()
    db.refresh(client)
    client = (
        db.query(Client)
        .options(joinedload(Client.proposer))
        .filter(Client.id == client_id)
        .first()
    )
    return _client_response(client)


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
    _: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
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
    # Hide sub-clients of pending/rejected proposals from operational lists
    q = q.join(Client).filter(Client.approval_status == ClientApprovalStatus.approved)
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


@router.get("/{client_id}/packages", response_model=list[ClientPackageResponse])
def list_packages(
    client_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    rows = (
        db.query(ClientPackage)
        .filter(ClientPackage.client_id == client_id, ClientPackage.is_active == True)
        .order_by(ClientPackage.is_default.desc(), ClientPackage.name)
        .all()
    )
    if current.role == UserRole.auditor:
        return [
            ClientPackageResponse(
                id=p.id, client_id=p.client_id, name=p.name, billing_type=p.billing_type,
                amount=0, included_hours=None, overage_rate=None, currency=p.currency,
                is_default=p.is_default, is_active=p.is_active,
            )
            for p in rows
        ]
    return rows


@router.post("/packages", response_model=ClientPackageResponse, status_code=status.HTTP_201_CREATED)
def create_package(
    body: ClientPackageCreate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if not db.query(Client).filter(Client.id == body.client_id).first():
        raise HTTPException(404, "Client not found")
    if body.is_default:
        db.query(ClientPackage).filter(ClientPackage.client_id == body.client_id).update({"is_default": False})
    pkg = ClientPackage(**body.model_dump())
    db.add(pkg)
    # Keep Client.billing_type / default_rate in sync with default package
    if body.is_default:
        client = db.query(Client).filter(Client.id == body.client_id).first()
        client.billing_type = body.billing_type
        client.default_rate = body.amount
    db.commit()
    db.refresh(pkg)
    return pkg


@router.patch("/packages/{package_id}", response_model=ClientPackageResponse)
def update_package(
    package_id: UUID,
    body: ClientPackageUpdate,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    pkg = db.query(ClientPackage).filter(ClientPackage.id == package_id).first()
    if not pkg:
        raise HTTPException(404, "Package not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("is_default"):
        db.query(ClientPackage).filter(ClientPackage.client_id == pkg.client_id, ClientPackage.id != package_id).update({"is_default": False})
    for k, v in data.items():
        setattr(pkg, k, v)
    if pkg.is_default:
        client = db.query(Client).filter(Client.id == pkg.client_id).first()
        if client:
            client.billing_type = pkg.billing_type
            client.default_rate = pkg.amount
    db.commit()
    db.refresh(pkg)
    return pkg


@router.delete("/packages/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_package(
    package_id: UUID,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    pkg = db.query(ClientPackage).filter(ClientPackage.id == package_id).first()
    if not pkg:
        raise HTTPException(404, "Package not found")
    pkg.is_active = False
    db.commit()
