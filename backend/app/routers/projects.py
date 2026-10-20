from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import CurrentUser, get_current_user, require_admin
from app.models import Client, Project, ProjectStatus, SubClient, Task, TaskStatus, WorkLog
from app.schemas import ProjectCreate, ProjectResponse, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _serialize(db: Session, p: Project) -> ProjectResponse:
    total = db.query(func.count(Task.id)).filter(Task.project_id == p.id).scalar() or 0
    done = db.query(func.count(Task.id)).filter(Task.project_id == p.id, Task.status == TaskStatus.done).scalar() or 0
    prog = db.query(func.count(Task.id)).filter(Task.project_id == p.id, Task.status == TaskStatus.in_progress).scalar() or 0
    hours = db.query(func.coalesce(func.sum(WorkLog.hours), 0)).filter(WorkLog.project_id == p.id).scalar() or Decimal("0")
    return ProjectResponse(
        id=p.id, client_id=p.client_id, client_name=p.client.name if p.client else None,
        sub_client_id=p.sub_client_id, sub_client_name=p.sub_client.name if p.sub_client else None,
        name=p.name, description=p.description, color=p.color or "#ec4899", status=p.status, cadence=p.cadence,
        start_date=p.start_date, due_date=p.due_date, task_total=int(total), task_done=int(done),
        task_in_progress=int(prog), total_hours=Decimal(str(hours)), created_at=p.created_at,
    )


@router.get("", response_model=list[ProjectResponse])
def list_projects(
    _: Annotated[CurrentUser, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    client_id: UUID | None = None,
    status_filter: ProjectStatus | None = None,
    include_archived: bool = True,
):
    q = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client))
    if client_id:
        q = q.filter(Project.client_id == client_id)
    if status_filter:
        q = q.filter(Project.status == status_filter)
    elif not include_archived:
        q = q.filter(Project.status != ProjectStatus.archived)
    return [_serialize(db, p) for p in q.order_by(Project.created_at.desc()).all()]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, current: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    if not db.query(Client).filter(Client.id == body.client_id).first():
        raise HTTPException(404, "Client not found")
    if body.sub_client_id and not db.query(SubClient).filter(SubClient.id == body.sub_client_id, SubClient.client_id == body.client_id).first():
        raise HTTPException(400, "Sub-client does not belong to this client")
    if body.due_date and body.start_date and body.due_date < body.start_date:
        raise HTTPException(400, "Due date cannot be before start date")
    p = Project(**body.model_dump(), created_by=current.user.id)
    db.add(p); db.commit(); db.refresh(p)
    p = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client)).filter(Project.id == p.id).first()
    return _serialize(db, p)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID, _: Annotated[CurrentUser, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]):
    p = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client)).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    return _serialize(db, p)


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: UUID, body: ProjectUpdate, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    data = body.model_dump(exclude_unset=True)
    if "client_id" in data and data["client_id"] and not db.query(Client).filter(Client.id == data["client_id"]).first():
        raise HTTPException(404, "Client not found")
    for k, v in data.items(): setattr(p, k, v)
    if p.due_date and p.start_date and p.due_date < p.start_date:
        raise HTTPException(400, "Due date cannot be before start date")
    db.commit(); db.refresh(p)
    p = db.query(Project).options(joinedload(Project.client), joinedload(Project.sub_client)).filter(Project.id == p.id).first()
    return _serialize(db, p)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: UUID, _: Annotated[CurrentUser, Depends(require_admin)], db: Annotated[Session, Depends(get_db)]):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    # Tasks keep existing but lose project link via FK SET NULL? Tasks defined SET NULL, but ORM cascade on project.tasks would delete.
    # Detach tasks first.
    db.query(Task).filter(Task.project_id == project_id).update({Task.project_id: None})
    db.delete(p); db.commit()
