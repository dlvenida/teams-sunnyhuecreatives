"""A review log cannot be sent back without a picked reason."""
import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth import create_access_token, create_token_payload, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    BillingType,
    Client,
    ClientApprovalStatus,
    Currency,
    User,
    UserRole,
    VA,
    WorkLog,
    WorkLogRejection,
    WorkLogStatus,
)


def _auth(user, va_id=None):
    token = create_access_token(create_token_payload(user.id, user.role.value, va_id))
    return {"Authorization": f"Bearer {token}"}


class LogRejectionTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.user_ids = []
        self.client_ids = []
        self.log_ids = []
        stamp = uuid4().hex[:8]
        self.admin = self._staff(f"Jane {stamp}", UserRole.admin)
        self.pm = self._staff(f"Audrey {stamp}", UserRole.auditor)
        self.va_user, self.va = self._va(f"Arby {stamp}")
        self.customer = self._customer(f"Chef {stamp}")
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        if self.log_ids:
            self.db.query(WorkLogRejection).filter(WorkLogRejection.work_log_id.in_(self.log_ids)).delete(synchronize_session=False)
            self.db.query(WorkLog).filter(WorkLog.id.in_(self.log_ids)).delete(synchronize_session=False)
        if self.client_ids:
            self.db.query(Client).filter(Client.id.in_(self.client_ids)).delete(synchronize_session=False)
        if self.user_ids:
            self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
            self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _staff(self, name, role):
        user = User(email=f"{uuid4().hex[:8]}@example.com", password_hash=hash_password("test1234"), role=role, display_name=name, is_active=True)
        self.db.add(user)
        self.db.flush()
        self.user_ids.append(user.id)
        return user

    def _va(self, name):
        user = self._staff(name, UserRole.va)
        va = VA(user_id=user.id, name=name, currency=Currency.PHP, is_active=True)
        self.db.add(va)
        self.db.flush()
        return user, va

    def _customer(self, name):
        row = Client(name=name, billing_type=BillingType.hourly, is_active=True, approval_status=ClientApprovalStatus.approved)
        self.db.add(row)
        self.db.flush()
        self.client_ids.append(row.id)
        return row

    def _log(self, status=WorkLogStatus.submitted):
        row = WorkLog(
            work_date=date(2026, 11, 4),
            va_id=self.va.id,
            client_id=self.customer.id,
            description_plain="Engagement screenshots",
            hours=Decimal("1"),
            va_rate=Decimal("1"),
            va_pay=Decimal("1"),
            status=status,
        )
        self.db.add(row)
        self.db.flush()
        self.log_ids.append(row.id)
        self.db.commit()
        return row

    def test_reject_requires_a_reason_and_the_va_can_resubmit(self):
        log = self._log()
        missing = self.client.post(f"/work-logs/{log.id}/reject", headers=_auth(self.admin), json={"reasons": [], "note": ""})
        self.assertEqual(missing.status_code, 400, missing.text)
        unknown = self.client.post(f"/work-logs/{log.id}/reject", headers=_auth(self.pm), json={"reasons": ["Not on the list"]})
        self.assertEqual(unknown.status_code, 400, unknown.text)

        rejected = self.client.post(
            f"/work-logs/{log.id}/reject",
            headers=_auth(self.pm),
            json={"reasons": ["Cropped or blurry", "Wrong client"], "note": "The top of the chat is cut off."},
        )
        self.assertEqual(rejected.status_code, 200, rejected.text)
        body = rejected.json()
        self.assertEqual(body["status"], "rejected")
        self.assertNotIn("va_pay", body)
        self.assertEqual(body["needs_fixing"], "Needs fixing: Cropped or blurry, Wrong client. Note: The top of the chat is cut off.")
        self.assertEqual(body["rejection_history"][0]["rejected_by_name"], self.pm.display_name)
        self.assertIsNotNone(body["rejection_history"][0]["rejected_at"])
        self.assertNotIn("\u2014", body["needs_fixing"])
        self.assertNotIn("\u2013", body["needs_fixing"])

        va_view = self.client.get("/va/work-logs", headers=_auth(self.va_user, self.va.id))
        self.assertEqual(va_view.status_code, 200, va_view.text)
        mine = next(row for row in va_view.json() if row["id"] == str(log.id))
        self.assertEqual(mine["needs_fixing"], body["needs_fixing"])

        edited = self.client.patch(
            f"/va/work-logs/{log.id}",
            headers=_auth(self.va_user, self.va.id),
            json={"description_plain": "Engagement screenshots, recropped"},
        )
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["status"], "submitted")
        self.assertIsNone(edited.json().get("needs_fixing"))
        self.assertEqual(edited.json()["rejection_history"][0]["last_sent_back"], "Last sent back: Cropped or blurry, Wrong client. Note: The top of the chat is cut off.")

        listed = self.client.get("/work-logs", headers=_auth(self.admin))
        again = next(row for row in listed.json() if row["id"] == str(log.id))
        self.assertEqual(again["status"], "submitted")
        self.assertIn("Last sent back:", again["rejection_history"][0]["last_sent_back"])

    def test_old_rejected_entry_without_a_reason_still_loads(self):
        log = self._log(WorkLogStatus.rejected)
        listed = self.client.get("/work-logs", headers=_auth(self.admin))
        row = next(item for item in listed.json() if item["id"] == str(log.id))
        self.assertEqual(row["status"], "rejected")
        self.assertEqual(row["needs_fixing"], "No reason given")
        self.assertEqual(row["rejection_history"], [])
