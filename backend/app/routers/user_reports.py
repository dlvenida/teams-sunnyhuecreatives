from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin_or_auditor
from app.models import UserReport, UserRole, VA
from app.schemas import UserReportCreate, UserReportResponse, UserReportUpdate
from app.services.notifications import admin_and_auditor_user_ids, push

router = APIRouter(prefix="/user-reports", tags=["user-reports"])

CATEGORIES = {"client", "task", "time_clock", "payroll", "technical", "general"}
STATUSES = {"open", "acknowledged", "resolved"}


def _serialize(r: UserReport) -> UserReportResponse:
    return UserReportResponse(
        id=r.id, reporter_user_id=r.reporter_user_id, reporter_va_id=r.reporter_va_id,
        reporter_name=r.reporter_name, reporter_role=r.reporter_role, category=r.category,
        title=r.title, body=r.body, client_id=r.client_id,
        client_name=r.client.name if r.client else None,
        project_id=r.project_id, project_name=r.project.name if r.project else None,
        task_id=r.task_id, task_title=r.task.title if r.task else None,
        status=r.status, admin_note=r.admin_note, created_at=r.created_at, updated_at=r.updated_at,
    )


def _load(db: Session, rid: UUID):
    return db.query(UserReport).options(joinedload(UserReport.client), joinedload(UserReport.project), joinedload(UserReport.task)).filter(UserReport.id == rid).first()


@router.post("", response_model=UserReportResponse, status_code=status.HTTP_201_CREATED)
def create_report(body: UserReportCreate, current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    """Create a report addressed to Administrators and Auditors. Any signed-in user can report."""
    if body.category not in CATEGORIES:
        raise HTTPException(400, f"Category must be one of {sorted(CATEGORIES)}")
    va = db.query(VA).filter(VA.id == current.va_id).first() if current.va_id else None
    name = (va.name if va else None) or current.user.display_name or current.user.email.split("@")[0]
    report = UserReport(
        reporter_user_id=current.user.id, reporter_va_id=current.va_id,
        reporter_name=name, reporter_role=current.user.role.value,
        category=body.category, title=body.title.strip(), body=body.body.strip(),
        client_id=body.client_id, project_id=body.project_id, task_id=body.task_id, status="open",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    loaded = _load(db, report.id)
    # Notify every Administrator + Auditor (in-app; notification link opens their inbox)
    link = "/admin/user-reports"
    push(db, admin_and_auditor_user_ids(db), "system", f"📣 New report from {name}: {report.title}",
         f"{report.category.replace('_', ' ').title()}" + (f" · {loaded.client.name}" if loaded and loaded.client else "") + f" — {report.body[:160]}", link,
         exclude_user_id=current.user.id)
    return _serialize(loaded)


@router.get("", response_model=list[UserReportResponse])
def list_reports(current: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)], status_filter: str | None = None, category: str | None = None):
    """Admin/Auditor: all reports. VA (or any reporter): only their own."""
    q = db.query(UserReport).options(joinedload(UserReport.client), joinedload(UserReport.project), joinedload(UserReport.task))
    if current.user.role not in (UserRole.admin, UserRole.auditor):
        q = q.filter(UserReport.reporter_user_id == current.user.id)
    if status_filter:
        q = q.filter(UserReport.status == status_filter)
    if category:
        q = q.filter(UserReport.category == category)
    return [_serialize(r) for r in q.order_by(UserReport.created_at.desc()).limit(300).all()]


@router.patch("/{report_id}", response_model=UserReportResponse)
def update_report(report_id: UUID, body: UserReportUpdate, current: Annotated[CurrentUser, Depends(require_admin_or_auditor)], db: Annotated[Session, Depends(get_db)]):
    """Administrator/Auditor handles a report: acknowledge / resolve, with an optional note."""
    report = _load(db, report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(400, f"Status must be one of {sorted(STATUSES)}")
        report.status = body.status
    if body.admin_note is not None:
        report.admin_note = body.admin_note
    report.handled_by = current.user.id
    db.commit()
    loaded = _load(db, report_id)
    # Tell the reporter what happened
    if report.reporter_user_id != current.user.id:
        push(db, [report.reporter_user_id], "system", f"📣 Your report was {report.status}: {report.title}",
             (body.admin_note or f"An administrator/auditor marked your report as {report.status}.")[:200],
             "/va/reports" if report.reporter_role == "va" else "/admin/user-reports")
    return _serialize(loaded)
