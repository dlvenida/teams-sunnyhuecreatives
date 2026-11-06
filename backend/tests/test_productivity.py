"""Productivity percentage, dues, and who is allowed to see them."""
import unittest
import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.auth import create_access_token, create_token_payload, hash_password
from app.database import SessionLocal
from app.main import app
from decimal import Decimal
from calendar import monthrange

from app.models import BillingType, Client, Currency, PayType, RateStatus, Task, TaskStatus, User, UserRole, VA, VARate, WorkLog, WorkLogStatus
from app.services.payroll_calendar import payroll_period_for
from app.services.va_rates import own_month_pay, package_amount_for_window
from app.services.productivity import (
    assert_no_money_keys,
    bucket_for_task,
    expected_workdays,
    previous_payroll_period,
    productivity_from_counts,
    team_productivity,
    timesheet_action,
)

TODAY = date(2026, 11, 6)  # Friday


class ScoreTests(unittest.TestCase):
    def test_plain_status_from_days_logged(self):
        none = productivity_from_counts(days_logged=0, expected_days=5, tasks_done_this_week=0, tasks_open=3)
        self.assertEqual(none["status_label"], "No hours yet")
        self.assertEqual(none["percentage"], 0)
        behind = productivity_from_counts(days_logged=2, expected_days=5, tasks_done_this_week=1, tasks_open=4)
        self.assertEqual(behind["status_label"], "Behind")
        self.assertEqual(behind["percentage"], 40)
        self.assertIn("2 of 5 workdays", behind["summary"])
        self.assertIn("4 still open", behind["summary"])
        track = productivity_from_counts(days_logged=5, expected_days=5, tasks_done_this_week=2, tasks_open=1)
        self.assertEqual(track["status_label"], "On track")
        self.assertEqual(track["percentage"], 100)

    def test_expected_days_stop_at_today(self):
        days = expected_workdays(TODAY)
        self.assertEqual(days[0].weekday(), 0)
        self.assertEqual(days[-1], TODAY)
        self.assertEqual(len(days), 5)

    def test_pending_is_separate_from_overdue_and_due(self):
        self.assertEqual(bucket_for_task(TODAY - timedelta(days=1), "todo", TODAY), "overdue")
        self.assertEqual(bucket_for_task(TODAY, "in_progress", TODAY), "due_today")
        self.assertEqual(bucket_for_task(TODAY + timedelta(days=2), "todo", TODAY), "due_soon")
        self.assertEqual(bucket_for_task(None, "todo", TODAY), "pending")
        self.assertEqual(bucket_for_task(TODAY + timedelta(days=20), "in_progress", TODAY), "pending")
        self.assertIsNone(bucket_for_task(TODAY, "done", TODAY))

    def test_timesheet_due_has_no_money_and_skips_submitted(self):
        start, end = date(2026, 11, 1), date(2026, 11, 15)
        missing = timesheet_action(None, which="This", start=start, end=end, link="/va/payroll")
        self.assertEqual(missing["title"], "Timesheet not submitted")
        self.assertNotIn("pay", missing["title"].casefold())
        sent_back = timesheet_action("rejected", which="Last", start=start, end=end, link="/va/payroll")
        self.assertIn("sent back", sent_back["title"].casefold())
        self.assertIsNone(timesheet_action("submitted", which="This", start=start, end=end, link="/va/payroll"))
        self.assertIsNone(timesheet_action("reviewed", which="This", start=start, end=end, link="/va/payroll"))
        previous = previous_payroll_period(date(2026, 11, 6))
        self.assertEqual(previous, (date(2026, 10, 16), date(2026, 10, 31)))


