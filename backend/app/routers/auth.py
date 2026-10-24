from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    create_refresh_token,
    create_token_payload,
    decode_token,
    hash_password,
    unique_username,
    verify_password,
)
from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin, require_admin_or_auditor
from app.models import ActivityLog, Project, Task, TaskStatus, TimeClockEntry, User, UserRole, VA, WorkLog, WorkLogStatus
from app.schemas import (
    AppUserResponse,
    ChangePasswordRequest,
    CreateAppUserRequest,
    CreateVAUserRequest,
    LoginRequest,
    PinLoginRequest,
    RefreshRequest,
    TokenResponse,
    VAResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _ensure_worker_profile(db: Session, user: User) -> VA | None:
    """VA users must have a VA row. Admin/auditor also get one so they can clock their own time."""
    va = db.query(VA).filter(VA.user_id == user.id).first()
    if va:
        return va
    if user.role == UserRole.va:
        return None
    if user.role not in (UserRole.admin, UserRole.auditor):
        return None
    from app.models import Currency
    name = (user.display_name or user.email.split("@")[0]).strip() or "Team member"
    va = VA(user_id=user.id, name=name, currency=Currency.PHP, is_active=True)
    db.add(va)
    db.commit()
    db.refresh(va)
    return va


def _issue_tokens(user: User, db: Session) -> TokenResponse:
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    va_id = None
    name = user.display_name or None
    if user.role == UserRole.va:
        va = db.query(VA).filter(VA.user_id == user.id).first()
        if not va:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="VA profile not found")
        va_id = va.id
        name = va.name
    elif user.role in (UserRole.admin, UserRole.auditor):
        va = _ensure_worker_profile(db, user)
        if va:
            va_id = va.id
            if not name:
                name = va.name
    if not name:
        name = user.email.split("@")[0]
    payload = create_token_payload(user.id, user.role.value, va_id)
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
        username=user.username,
        role=user.role,
        must_change_password=user.must_change_password,
        va_id=va_id,
        name=name,
        user_id=user.id,
    )


