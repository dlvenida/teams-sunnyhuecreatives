"""Project grouping and the clients and projects a VA may use."""
import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.models import UserRole
from app.services.project_groups import group_projects, matching_client_ids
from app.services.va_scope import VaScope


class GroupingTests(unittest.TestCase):
    def test_clients_are_alphabetical_and_count_their_projects(self):
        groups = group_projects([
            {"client_id": "b", "client_name": "Sara Montreuil-Althaus", "name": "Content Creation and Graphics"},
            {"client_id": "a", "client_name": "Apolonia-on-Main", "name": "Instagram Engagement"},
            {"client_id": "a", "client_name": "Apolonia-on-Main", "name": "Content Scheduling"},
            {"client_id": "c", "client_name": "Krysten Mack Perez | ASC", "name": "Reels and Graphics"},
        ])
        self.assertEqual([group["client_name"] for group in groups], [
            "Apolonia-on-Main",
            "Krysten Mack Perez | ASC",
            "Sara Montreuil-Althaus",
        ])
        apolonia = groups[0]
        self.assertEqual(apolonia["count"], 2)
        self.assertEqual([project["name"] for project in apolonia["projects"]], [
            "Content Scheduling",
            "Instagram Engagement",
        ])

    def test_search_opens_only_matching_sections(self):
        groups = group_projects([
            {"client_id": "a", "client_name": "Apolonia-on-Main", "name": "Content Scheduling"},
            {"client_id": "b", "client_name": "Sara Montreuil-Althaus", "name": "Content Creation and Graphics"},
        ])
        self.assertEqual(matching_client_ids(groups, "reels"), set())
        self.assertEqual(matching_client_ids(groups, "scheduling"), {"a"})
        self.assertEqual(matching_client_ids(groups, "sara"), {"b"})
        self.assertEqual(matching_client_ids(groups, ""), set())


class ScopeRuleTests(unittest.TestCase):
    def test_a_client_role_opens_every_project_on_that_client(self):
        client = uuid4()
        other = uuid4()
        project = type("P", (), {"id": uuid4(), "client_id": client})()
        foreign = type("P", (), {"id": uuid4(), "client_id": other})()
        scope = VaScope(client_ids={client}, broad_client_ids={client}, project_ids=set())
        self.assertTrue(scope.allows_client(client))
        self.assertFalse(scope.allows_client(other))
        self.assertTrue(scope.allows_project(project))
        self.assertFalse(scope.allows_project(foreign))

    def test_a_task_or_log_opens_only_that_project(self):
        client = uuid4()
        project_id = uuid4()
        other_project = type("P", (), {"id": uuid4(), "client_id": client})()
        mine = type("P", (), {"id": project_id, "client_id": client})()
        scope = VaScope(client_ids={client}, broad_client_ids=set(), project_ids={project_id})
        self.assertTrue(scope.allows_project(mine))
        self.assertFalse(scope.allows_project(other_project))


class DatabaseScopeTests(unittest.TestCase):
    def test_va_cannot_create_projects_or_log_outside_scope_and_task_creates_no_time_entry(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser
        from app.models import Client, ClientVARole, Project, Task, User, VA, WorkLog, WorkLogStatus
        from app.routers.projects import create_project
        from app.routers.tasks import create_task
        from app.routers.va_portal import list_clients_for_va, submit_work_log
        from app.schemas import ProjectCreate, TaskCreate, WorkLogCreate
        from fastapi import HTTPException

        db = SessionLocal()
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            va_user = db.query(User).filter(User.role == UserRole.va).first()
            self.assertIsNotNone(admin)
            self.assertIsNotNone(va_user)
            va = db.query(VA).filter(VA.user_id == va_user.id).first()
            self.assertIsNotNone(va)
            mine = Client(name=f"Scope Mine {uuid4().hex[:6]}", billing_type="hourly", default_rate=Decimal("10"), is_active=True)
            other = Client(name=f"Scope Other {uuid4().hex[:6]}", billing_type="hourly", default_rate=Decimal("10"), is_active=True)
            db.add_all([mine, other])
            db.flush()
            project = Project(client_id=mine.id, name="Monthly Content Planning & Graphics", color="#ec4899")
            outsider = Project(client_id=other.id, name="Outside Project", color="#ec4899")
            db.add_all([project, outsider])
            db.flush()
            db.add(ClientVARole(client_id=mine.id, va_id=va.id, role="General VA"))
            db.commit()
            va_current = CurrentUser(user=va_user, va_id=va.id)
            admin_current = CurrentUser(user=admin, va_id=None)
            with self.assertRaises(HTTPException) as denied:
                create_project(ProjectCreate(name="VA project", client_id=mine.id), va_current, db)
            self.assertEqual(denied.exception.status_code, 403)
            created = create_project(ProjectCreate(name=f"Staff project {uuid4().hex[:4]}", client_id=mine.id), admin_current, db)
            self.assertEqual(created.client_id, mine.id)
            visible = {row.id for row in list_clients_for_va(va_current, db)}
            self.assertIn(mine.id, visible)
            self.assertNotIn(other.id, visible)
            before_logs = db.query(WorkLog).filter(WorkLog.va_id == va.id).count()
            task = create_task(
                TaskCreate(title="Futureglaze | November Content", client_id=mine.id, project_id=project.id, status="todo"),
                va_current,
                db,
            )
            self.assertEqual(task.assignee_va_id, va.id)
            self.assertEqual(task.status.value if hasattr(task.status, "value") else str(task.status), "todo")
            self.assertEqual(db.query(WorkLog).filter(WorkLog.va_id == va.id).count(), before_logs)
            with self.assertRaises(HTTPException) as blocked:
                submit_work_log(
                    WorkLogCreate(
                        work_date=date(2026, 11, 5),
                        client_id=other.id,
                        project_id=outsider.id,
                        task_name="Created 5 graphics",
                        description_plain="notes",
                        entry_mode="duration",
                        duration_hours=1,
                        duration_minutes=0,
                    ),
                    va_current,
                    db,
                )
            self.assertEqual(blocked.exception.status_code, 403)
            ok = submit_work_log(
                WorkLogCreate(
                    work_date=date(2026, 11, 5),
                    client_id=mine.id,
                    project_id=project.id,
                    task_id=task.id,
                    task_name="Created 5 graphics and revised 2 carousel slides",
                    description_plain="Graphics for the month",
                    entry_mode="duration",
                    duration_hours=1,
                    duration_minutes=15,
                ),
                va_current,
                db,
            )
            self.assertEqual(ok.task_name, "Created 5 graphics and revised 2 carousel slides")
            self.assertNotEqual(ok.task_name, task.title)
            db.query(WorkLog).filter(WorkLog.id == ok.id).delete()
            db.query(Task).filter(Task.id == task.id).delete()
            db.query(Project).filter(Project.id == created.id).delete()
            db.query(ClientVARole).filter(ClientVARole.client_id == mine.id, ClientVARole.va_id == va.id).delete()
            db.query(Project).filter(Project.id.in_([project.id, outsider.id])).delete(synchronize_session=False)
            db.query(Client).filter(Client.id.in_([mine.id, other.id])).delete(synchronize_session=False)
            db.commit()
        finally:
            db.rollback()
            db.close()
