"""Clock out keeps the typed task name and description, and posts the task comment."""
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException


class ClockLogTests(unittest.TestCase):
    def test_pause_resume_and_clock_out_save_the_description(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser
        from app.models import (
            Client,
            ClientVARole,
            Currency,
            PayType,
            Project,
            RateStatus,
            VARate,
            Task,
            TaskComment,
            ClockStatus,
            TimeClockEntry,
            User,
            UserRole,
            VA,
            WorkLog,
        )
        from app.routers.payroll import _review_entry
        from app.routers.tasks import task_work_logs
        from app.routers.timeclock import clock_in, clock_out, pause_clock, resume_clock
        from app.schemas import ClockInRequest, ClockOutRequest

        db = SessionLocal()
        try:
            va_user = db.query(User).filter(User.role == UserRole.va).first()
            va = db.query(VA).filter(VA.user_id == va_user.id).first()
            self.assertIsNotNone(va)
            # Finish any open session so this test can clock in.
            open_rows = db.query(TimeClockEntry).filter(
                TimeClockEntry.va_id == va.id,
                TimeClockEntry.status.in_([ClockStatus.running, ClockStatus.paused]),
            ).all()
            for row in open_rows:
                row.status = "completed"
                row.clock_out = row.clock_out or datetime.now(timezone.utc)
            db.commit()
            client = Client(name=f"Clock Co {uuid4().hex[:6]}", billing_type="hourly", default_rate=Decimal("10"), is_active=True)
            db.add(client)
            db.flush()
            project = Project(client_id=client.id, name="Notice Calendar", color="#ec4899")
            db.add(project)
            db.flush()
            db.add(ClientVARole(client_id=client.id, va_id=va.id, role="General VA"))
            db.add(VARate(
                va_id=va.id, client_id=client.id, pay_type=PayType.hourly, currency=Currency.USD,
                amount=Decimal("4.50"), status=RateStatus.approved,
            ))
            task = Task(title="Futureglaze | November Content", client_id=client.id, project_id=project.id, assignee_va_id=va.id)
            db.add(task)
            db.commit()
            current = CurrentUser(user=va_user, va_id=va.id)
            clock_in(ClockInRequest(task_id=task.id, client_id=client.id, project_id=project.id), current, db)
            paused = pause_clock(current, db)
            self.assertEqual(paused.status.value if hasattr(paused.status, "value") else str(paused.status), "paused")
            running = resume_clock(current, db)
            self.assertEqual(running.status.value if hasattr(running.status, "value") else str(running.status), "running")
            entry = db.query(TimeClockEntry).filter(TimeClockEntry.id == running.id).one()
            entry.clock_in = datetime.now(timezone.utc) - timedelta(minutes=12)
            db.commit()
            with self.assertRaises(HTTPException) as missing:
                clock_out(ClockOutRequest(
                    create_work_log=True,
                    task_name="",
                    description="",
                    client_id=client.id,
                    project_id=project.id,
                    task_id=task.id,
                ), current, db)
            self.assertEqual(missing.exception.status_code, 400)
            self.assertIn("task name", missing.exception.detail.lower())
            self.assertIn("describe", missing.exception.detail.lower())
            still = db.query(TimeClockEntry).filter(TimeClockEntry.id == running.id).one()
            self.assertNotEqual(str(still.status.value if hasattr(still.status, "value") else still.status), "completed")
            done = clock_out(ClockOutRequest(
                create_work_log=True,
                task_name="Created 5 graphics and revised 2 carousel slides",
                description="Built the November carousel and sent it for review",
                comment="Carousel draft is on the task.",
                client_id=client.id,
                project_id=project.id,
                task_id=task.id,
            ), current, db)
            log = db.query(WorkLog).filter(WorkLog.id == done.work_log_id).one()
            self.assertEqual(log.task_name, "Created 5 graphics and revised 2 carousel slides")
            self.assertNotEqual(log.task_name, task.title)
            self.assertEqual(log.description_plain, "Built the November carousel and sent it for review")
            self.assertEqual(log.client_id, client.id)
            self.assertEqual(log.project_id, project.id)
            self.assertEqual(log.task_id, task.id)
            self.assertGreater(log.hours, 0)
            self.assertEqual(log.source, "clock")
            comment = db.query(TaskComment).filter(TaskComment.task_id == task.id).one()
            self.assertEqual(comment.body, "Carousel draft is on the task.")
            review = _review_entry(log)
            self.assertEqual(review["description"], log.description_plain)
            self.assertIn("carousel", review["description"].lower())
            history = task_work_logs(task.id, current, db)
            self.assertEqual(history[0]["description"], log.description_plain)
            self.assertEqual(history[0]["task_name"], log.task_name)
            db.query(TaskComment).filter(TaskComment.task_id == task.id).delete()
            db.query(WorkLog).filter(WorkLog.id == log.id).delete()
            db.query(TimeClockEntry).filter(TimeClockEntry.id == done.id).delete()
            db.query(Task).filter(Task.id == task.id).delete()
            db.query(VARate).filter(VARate.client_id == client.id).delete()
            db.query(ClientVARole).filter(ClientVARole.client_id == client.id, ClientVARole.va_id == va.id).delete()
            db.query(Project).filter(Project.id == project.id).delete()
            db.query(Client).filter(Client.id == client.id).delete()
            db.commit()
        finally:
            db.rollback()
            db.close()
