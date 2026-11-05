"""Clock-in New Task is created for the VA, including when an admin is viewing as that VA."""
import unittest
from decimal import Decimal
from uuid import uuid4

from app.database import SessionLocal
from app.deps import CurrentUser
from app.models import Client, ClientVARole, Project, Task, TaskStatus, User, UserRole, VA
from app.routers.tasks import create_task
from app.schemas import TaskCreate


class ClockInNewTaskTests(unittest.TestCase):
    def test_view_as_creates_the_task_for_the_va_not_the_admin(self):
        db = SessionLocal()
        task_id = None
        client_id = None
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            va_user = db.query(User).filter(User.role == UserRole.va).first()
            va = db.query(VA).filter(VA.user_id == va_user.id).first()
            admin_va = db.query(VA).filter(VA.user_id == admin.id).first()
            self.assertIsNotNone(va)
            self.assertIsNotNone(admin_va)
            self.assertNotEqual(va.id, admin_va.id)
            client = Client(name=f"Clock In Co {uuid4().hex[:6]}", billing_type="hourly", default_rate=Decimal("10"), is_active=True)
            db.add(client)
            db.flush()
            client_id = client.id
            project = Project(client_id=client.id, name="Monthly Content", color="#ec4899")
            db.add(project)
            db.flush()
            db.add(ClientVARole(client_id=client.id, va_id=va.id, role="General VA"))
            db.commit()
            viewing = CurrentUser(user=va_user, va_id=va.id, impersonated_by=admin.id)
            created = create_task(
                TaskCreate(
                    title="Graphic for the candle post",
                    client_id=client.id,
                    project_id=project.id,
                    status=TaskStatus.todo,
                    assignee_va_id=admin_va.id,
                ),
                viewing,
                db,
            )
            task_id = created.id
            stored = db.query(Task).filter(Task.id == created.id).one()
            self.assertEqual(stored.assignee_va_id, va.id)
            self.assertNotEqual(stored.assignee_va_id, admin_va.id)
            self.assertEqual(stored.created_by, va_user.id)
            self.assertNotEqual(stored.created_by, admin.id)
            self.assertEqual(stored.client_id, client.id)
            self.assertEqual(stored.project_id, project.id)
            self.assertEqual(stored.status, TaskStatus.todo)
            self.assertIsNone(stored.description)
        finally:
            if task_id:
                db.query(Task).filter(Task.id == task_id).delete()
            if client_id:
                db.query(ClientVARole).filter(ClientVARole.client_id == client_id).delete()
                db.query(Project).filter(Project.client_id == client_id).delete()
                db.query(Client).filter(Client.id == client_id).delete()
            db.commit()
            db.close()