def _find_user(db: Session, identifier: str | None) -> User | None:
    """Look a user up by username (case-insensitive) or by email."""
    ident = (identifier or "").strip()
    if not ident:
        return None
    if "@" in ident:
        return db.query(User).filter(User.email == ident.lower()).first()
    return db.query(User).filter(User.username == ident.lower()).first()


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Annotated[Session, Depends(get_db)]):
    user = _find_user(db, str(body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return _issue_tokens(user, db)


PIN_MAX_ATTEMPTS = 5
PIN_LOCK_MINUTES = 15


@router.post("/pin-login", response_model=TokenResponse)
def pin_login(body: PinLoginRequest, db: Annotated[Session, Depends(get_db)]):
    """Quick login with the user's 6-digit PIN (set in Profile → Security).

    The PIN is only a convenience shortcut for a known account on a trusted
    device — the full password always remains valid. Brute-force protection:
    5 wrong attempts locks PIN login for 15 minutes.
    """
    from datetime import datetime, timedelta, timezone

    user = _find_user(db, body.username or body.email)
    if not user or not user.pin_hash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No PIN is set for this account. Sign in with your password, then set a PIN in Profile → Security.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    now = datetime.now(timezone.utc)
    if user.pin_locked_until and user.pin_locked_until > now:
        minutes = max(1, int((user.pin_locked_until - now).total_seconds() // 60) + 1)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=f"PIN login is locked after too many wrong attempts. Try again in {minutes} min or use your password.")
    if not verify_password(body.pin, user.pin_hash):
        user.pin_failed_attempts = (user.pin_failed_attempts or 0) + 1
        attempts_left = PIN_MAX_ATTEMPTS - user.pin_failed_attempts
        if user.pin_failed_attempts >= PIN_MAX_ATTEMPTS:
            user.pin_locked_until = now + timedelta(minutes=PIN_LOCK_MINUTES)
            user.pin_failed_attempts = 0
            db.commit()
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail=f"Too many wrong PINs. PIN login locked for {PIN_LOCK_MINUTES} minutes — use your password meanwhile.")
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail=f"Incorrect PIN. {attempts_left} attempt{'s' if attempts_left != 1 else ''} left before PIN login locks.")
    user.pin_failed_attempts = 0
    user.pin_locked_until = None
    db.commit()
    return _issue_tokens(user, db)


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    va_id = UUID(payload["va_id"]) if payload.get("va_id") else None
    name = user.display_name or user.email.split("@")[0]
    if va_id:
        va = db.query(VA).filter(VA.id == va_id).first()
        name = va.name if va else name

    impersonated_by = UUID(payload["impersonated_by"]) if payload.get("impersonated_by") else None
    impersonator_name = None
    if impersonated_by:
        imp = db.query(User).filter(User.id == impersonated_by).first()
        impersonator_name = (imp.display_name or imp.email) if imp else None
    token_payload = create_token_payload(user.id, user.role.value, va_id, impersonated_by=impersonated_by)
    return TokenResponse(
        access_token=create_access_token(token_payload),
        refresh_token=create_refresh_token(token_payload),
        role=user.role,
        must_change_password=user.must_change_password,
        va_id=va_id,
        name=name,
        user_id=user.id,
        is_impersonating=impersonated_by is not None,
        impersonated_by=impersonated_by,
        impersonated_by_name=impersonator_name,
    )


@router.post("/impersonate/{user_id}", response_model=TokenResponse)
def impersonate_user(
    user_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Admin-only: issue a token AS another user so the admin sees exactly their view.

    Read/write acts as the target (their VA board, clock, logs) — the token
    carries `impersonated_by` so it is auditable and the UI can offer Exit.
    Admins cannot impersonate themselves or another administrator.
    """
    if current.impersonated_by is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already viewing as another user — exit that view first")
    if user_id == current.user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You are already signed in as yourself")
    target = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found or archived")
    if target.role == UserRole.admin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot switch into another administrator account")
    va_id = None
    name = target.display_name or target.email.split("@")[0]
    if target.role == UserRole.va:
        va = db.query(VA).filter(VA.user_id == target.id).first()
        if not va:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VA profile not found for this user")
        va_id = va.id
        name = va.name
    admin_name = current.user.display_name or current.user.email
    payload = create_token_payload(target.id, target.role.value, va_id, impersonated_by=current.user.id)
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
        role=target.role,
        must_change_password=False,
        va_id=va_id,
        name=name,
        user_id=target.id,
        is_impersonating=True,
        impersonated_by=current.user.id,
        impersonated_by_name=admin_name,
    )


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    current: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    if not verify_password(body.current_password, current.user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current.user.password_hash = hash_password(body.new_password)
    current.user.must_change_password = False
    db.commit()
    return {"message": "Password updated"}


def _app_user(db: Session, u: User) -> AppUserResponse:
    va = db.query(VA).filter(VA.user_id == u.id).first()
    name = u.display_name or (va.name if va else None) or u.email.split("@")[0]
    auditing = db.query(VA).filter(VA.reviewer_user_id == u.id).count() if u.role in (UserRole.auditor, UserRole.admin) else 0
    return AppUserResponse(id=u.id, email=u.email, username=u.username, name=name, role=u.role.value, is_active=bool(u.is_active), va_id=va.id if va else None, auditing_count=auditing)


@router.get("/users", response_model=list[AppUserResponse])
def list_app_users(
    _: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    """All app users across roles: Administrator, Auditor, Virtual Assistant."""
    users = db.query(User).order_by(User.role, User.email).all()
    return [_app_user(db, u) for u in users]


@router.get("/users/{user_id}/detail")
def user_detail(
    user_id: UUID,
    current: Annotated[CurrentUser, Depends(require_admin_or_auditor)],
    db: Annotated[Session, Depends(get_db)],
):
    """360° view of one user: profile, assigned clients/tasks/projects,
    timeline, time logs and activity history. Money fields are hidden for auditors."""
    from decimal import Decimal

    from app.routers.tasks import _serialize as serialize_task
    from app.routers.timeclock import _serialize as serialize_clock
    from app.routers.work_logs import _serialize_log

    redact = current.role == UserRole.auditor
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    va = db.query(VA).filter(VA.user_id == u.id).first()
    name = u.display_name or (va.name if va else None) or u.email.split("@")[0]

    tasks: list[Task] = []
    logs: list[WorkLog] = []
    clocks: list[TimeClockEntry] = []
    if va:
        tasks = db.query(Task).filter(Task.assignee_va_id == va.id).order_by(Task.due_date.asc().nullslast(), Task.updated_at.desc()).all()
        logs = db.query(WorkLog).filter(WorkLog.va_id == va.id).order_by(WorkLog.work_date.desc(), WorkLog.created_at.desc()).all()
        clocks = db.query(TimeClockEntry).filter(TimeClockEntry.va_id == va.id).order_by(TimeClockEntry.clock_in.desc()).all()

    billable = [l for l in logs if l.status in (WorkLogStatus.approved, WorkLogStatus.invoiced)]
    def _hours(items):
        return sum((l.hours for l in items), Decimal("0"))
    def _pay(items):
        return sum((l.va_pay for l in items), Decimal("0"))

    # Assigned clients: union of tasks + work logs + explicit per-client roles
    from app.models import Client, ClientVARole

    role_by_client: dict[str, str] = {}
    if va:
        for r in db.query(ClientVARole).filter(ClientVARole.va_id == va.id).all():
            role_by_client[str(r.client_id)] = r.role

    client_ids: list = []
    for src in [t.client_id for t in tasks] + [l.client_id for l in logs]:
        if src and src not in client_ids:
            client_ids.append(src)
    for cid_str in role_by_client:
        try:
            uid = UUID(cid_str)
        except ValueError:
            continue
        if uid not in client_ids:
            client_ids.append(uid)
    assigned_clients = []
    for cid in client_ids:
        c_tasks = [t for t in tasks if t.client_id == cid]
        c_logs = [l for l in billable if l.client_id == cid]
        all_c_logs = [l for l in logs if l.client_id == cid]
        client_obj = c_tasks[0].client if c_tasks and c_tasks[0].client else (all_c_logs[0].client if all_c_logs else None)
        if not client_obj:
            client_obj = db.query(Client).filter(Client.id == cid).first()
        cid_str = str(cid)
        assigned_clients.append({
            "client_id": cid_str, "name": client_obj.name if client_obj else "Unknown",
            "is_active": bool(client_obj.is_active) if client_obj else True,
            "open_tasks": len([t for t in c_tasks if t.status != TaskStatus.done]),
            "done_tasks": len([t for t in c_tasks if t.status == TaskStatus.done]),
            "total_tasks": len(c_tasks), "hours": str(_hours(c_logs)),
            "va_pay": None if redact else str(_pay(c_logs)),
            "logs": len(all_c_logs),
            "last_log_date": str(max((l.work_date for l in all_c_logs), default=None)) if all_c_logs else None,
            "role": role_by_client.get(cid_str) or "",
            "has_explicit_role": cid_str in role_by_client,
        })
    assigned_clients.sort(key=lambda x: x["name"].lower())

    # Assigned projects: union from tasks + logs
    project_ids: list = []
    for src in ([t.project_id for t in tasks] + [l.project_id for l in logs]):
        if src and src not in project_ids:
            project_ids.append(src)
    assigned_projects = []
    for pid in project_ids:
        p = db.query(Project).filter(Project.id == pid).first()
        if not p:
            continue
        p_tasks = [t for t in tasks if t.project_id == pid]
        p_logs = [l for l in billable if l.project_id == pid]
        assigned_projects.append({
            "id": str(p.id), "name": p.name, "color": p.color,
            "status": p.status.value if hasattr(p.status, "value") else str(p.status),
            "cadence": p.cadence.value if hasattr(p.cadence, "value") else str(p.cadence),
            "client_id": str(p.client_id), "client_name": p.client.name if p.client else None,
            "sub_client_name": p.sub_client.name if p.sub_client else None,
            "task_total": len(p_tasks), "task_done": len([t for t in p_tasks if t.status == TaskStatus.done]),
            "hours": str(_hours(p_logs)), "due_date": str(p.due_date) if p.due_date else None,
        })

    history = db.query(ActivityLog).filter(ActivityLog.user_id == u.id).order_by(ActivityLog.created_at.desc()).limit(80).all()
    # Auditors/admins: also surface VAs they review
    reviewing = []
    if u.role in (UserRole.auditor, UserRole.admin):
        for v in db.query(VA).filter(VA.reviewer_user_id == u.id).all():
            reviewing.append({"va_id": str(v.id), "name": v.name})

    # Unified timeline (newest first): logs, clock sessions, completed tasks, activity
    timeline: list[dict] = []
    for l in logs[:40]:
        timeline.append({"kind": "log", "at": f"{l.work_date}T00:00:00", "date_label": str(l.work_date), "title": f"{l.hours} hrs · {l.client.name if l.client else ''}", "detail": l.description_plain[:160], "status": l.status.value if hasattr(l.status, "value") else str(l.status)})
    for c in clocks[:40]:
        timeline.append({"kind": "clock", "at": c.clock_in.isoformat() if c.clock_in else "", "date_label": str(c.clock_in.date()) if c.clock_in else "", "title": f"Clock · {c.client.name if c.client else c.task.title if c.task else 'General'}", "detail": f"{c.status.value if hasattr(c.status, 'value') else c.status}" + (f" · {round((c.duration_seconds or 0)/3600, 2)} hrs" if c.duration_seconds else ""), "status": c.status.value if hasattr(c.status, "value") else str(c.status)})
    for t in [t for t in tasks if t.completed_at][:40]:
        timeline.append({"kind": "task_done", "at": t.completed_at.isoformat() if t.completed_at else "", "date_label": str(t.completed_at.date()) if t.completed_at else "", "title": f"Completed: {t.title}", "detail": t.client.name if t.client else "", "status": "done"})
    timeline.sort(key=lambda x: x["at"] or "", reverse=True)

    from datetime import date as _date
    today = _date.today()
    week_start = today.fromordinal(today.toordinal() - today.weekday())
    return {
        "profile": {
            "user_id": str(u.id), "va_id": str(va.id) if va else None,
            "name": name, "email": u.email, "role": u.role.value, "is_active": bool(u.is_active),
            "currency": None if redact else (va.currency.value if va and hasattr(va.currency, "value") else (str(va.currency) if va else None)),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "display_name": u.display_name, "phone": u.phone, "address": u.address,
            "job_title": u.job_title, "bio": u.bio, "timezone": u.timezone, "skills": u.skills or [],
            "hire_date": str(u.hire_date) if u.hire_date else None,
            "status_message": u.status_message, "linkedin_url": u.linkedin_url, "portfolio_url": u.portfolio_url,
            "wise_email": None if redact else u.wise_email, "has_profile_photo": bool(u.profile_photo_path),
            "reviewer_name": (va.reviewer.display_name or va.reviewer.email) if va and getattr(va, "reviewer", None) else None,
            "reviewing": reviewing,
        },
        "stats": {
            "total_hours": str(_hours(billable)), "total_va_pay": None if redact else str(_pay(billable)),
            "hours_this_week": str(_hours([l for l in billable if l.work_date >= week_start])),
            "pending_hours": str(_hours([l for l in logs if l.status == WorkLogStatus.submitted])),
            "logs_count": len(logs), "pending_count": len([l for l in logs if l.status == WorkLogStatus.submitted]),
            "tasks_total": len(tasks), "tasks_open": len([t for t in tasks if t.status != TaskStatus.done]),
            "tasks_done": len([t for t in tasks if t.status == TaskStatus.done]),
            "tasks_overdue": len([t for t in tasks if t.status != TaskStatus.done and t.due_date and t.due_date < today]),
            "clients_count": len(assigned_clients), "projects_count": len(assigned_projects),
            "clock_sessions": len(clocks),
            "clock_hours": str(Decimal(str(round(sum((c.duration_seconds or 0) for c in clocks) / 3600, 2)))),
            "last_activity": timeline[0]["at"] if timeline else None,
        },
        "assigned_clients": assigned_clients,
        "assigned_projects": assigned_projects,
        "tasks": [serialize_task(db, t).model_dump(mode="json") for t in tasks],
        "time_logs": [_serialize_log(l, redact_money=redact).model_dump(mode="json") for l in logs[:100]],
        "clock_history": [serialize_clock(c).model_dump(mode="json") for c in clocks[:100]],
        "timeline": timeline[:80],
        "history": [{"id": str(h.id), "action": h.action, "description": h.description, "path": h.path, "method": h.method, "created_at": h.created_at.isoformat() if h.created_at else None} for h in history],
    }


@router.post("/users", response_model=AppUserResponse, status_code=status.HTTP_201_CREATED)
def create_app_user(
    body: CreateAppUserRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if body.role not in ("admin", "auditor", "va"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role must be admin, auditor, or va")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = User(
        email=body.email, username=unique_username(db, body.email), password_hash=hash_password(body.password),
        role=UserRole(body.role), must_change_password=True, display_name=body.name,
    )
    db.add(user)
    db.flush()
    if body.role == "va":
        db.add(VA(user_id=user.id, name=body.name, currency=body.currency))
    elif body.role in ("admin", "auditor"):
        # Staff also get a worker profile so they can clock in / log their own time
        from app.models import Currency
        db.add(VA(user_id=user.id, name=body.name, currency=body.currency or Currency.PHP))
    db.commit()
    db.refresh(user)
    return _app_user(db, user)


@router.patch("/users/{user_id}", response_model=AppUserResponse)
def update_app_user(
    user_id: UUID,
    body: dict,
    current: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if "is_active" in body:
        if u.id == current.user.id and not body["is_active"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot deactivate yourself")
        u.is_active = bool(body["is_active"])
        va = db.query(VA).filter(VA.user_id == u.id).first()
        if va:
            va.is_active = bool(body["is_active"])
    if body.get("name"):
        u.display_name = str(body["name"])
        va = db.query(VA).filter(VA.user_id == u.id).first()
        if va:
            va.name = str(body["name"])
    db.commit()
    db.refresh(u)
    return _app_user(db, u)


@router.post("/va-users", response_model=VAResponse)
def create_va_user(
    body: CreateVAUserRequest,
    _: Annotated[CurrentUser, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=body.email,
        username=unique_username(db, body.email),
        password_hash=hash_password(body.password),
        role=UserRole.va,
        must_change_password=True,
    )
    db.add(user)
    db.flush()

    va = VA(user_id=user.id, name=body.name, currency=body.currency)
    db.add(va)
    db.commit()
    db.refresh(va)

    return VAResponse(id=va.id, name=va.name, currency=va.currency, is_active=va.is_active, email=user.email)
