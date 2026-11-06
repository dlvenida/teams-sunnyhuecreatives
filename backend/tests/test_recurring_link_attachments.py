"""URL attachments follow a recurring task. Uploaded files stay on the completed one."""
import unittest
import uuid
from datetime import date, timedelta
from decimal import Decimal

from app.auth import hash_password
from app.database import SessionLocal
from app.models import (
    BillingType,
    Client,
    CommentAttachment,
    Task,
    TaskRecurrence,
    TaskStatus,
    User,
    UserRole,
)
from app.services.task_recurrence import copy_recurring_link_attachments, spawn_next_occurrence


class RecurringLinkAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.user_ids = []
        self.client_row = Client(
            name=f"Futureglaze {uuid.uuid4().hex[:6]}",
            billing_type=BillingType.hourly,
            default_rate=Decimal("10"),
            is_active=True,
        )
        self.db.add(self.client_row)
        self.db.flush()
        self.user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.va,
            display_name="Leya",
            is_active=True,
        )
        self.db.add(self.user)
        self.db.flush()
        self.user_ids.append(self.user.id)
        self.task = self._task("Futureglaze | Monthly Content Production", TaskRecurrence.monthly, TaskStatus.done)
        self.manual = self._task("One-off brochure", TaskRecurrence.none, TaskStatus.done)
        self.db.commit()

    def _task(self, title, recurrence, status):
        task = Task(
            title=title,
            client_id=self.client_row.id,
            status=status,
            recurrence=recurrence,
            due_date=date.today().replace(day=1),
            priority="medium",
        )
        self.db.add(task)
        self.db.flush()
        return task

    def _link(self, task, label, url, provider="google_drive"):
        row = CommentAttachment(
            scope="task",
            scope_id=task.id,
            uploaded_by=self.user.id,
            uploader_name="Leya",
            storage_key="",
            storage_backend="link",
            link_url=url,
            provider=provider,
            original_name=label,
            format="link",
        )
        self.db.add(row)
        self.db.flush()
        return row

    def _upload(self, task, name, fmt):
        row = CommentAttachment(
            scope="task",
            scope_id=task.id,
            uploaded_by=self.user.id,
            uploader_name="Leya",
            storage_key=f"task-comments/{task.id}/{uuid.uuid4()}.{fmt}",
            storage_backend="local",
            link_url=None,
            original_name=name,
            format=fmt,
            size_bytes=1200,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def tearDown(self):
        self.db.rollback()
        task_ids = [row.id for row in self.db.query(Task).filter(Task.client_id == self.client_row.id).all()]
        if task_ids:
            self.db.query(CommentAttachment).filter(CommentAttachment.scope_id.in_(task_ids)).delete(synchronize_session=False)
            self.db.query(Task).filter(Task.id.in_(task_ids)).delete(synchronize_session=False)
        self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id == self.client_row.id).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _attachments(self, task_id):
        return (
            self.db.query(CommentAttachment)
            .filter(CommentAttachment.scope == "task", CommentAttachment.scope_id == task_id)
            .order_by(CommentAttachment.original_name.asc())
            .all()
        )

    def test_links_copy_and_uploads_stay_on_the_completed_task(self):
        plan = self._link(self.task, "Content Plan Folder", "https://drive.google.com/file/d/plan123/view")
        brand = self._link(self.task, "Brand Guidelines", "https://drive.google.com/drive/folders/brand456")
        canva = self._link(self.task, "Canva Graphics Folder", "https://www.canva.com/folder/graphics", provider="canva")
        jpg = self._upload(self.task, "Graphic 01.jpg", "jpg")
        png = self._upload(self.task, "Graphic 02.png", "png")
        original_ids = {plan.id, brand.id, canva.id, jpg.id, png.id}
        self.db.commit()

        child = spawn_next_occurrence(self.db, self.task)
        self.db.commit()
        self.assertIsNotNone(child)
        self.assertEqual(child.recurrence, TaskRecurrence.monthly)
        self.assertEqual(child.assignee_va_id, self.task.assignee_va_id)
        self.assertEqual(child.status, TaskStatus.todo)
        self.assertNotEqual(child.id, self.task.id)

        copied = self._attachments(child.id)
        self.assertEqual(
            [(row.original_name, row.link_url, row.storage_backend) for row in copied],
            [
                ("Brand Guidelines", "https://drive.google.com/drive/folders/brand456", "link"),
                ("Canva Graphics Folder", "https://www.canva.com/folder/graphics", "link"),
                ("Content Plan Folder", "https://drive.google.com/file/d/plan123/view", "link"),
            ],
        )
        self.assertTrue(all(row.format == "link" for row in copied))
        self.assertFalse(any(row.original_name.endswith((".jpg", ".png")) for row in copied))

        kept = self._attachments(self.task.id)
        self.assertEqual({row.id for row in kept}, original_ids)
        self.assertEqual(jpg.storage_key, next(row.storage_key for row in kept if row.id == jpg.id))
        self.assertEqual(plan.link_url, next(row.link_url for row in kept if row.id == plan.id))

    def test_generating_again_does_not_duplicate_links(self):
        self._link(self.task, "Content Plan Folder", "https://drive.google.com/file/d/plan123/view")
        self.db.commit()
        first = spawn_next_occurrence(self.db, self.task)
        self.db.commit()
        again = spawn_next_occurrence(self.db, self.task)
        self.assertIsNone(again)
        copy_recurring_link_attachments(self.db, self.task, first)
        self.db.commit()
        links = [row for row in self._attachments(first.id) if row.storage_backend == "link"]
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].link_url, "https://drive.google.com/file/d/plan123/view")

    def test_a_manual_task_is_not_given_a_copy(self):
        self._link(self.manual, "Shot list", "https://www.dropbox.com/s/shots/list")
        self._upload(self.manual, "notes.pdf", "pdf")
        self.db.commit()
        self.assertIsNone(spawn_next_occurrence(self.db, self.manual))
        self.db.commit()
        rows = self._attachments(self.manual.id)
        self.assertEqual(len(rows), 2)
        siblings = self.db.query(Task).filter(Task.client_id == self.client_row.id, Task.id != self.manual.id, Task.id != self.task.id).count()
        self.assertEqual(siblings, 0)

    def test_weekly_and_daily_schedules_also_carry_the_link(self):
        for recurrence in (TaskRecurrence.daily, TaskRecurrence.weekly, TaskRecurrence.weekdays):
            task = self._task(f"Repeat {recurrence.value}", recurrence, TaskStatus.done)
            task.due_date = date.today() - timedelta(days=3)
            self._link(task, "Folder", f"https://drive.google.com/drive/folders/{recurrence.value}")
            self._upload(task, "photo.jpeg", "jpeg")
            self.db.commit()
            child = spawn_next_occurrence(self.db, task)
            self.db.commit()
            self.assertIsNotNone(child, recurrence.value)
            copied = self._attachments(child.id)
            self.assertEqual(len(copied), 1)
            self.assertEqual(copied[0].link_url, f"https://drive.google.com/drive/folders/{recurrence.value}")
            self.assertEqual(copied[0].original_name, "Folder")
            self.assertEqual(len(self._attachments(task.id)), 2)


if __name__ == "__main__":
    unittest.main()
