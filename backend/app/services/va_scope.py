"""Which clients and projects a VA may log time against.

A client is in scope when the VA has a client role, an assigned task, or an
existing time log for that client. A project is in scope when it belongs to a
client the VA is assigned to as a whole, or when the VA already has a task or
time log on that project. Existing logs stay readable.
"""
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import ClientVARole, Project, Task, UserRole, WorkLog


@dataclass
class VaScope:
    client_ids: set[UUID]
    broad_client_ids: set[UUID]
    project_ids: set[UUID]

    def allows_client(self, client_id: UUID | None) -> bool:
        return client_id is not None and client_id in self.client_ids

    def allows_project(self, project: Project | None) -> bool:
        if project is None:
            return True
        if project.client_id in self.broad_client_ids:
            return True
        return project.id in self.project_ids


def load_va_scope(db: Session, va_id: UUID) -> VaScope:
    broad = {
        row[0]
        for row in db.query(ClientVARole.client_id).filter(ClientVARole.va_id == va_id).all()
        if row[0]
    }
    links = (
        db.query(Task.client_id, Task.project_id).filter(Task.assignee_va_id == va_id).all()
        + db.query(WorkLog.client_id, WorkLog.project_id).filter(WorkLog.va_id == va_id).all()
    )
    clients = set(broad)
    projects: set[UUID] = set()
    for client_id, project_id in links:
        if client_id:
            clients.add(client_id)
        if project_id:
            projects.add(project_id)
    return VaScope(client_ids=clients, broad_client_ids=broad, project_ids=projects)


def ensure_va_scope(db: Session, va_id: UUID, client_id: UUID, project_id: UUID | None) -> None:
    scope = load_va_scope(db, va_id)
    if not scope.allows_client(client_id):
        raise HTTPException(status_code=403, detail="That client is not assigned to you")
    if project_id is None:
        return
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or project.client_id != client_id or not scope.allows_project(project):
        raise HTTPException(status_code=403, detail="That project is not assigned to you")


def is_va(current) -> bool:
    role = current.role
    value = role.value if hasattr(role, "value") else str(role or "")
    return value == UserRole.va.value
