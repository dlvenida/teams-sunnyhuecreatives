"""Client financials use paid records, kept apart by currency."""
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.auth import create_access_token, create_token_payload, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    BillingType,
    Client,
    ClientApprovalStatus,
    Currency,
    Invoice,
    InvoiceStatus,
    ManualEarning,
    PaydayRate,
    PaymentMethod,
    PayType,
    PayrollRun,
    RateStatus,
    User,
    UserRole,
    VA,
    VARate,
    WorkLog,
    WorkLogStatus,
)
from app.services.client_money import allocate_paid_amount


def _auth(user):
    token = create_access_token(create_token_payload(user.id, user.role.value, None))
    return {"Authorization": f"Bearer {token}"}


class AllocatePaidAmountTests(unittest.TestCase):
    def test_hourly_pay_scales_to_the_amount_actually_marked_paid(self):
        first, second = uuid4(), uuid4()
        shares = [(first, Decimal("4"), Decimal("80")), (second, Decimal("1"), Decimal("20"))]
        allocated = allocate_paid_amount(Decimal("50.00"), shares, set())
        self.assertEqual(allocated[first], Decimal("40.00"))
        self.assertEqual(allocated[second], Decimal("10.00"))
        self.assertEqual(sum(allocated.values()), Decimal("50.00"))

    def test_package_pay_follows_the_hours_share_not_the_log_amount(self):
        first, second = uuid4(), uuid4()
        shares = [(first, Decimal("10"), Decimal("999")), (second, Decimal("30"), Decimal("999"))]
        allocated = allocate_paid_amount(Decimal("5666.68"), shares, {first, second})
        self.assertEqual(allocated[first], Decimal("1416.67"))
        self.assertEqual(allocated[second], Decimal("4250.01"))
        self.assertEqual(sum(allocated.values()), Decimal("5666.68"))

    def test_package_with_no_hours_stays_on_the_package_client(self):
        client_id = uuid4()
        allocated = allocate_paid_amount(Decimal("4200.00"), [], {client_id})
        self.assertEqual(allocated, {client_id: Decimal("4200.00")})


class ClientFinancialApiTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.user_ids = []
        self.client_ids = []
        self.invoice_ids = []
        self.earning_ids = []
        self.run_ids = []
        self.log_ids = []
        self.rate_ids = []
        self.payday_ids = []
        stamp = uuid4().hex[:8]
        self.admin = self._staff(f"Jane {stamp}", UserRole.admin)
        self.pm = self._staff(f"PM {stamp}", UserRole.auditor)
        self.db.commit()

    def tearDown(self):
        self.db.rollback()
        if self.log_ids:
            self.db.query(WorkLog).filter(WorkLog.id.in_(self.log_ids)).delete(synchronize_session=False)
        if self.rate_ids:
            self.db.query(VARate).filter(VARate.id.in_(self.rate_ids)).delete(synchronize_session=False)
        if self.run_ids:
            self.db.query(PayrollRun).filter(PayrollRun.id.in_(self.run_ids)).delete(synchronize_session=False)
        if self.invoice_ids:
            self.db.query(Invoice).filter(Invoice.id.in_(self.invoice_ids)).delete(synchronize_session=False)
        if self.earning_ids:
            self.db.query(ManualEarning).filter(ManualEarning.id.in_(self.earning_ids)).delete(synchronize_session=False)
        if self.payday_ids:
            self.db.query(PaydayRate).filter(PaydayRate.id.in_(self.payday_ids)).delete(synchronize_session=False)
        if self.client_ids:
            self.db.query(Client).filter(Client.id.in_(self.client_ids)).delete(synchronize_session=False)
        if self.user_ids:
            self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
            self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

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
        return va

    def _customer(self, name):
        row = Client(
            name=name,
            billing_type=BillingType.hourly,
            is_active=True,
            approval_status=ClientApprovalStatus.approved,
        )
        self.db.add(row)
        self.db.flush()
        self.client_ids.append(row.id)
        return row

    def _log(self, va, client, day, hours, pay, status=WorkLogStatus.approved, payable_on=None):
        row = WorkLog(
            work_date=day,
            payable_on=payable_on,
            va_id=va.id,
            client_id=client.id,
            description_plain="Client work",
            hours=Decimal(hours),
            va_rate=Decimal("1"),
            va_pay=Decimal(pay),
            status=status,
        )
        self.db.add(row)
        self.db.flush()
        self.log_ids.append(row.id)
        return row

    def _run(self, va, total, currency, rate, start=date(2026, 11, 1), end=date(2026, 11, 15)):
        row = PayrollRun(
            va_id=va.id,
            period_start=start,
            period_end=end,
            total_hours=Decimal("1"),
            total_pay=Decimal(total),
            currency=currency,
            usd_php_rate=None if rate is None else Decimal(rate),
            paid_at=datetime(2026, 11, 16, 8, tzinfo=timezone.utc),
        )
        self.db.add(row)
        self.db.flush()
        self.run_ids.append(row.id)
        return row

    def _invoice(self, client, amount, currency, status):
        row = Invoice(
            invoice_number=f"T{uuid4().hex[:8]}",
            client_id=client.id,
            currency=currency,
            period_label="November",
            period_start=date(2026, 11, 1),
            period_end=date(2026, 11, 15),
            total_hours=Decimal("1"),
            billing_type=BillingType.hourly,
            rate=Decimal(amount),
            amount=Decimal(amount),
            status=status,
            payment_method=PaymentMethod.wise,
            issue_date=date(2026, 11, 4),
            due_date=date(2026, 11, 11),
        )
        self.db.add(row)
        self.db.flush()
        self.invoice_ids.append(row.id)
        return row

    def _earning(self, client, amount, currency):
        row = ManualEarning(
            client_id=client.id,
            earned_date=date(2026, 11, 5),
            description="Retainer",
            amount=Decimal(amount),
            currency=currency,
            created_by=self.admin.id,
        )
        self.db.add(row)
        self.db.flush()
        self.earning_ids.append(row.id)
        return row

    def _package(self, va, client):
        row = VARate(
            va_id=va.id,
            client_id=client.id,
            pay_type=PayType.package,
            currency=Currency.PHP,
            amount=Decimal("11333.36"),
            payment_frequency="biweekly",
            status=RateStatus.approved,
            reviewed_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
        )
        self.db.add(row)
        self.db.flush()
        self.rate_ids.append(row.id)
        return row

    def _confirm_rate(self, rate="58"):
        row = PaydayRate(
            period_start=date(2026, 11, 1),
            period_end=date(2026, 11, 15),
            usd_php_rate=Decimal(rate),
            confirmed_at=datetime(2099, 6, 1, tzinfo=timezone.utc),
            confirmed_by=self.admin.id,
        )
        self.db.add(row)
        self.db.flush()
        self.payday_ids.append(row.id)
        return row

    def _row(self, client_id):
        listed = self.client.get("/clients/financials", headers=_auth(self.admin))
        self.assertEqual(listed.status_code, 200, listed.text)
        found = next(row for row in listed.json() if row["client_id"] == str(client_id))
        detail = self.client.get(f"/clients/{client_id}/detail", headers=_auth(self.admin))
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["financials"]["va_earned"], found["va_earned"])
        self.assertEqual(detail.json()["financials"]["total_earned"], found["total_earned"])
        return found

    def test_paid_runs_keep_each_currency_and_use_each_saved_rate(self):
        chef = self._customer(f"Chef Stephanie Tranchina {uuid4().hex[:4]}")
        aquirah = self._va("Aquirah Daine M.", Currency.USD)
        gem = self._va("Gem", Currency.USD)
        arby = self._va("Arby Mae L.", Currency.PHP)
        self._log(aquirah, chef, date(2026, 11, 4), "1", "7.88")
        self._log(gem, chef, date(2026, 11, 5), "2", "114.41")
        self._log(arby, chef, date(2026, 11, 6), "3", "999.00")
        self._run(aquirah, "7.88", "USD", "58")
        self._run(gem, "114.41", "USD", "60")
        self._run(arby, "1032.30", "PHP", "58")
        self._invoice(chef, "100.00", "USD", InvoiceStatus.paid)
        self._invoice(chef, "40.00", "USD", InvoiceStatus.unpaid)
        self._earning(chef, "580.00", "PHP")
        self._confirm_rate("58")
        self.db.commit()

        row = self._row(chef.id)
        self.assertEqual(row["va_earned"]["usd"], "122.29")
        self.assertEqual(row["va_earned"]["php"], "1032.30")
        self.assertNotEqual(row["va_earned"]["usd"], "1154.59")
        self.assertEqual(row["va_earned"]["combined_usd"], "140.09")
        self.assertEqual(row["va_earned"]["combined_php"], "8353.94")
        self.assertEqual(row["total_earned"]["usd"], "100.00")
        self.assertEqual(row["total_earned"]["php"], "580.00")
        self.assertEqual(row["total_collected"], row["total_earned"])
        self.assertEqual(row["total_outstanding"]["usd"], "40.00")
        self.assertEqual(row["total_outstanding"]["php"], "0.00")
        self.assertEqual(row["net"]["usd"], "-22.29")
        self.assertEqual(row["net"]["php"], "-452.30")
        self.assertEqual(row["net"]["combined_usd"], "-30.09")
        self.assertEqual(row["net"]["combined_php"], "-1973.94")
        self.assertLess(Decimal(row["net"]["combined_usd"]), 0)
        self.assertLess(Decimal(row["net"]["combined_php"]), 0)
        self.assertIn("58.00", row["rate_label"])
        self.assertIn("60.00", row["rate_label"])
        self.assertIn("each paid run", row["rate_label"])
        arby_row = next(person for person in row["by_va"] if person["va_name"] == "Arby Mae L.")
        self.assertEqual(arby_row["va_pay_php"], "1032.30")
        self.assertNotEqual(arby_row["va_pay_php"], "999.00")

    def test_package_payment_is_split_by_hours_and_unpaid_logs_stay_separate(self):
        alpha = self._customer(f"Package Alpha {uuid4().hex[:4]}")
        beta = self._customer(f"Package Beta {uuid4().hex[:4]}")
        kyla = self._va("Kyla Marie S.", Currency.PHP)
        self._package(kyla, alpha)
        self._package(kyla, beta)
        self._log(kyla, alpha, date(2026, 11, 3), "10", "999")
        self._log(kyla, beta, date(2026, 11, 4), "30", "999")
        self._log(kyla, alpha, date(2026, 10, 20), "5", "50", payable_on=date(2026, 11, 3))
        self._run(kyla, "5666.68", "PHP", "58")
        self._log(kyla, alpha, date(2026, 12, 2), "1", "200.00")
        self._log(kyla, alpha, date(2026, 12, 3), "1", "80.00", status=WorkLogStatus.submitted)
        self.db.commit()

        alpha_row = self._row(alpha.id)
        beta_row = self._row(beta.id)
        # 15 hours of 45, from the November logs plus the October log rolled into this payday.
        self.assertEqual(alpha_row["va_earned"]["php"], "2088.89")
        self.assertEqual(beta_row["va_earned"]["php"], "3777.79")
        self.assertEqual(alpha_row["va_unpaid"]["php"], "200.00")
        self.assertEqual(alpha_row["va_unpaid"]["usd"], "0.00")
        self.assertEqual(beta_row["va_unpaid"]["php"], "0.00")
        paid_php = Decimal(alpha_row["va_earned"]["php"]) - Decimal(alpha_row["va_unpaid"]["php"])
        self.assertEqual(paid_php, Decimal("1888.89"))
        self.assertEqual(
            Decimal(alpha_row["va_earned"]["php"]) + Decimal(beta_row["va_earned"]["php"]),
            Decimal("5866.68"),
        )

    def test_project_manager_sees_no_client_money(self):
        chef = self._customer(f"Hidden Client {uuid4().hex[:4]}")
        va = self._va("Lea Babe C.", Currency.USD)
        self._log(va, chef, date(2026, 11, 4), "1", "10")
        self._run(va, "10.00", "USD", "58")
        self.db.commit()

        listed = self.client.get("/clients/financials", headers=_auth(self.pm))
        self.assertEqual(listed.status_code, 403, listed.text)
        detail = self.client.get(f"/clients/{chef.id}/detail", headers=_auth(self.pm))
        self.assertEqual(detail.status_code, 200, detail.text)
        financials = detail.json()["financials"]
        self.assertIsNone(financials["total_earned"])
        self.assertIsNone(financials["va_earned"])
        self.assertIsNone(financials["net"])
        self.assertIsNone(financials["rate_label"])
        self.assertIsNone(financials["by_va"][0]["va_pay"])
