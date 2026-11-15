"""Payday rates convert VA pay both ways. Expenses include that pay once."""
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth import create_access_token, create_token_payload, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    BusinessExpense,
    PayrollRun,
    TimesheetStatus,
    TimesheetSubmission,
    User,
    UserRole,
    VA,
)
from app.services.owner_finance import MoneySplit, build_owner_totals


def _run(amount, currency, rate=None):
    return SimpleNamespace(
        total_pay=Decimal(amount),
        currency=currency,
        usd_php_rate=None if rate is None else Decimal(rate),
    )


def _split(*parts):
    money = MoneySplit()
    for amount, currency in parts:
        money.add(Decimal(amount), currency)
    return money


class PaydayTotalTests(unittest.TestCase):
    def test_november_peso_total_uses_each_saved_rate(self):
        # The bank paid about PHP 116,303.67. Recorded pay was PHP 33,290.78 plus $1,298.70.
        report = build_owner_totals(
            _split(("37734.40", "PHP")),
            MoneySplit(),
            [_run("33290.78", "PHP", "63.92"), _run("1298.70", "USD", "63.92")],
            None,
        )
        paid = report["va_payroll"]
        self.assertEqual(paid["usd"], "1298.70")
        self.assertEqual(paid["php"], "33290.78")
        self.assertEqual(paid["combined_php"], "116303.68")
        self.assertEqual(paid["combined_usd"], "1819.52")
        self.assertAlmostEqual(float(paid["combined_php"]), 116303.67, delta=0.02)
        self.assertEqual(report["expense_totals"]["combined_php"], paid["combined_php"])
        self.assertEqual(report["expense_totals"]["combined_usd"], paid["combined_usd"])
        self.assertEqual(report["business_expenses"]["php"], "0.00")
        self.assertEqual(report["business_expenses"]["usd"], "0.00")
        self.assertLess(Decimal(report["net"]["combined_usd"]), 0)
        self.assertLess(Decimal(report["net"]["combined_php"]), 0)
        self.assertFalse(report["needs_rate"])

    def test_saved_rate_wins_over_the_page_rate(self):
        report = build_owner_totals(
            _split(("1000.00", "PHP")),
            MoneySplit(),
            [_run("10.00", "USD", "63.92"), _run("4200.00", "PHP", "63.92")],
            Decimal("50"),
        )
        paid = report["va_payroll"]
        self.assertEqual(paid["combined_php"], "4839.20")
        self.assertEqual(paid["combined_usd"], "75.71")
        self.assertNotEqual(paid["combined_php"], "4700.00")

    def test_page_rate_is_the_fallback_for_a_run_without_one(self):
        report = build_owner_totals(
            MoneySplit(),
            MoneySplit(),
            [_run("10.00", "USD", None), _run("100.00", "PHP", "60")],
            Decimal("58"),
        )
        paid = report["va_payroll"]
        self.assertEqual(paid["usd"], "10.00")
        self.assertEqual(paid["php"], "100.00")
        self.assertEqual(paid["combined_php"], "680.00")
        self.assertEqual(paid["combined_usd"], "11.67")
        self.assertFalse(report["needs_rate"])

    def test_missing_rate_does_not_publish_opposite_net_signs(self):
        report = build_owner_totals(
            _split(("37734.40", "PHP")),
            MoneySplit(),
            [_run("33290.78", "PHP", None), _run("1298.70", "USD", None)],
            None,
        )
        self.assertIsNone(report["va_payroll"]["combined_php"])
        self.assertIsNone(report["va_payroll"]["combined_usd"])
        self.assertIsNone(report["net"]["combined_usd"])
        self.assertIsNone(report["net"]["combined_php"])
        self.assertTrue(report["needs_rate"])
        self.assertIn("payday rate", report["rate_hint"])
        leftover_usd = Decimal(report["net"]["usd"])
        leftover_php = Decimal(report["net"]["php"])
        self.assertLess(leftover_usd, 0)
        self.assertGreater(leftover_php, 0)

    def test_business_expense_is_added_once(self):
        report = build_owner_totals(
            _split(("200.00", "USD")),
            _split(("20.00", "USD")),
            [_run("1000.00", "PHP", "58")],
            Decimal("58"),
        )
        self.assertEqual(report["business_expenses"]["usd"], "20.00")
        self.assertEqual(report["expense_totals"]["usd"], "20.00")
        self.assertEqual(report["expense_totals"]["combined_php"], "2160.00")
        self.assertEqual(report["va_payroll"]["combined_php"], "1000.00")
        # Earned $200 is PHP 11,600 at 58. Expenses are VA 1,000 plus the $20 tool.
        self.assertEqual(report["net"]["combined_usd"], "162.76")
        self.assertEqual(report["net"]["combined_php"], "9440.08")
        self.assertGreater(Decimal(report["net"]["combined_usd"]), 0)
        self.assertGreater(Decimal(report["net"]["combined_php"]), 0)

    def test_different_payday_rates_still_sum_both_currencies(self):
        report = build_owner_totals(
            _split(("5000.00", "PHP")),
            MoneySplit(),
            [_run("10.00", "USD", "60"), _run("20.00", "USD", "70")],
            None,
        )
        self.assertEqual(report["va_payroll"]["combined_php"], "2000.00")
        self.assertEqual(report["va_payroll"]["combined_usd"], "30.00")
        self.assertTrue(report["needs_rate"])
        self.assertIsNone(report["net"]["combined_usd"])