def _auth(user, va=None):
    token = create_access_token(create_token_payload(user.id, user.role.value, va.id if va else None))
    return {"Authorization": f"Bearer {token}"}


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.user_ids = []
        self.client_row = Client(name=f"Prod Co {uuid.uuid4().hex[:6]}", billing_type=BillingType.hourly, is_active=True)
        self.db.add(self.client_row)
        self.db.flush()
        self.va_user, self.va = self._va("Mina Santos")
        self.other_user, self.other = self._va("Paolo Reyes")
        self.pm = self._staff("Leya PM", UserRole.auditor)
        self.admin = self._staff("Jane Admin", UserRole.admin)
        today = date.today()
        self.db.add(WorkLog(
            work_date=today,
            va_id=self.va.id,
            client_id=self.client_row.id,
            description_plain="Inbox",
            hours=2,
            va_rate=10,
            va_pay=20,
            status=WorkLogStatus.submitted,
        ))
        self.db.add(Task(
            title="Pending without a date",
            client_id=self.client_row.id,
            assignee_va_id=self.va.id,
            status=TaskStatus.todo,
        ))
        self.db.add(Task(
            title="Overdue brochure",
            client_id=self.client_row.id,
            assignee_va_id=self.va.id,
            status=TaskStatus.in_progress,
            due_date=today - timedelta(days=2),
        ))
        self.db.commit()

    def _va(self, name):
        user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.va,
            display_name=name,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.user_ids.append(user.id)
        va = VA(user_id=user.id, name=name, currency="PHP", is_active=True)
        self.db.add(va)
        self.db.flush()
        return user, va

    def _staff(self, name, role):
        user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=role,
            display_name=name,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.user_ids.append(user.id)
        return user

    def tearDown(self):
        self.db.rollback()
        self.db.query(WorkLog).filter(WorkLog.client_id == self.client_row.id).delete(synchronize_session=False)
        self.db.query(Task).filter(Task.client_id == self.client_row.id).delete(synchronize_session=False)
        self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id == self.client_row.id).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_va_sees_only_herself(self):
        own = self.client.get("/dashboard/productivity", headers=_auth(self.va_user, self.va))
        self.assertEqual(own.status_code, 200)
        body = own.json()
        self.assertEqual(body["va_id"], str(self.va.id))
        self.assertEqual(body["va_name"], "Mina Santos")
        self.assertNotIn("Paolo", str(body))
        self.assertGreaterEqual(body["counts"]["pending"], 1)
        self.assertGreaterEqual(body["counts"]["overdue"], 1)
        assert_no_money_keys(body)
        switched = self.client.get(f"/dashboard/productivity?va_id={self.other.id}", headers=_auth(self.va_user, self.va))
        self.assertEqual(switched.status_code, 200)
        self.assertEqual(switched.json()["va_id"], str(self.va.id))
        other = self.client.get(f"/dashboard/productivity/{self.other.id}", headers=_auth(self.va_user, self.va))
        self.assertEqual(other.status_code, 403)
        team = self.client.get("/dashboard/productivity/team", headers=_auth(self.va_user, self.va))
        self.assertEqual(team.status_code, 403)

    def test_pm_sees_the_team_without_money_and_admin_sees_pay(self):
        for user in (self.pm, self.admin):
            response = self.client.get("/dashboard/productivity/team", headers=_auth(user))
            self.assertEqual(response.status_code, 200, user.display_name)
            body = response.json()
            names = [row["va_name"] for row in body["members"]]
            self.assertIn("Mina Santos", names)
            self.assertIn("Paolo Reyes", names)
            mina = next(row for row in body["members"] if row["va_name"] == "Mina Santos")
            self.assertGreaterEqual(mina["counts"]["overdue"], 1)
            self.assertGreaterEqual(mina["counts"]["pending"], 1)
            if user.role == UserRole.auditor:
                assert_no_money_keys(body)
                self.assertNotIn("month_pay", mina)
            else:
                self.assertIn("month_pay", mina)
                self.assertIn("period_pay", mina)
        direct = team_productivity(self.db)
        assert_no_money_keys(direct)
        pm_one = self.client.get(f"/dashboard/productivity/{self.va.id}", headers=_auth(self.pm))
        self.assertEqual(pm_one.status_code, 200)
        assert_no_money_keys(pm_one.json())
        admin_one = self.client.get(f"/dashboard/productivity/{self.va.id}", headers=_auth(self.admin))
        self.assertEqual(admin_one.status_code, 200)
        self.assertIn("pay", admin_one.json())

    def test_va_sees_only_her_pay_and_admin_can_open_one_va(self):
        denied_pm = self.client.get("/va/month-pay", headers=_auth(self.pm))
        self.assertEqual(denied_pm.status_code, 403)
        own = self.client.get(f"/va/month-pay?va_id={self.other.id}", headers=_auth(self.va_user, self.va))
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own.json()["month_pay"], own_month_pay(self.db, self.va.id)["month_pay"])
        admin_view = self.client.get(f"/va/month-pay?va_id={self.va.id}", headers=_auth(self.admin))
        self.assertEqual(admin_view.status_code, 200)
        self.assertEqual(admin_view.json()["month_pay"], own.json()["month_pay"])
        team = self.client.get("/dashboard/productivity/team", headers=_auth(self.pm))
        assert_no_money_keys(team.json())


class MonthPayMathTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.user_ids = []
        self.client_row = Client(name=f"Pay Co {uuid.uuid4().hex[:6]}", billing_type=BillingType.hourly, is_active=True)
        self.db.add(self.client_row)
        self.db.flush()
        self.user = User(
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=UserRole.va,
            display_name="Paid VA",
            is_active=True,
        )
        self.db.add(self.user)
        self.db.flush()
        self.user_ids.append(self.user.id)
        self.va = VA(user_id=self.user.id, name="Paid VA", currency=Currency.PHP, is_active=True)
        self.db.add(self.va)
        self.db.flush()
        self.rate = VARate(
            va_id=self.va.id,
            client_id=self.client_row.id,
            pay_type=PayType.package,
            payment_frequency="biweekly",
            currency=Currency.PHP,
            amount=Decimal("2000.00"),
            status=RateStatus.approved,
        )
        self.db.add(self.rate)
        self.db.add(WorkLog(
            work_date=date.today(),
            va_id=self.va.id,
            client_id=self.client_row.id,
            description_plain="Still waiting",
            hours=3,
            va_rate=500,
            va_pay=1500,
            status=WorkLogStatus.submitted,
        ))
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        self.db.query(VARate).filter(VARate.client_id == self.client_row.id).delete(synchronize_session=False)
        self.db.query(WorkLog).filter(WorkLog.client_id == self.client_row.id).delete(synchronize_session=False)
        self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id == self.client_row.id).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def test_biweekly_half_matches_existing_package_math_and_ignores_unapproved_logs(self):
        today = date.today()
        period_start, period_end = payroll_period_for(today)
        month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])
        snapshot = own_month_pay(self.db, self.va.id, today)
        self.assertEqual(Decimal(snapshot["period_pay"]), package_amount_for_window(Decimal("2000.00"), "biweekly", period_start, period_end))
        self.assertEqual(Decimal(snapshot["month_pay"]), package_amount_for_window(Decimal("2000.00"), "biweekly", date(today.year, today.month, 1), month_end))
        self.assertEqual(snapshot["currency"], "PHP")
        self.assertNotEqual(Decimal(snapshot["month_pay"]), Decimal("1500.00"))


if __name__ == "__main__":
    unittest.main()