def _auth(user, va=None):
    token = create_access_token(create_token_payload(user.id, user.role.value, va.id if va else None))
    return {"Authorization": f"Bearer {token}"}


class PaydayApiTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.user_ids = []
        self.run_ids = []
        self.sheet_ids = []
        self.expense_ids = []
        stamp = uuid4().hex[:8]
        self.admin = self._staff(f"Jane {stamp}", UserRole.admin)
        self.pm = self._staff(f"PM {stamp}", UserRole.auditor)
        self.va_user, self.va = self._va(f"Ivory {stamp}", "USD")
        self.php_user, self.php_va = self._va(f"Angeline {stamp}", "PHP")
        self.db.commit()

    def _staff(self, name, role):
        user = User(
            email=f"{uuid4().hex[:8]}@example.com",
            password_hash=hash_password("test1234"),
            role=role,
            display_name=name,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        self.user_ids.append(user.id)
        return user

    def _va(self, name, currency):
        user = self._staff(name, UserRole.va)
        va = VA(user_id=user.id, name=name, currency=currency, is_active=True)
        self.db.add(va)
        self.db.flush()
        return user, va

    def tearDown(self):
        self.db.rollback()
        if self.sheet_ids:
            self.db.query(TimesheetSubmission).filter(TimesheetSubmission.id.in_(self.sheet_ids)).delete(synchronize_session=False)
        if self.run_ids:
            self.db.query(PayrollRun).filter(PayrollRun.id.in_(self.run_ids)).delete(synchronize_session=False)
        if self.expense_ids:
            self.db.query(BusinessExpense).filter(BusinessExpense.id.in_(self.expense_ids)).delete(synchronize_session=False)
        if self.user_ids:
            self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
            self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _sheet(self, va, start, end):
        row = TimesheetSubmission(
            va_id=va.id,
            period_start=start,
            period_end=end,
            status=TimesheetStatus.reviewed,
            reviewed_at=datetime(2026, 11, 15, tzinfo=timezone.utc),
        )
        self.db.add(row)
        self.db.commit()
        self.sheet_ids.append(row.id)
        return row

    def _finance(self, start, end, rate=None):
        params = {"date_from": start.isoformat(), "date_to": end.isoformat()}
        if rate is not None:
            params["usd_php_rate"] = str(rate)
        res = self.client.get("/dashboard/owner-finance", headers=_auth(self.admin), params=params)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_mark_paid_saves_the_payday_rate_and_a_later_page_rate_does_not_replace_it(self):
        self._sheet(self.va, date(2026, 11, 1), date(2026, 11, 15))
        created = self.client.post(
            "/payroll/runs",
            headers=_auth(self.admin),
            json={
                "va_id": str(self.va.id),
                "period_start": "2026-11-01",
                "period_end": "2026-11-15",
                "total_hours": "10",
                "total_pay": "10.00",
                "currency": "USD",
                "usd_php_rate": "63.92",
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.run_ids.append(created.json()["id"])
        self.assertEqual(Decimal(str(created.json()["usd_php_rate"])), Decimal("63.92"))

        seen = self._finance(date(2026, 11, 1), date(2026, 11, 30), rate="50")
        self.assertEqual(seen["va_payroll"]["usd"], "10.00")
        self.assertEqual(seen["va_payroll"]["combined_php"], "639.20")
        self.assertNotEqual(seen["va_payroll"]["combined_php"], "500.00")

        outside = PayrollRun(
            va_id=self.php_va.id,
            period_start=date(2026, 10, 1),
            period_end=date(2026, 10, 15),
            total_hours=Decimal("1"),
            total_pay=Decimal("9999.00"),
            currency="PHP",
            usd_php_rate=Decimal("63.92"),
            paid_at=datetime(2026, 10, 16, 12, tzinfo=timezone.utc),
        )
        self.db.add(outside)
        self.db.commit()
        self.run_ids.append(outside.id)
        still = self._finance(date(2026, 11, 1), date(2026, 11, 30))
        self.assertEqual(still["va_payroll"]["php"], "0.00")
        self.assertEqual(still["va_payroll"]["combined_php"], "639.20")
        self.assertEqual(still["va_runs_count"], 1)

    def test_apply_rate_updates_only_this_period_when_asked(self):
        def add_run(va, start, end, amount, currency, rate, paid):
            row = PayrollRun(
                va_id=va.id,
                period_start=start,
                period_end=end,
                total_hours=Decimal("1"),
                total_pay=Decimal(amount),
                currency=currency,
                usd_php_rate=None if rate is None else Decimal(rate),
                paid_at=paid,
            )
            self.db.add(row)
            self.db.flush()
            self.run_ids.append(row.id)
            return row

        missing = add_run(self.php_va, date(2026, 11, 1), date(2026, 11, 15), "4200.00", "PHP", None, datetime(2026, 11, 15, tzinfo=timezone.utc))
        other = add_run(self.va, date(2026, 11, 1), date(2026, 11, 15), "10.00", "USD", "50", datetime(2026, 11, 15, tzinfo=timezone.utc))
        same = add_run(self.php_va, date(2026, 11, 16), date(2026, 11, 30), "4200.00", "PHP", "63.92", datetime(2026, 11, 30, tzinfo=timezone.utc))
        outside = add_run(self.va, date(2026, 10, 1), date(2026, 10, 15), "9999.00", "USD", None, datetime(2026, 10, 16, tzinfo=timezone.utc))
        self.db.commit()
        # Viewing the whole month covers both November halves. October stays put.
        applied = self.client.post(
            "/payroll/runs/apply-rate",
            headers=_auth(self.admin),
            json={"period_start": "2026-11-01", "period_end": "2026-11-30", "usd_php_rate": "63.92"},
        )
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual(applied.json(), {"updated": 2, "unchanged": 1})
        self.db.expire_all()
        self.assertEqual(Decimal(missing.usd_php_rate), Decimal("63.92"))
        self.assertEqual(missing.total_pay, Decimal("4200.00"))
        self.assertEqual(Decimal(other.usd_php_rate), Decimal("63.92"))
        self.assertEqual(other.total_pay, Decimal("10.00"))
        self.assertEqual(Decimal(same.usd_php_rate), Decimal("63.92"))
        self.assertIsNone(outside.usd_php_rate)

        blocked = self.client.post(
            "/payroll/runs/apply-rate",
            headers=_auth(self.pm),
            json={"period_start": "2026-11-01", "period_end": "2026-11-30", "usd_php_rate": "63.92"},
        )
        self.assertEqual(blocked.status_code, 403, blocked.text)

    def test_project_manager_cannot_mark_paid_or_open_earnings(self):
        denied = self.client.post(
            "/payroll/runs",
            headers=_auth(self.pm),
            json={
                "va_id": str(self.va.id),
                "period_start": "2026-11-01",
                "period_end": "2026-11-15",
                "total_hours": "1",
                "total_pay": "10.00",
                "currency": "USD",
                "usd_php_rate": "58",
            },
        )
        self.assertEqual(denied.status_code, 403, denied.text)
        finance = self.client.get("/dashboard/owner-finance", headers=_auth(self.pm))
        self.assertEqual(finance.status_code, 403, finance.text)
        self.assertNotIn("total_pay", finance.text)
        self.assertNotIn("63.92", finance.text)
