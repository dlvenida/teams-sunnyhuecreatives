"""The statement ledger uses the same money as Earnings & expenses."""
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth import create_access_token, create_token_payload, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    BillingType,
    BusinessExpense,
    Client,
    ClientApprovalStatus,
    Invoice,
    InvoiceStatus,
    ManualEarning,
    PaymentMethod,
    PayrollRun,
    User,
    UserRole,
    VA,
)


def _auth(user):
    token = create_access_token(create_token_payload(user.id, user.role.value, None))
    return {"Authorization": f"Bearer {token}"}


class StatementApiTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.user_ids = []
        self.client_ids = []
        self.invoice_ids = []
        self.earning_ids = []
        self.expense_ids = []
        self.run_ids = []
        stamp = uuid4().hex[:8]
        self.admin = self._staff(f"Jane {stamp}", UserRole.admin)
        self.pm = self._staff(f"PM {stamp}", UserRole.auditor)
        self.va_user, self.va = self._va(f"Kyla Marie S. {stamp}")
        self.customer = self._customer(f"Blue Fawn {stamp}")
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

    def _va(self, name):
        user = self._staff(name, UserRole.va)
        va = VA(user_id=user.id, name=name, currency="PHP", is_active=True)
        self.db.add(va)
        self.db.flush()
        return user, va

    def _customer(self, name):
        row = Client(name=name, billing_type=BillingType.hourly, is_active=True, approval_status=ClientApprovalStatus.approved)
        self.db.add(row)
        self.db.flush()
        self.client_ids.append(row.id)
        return row

    def tearDown(self):
        self.db.rollback()
        if self.earning_ids:
            self.db.query(ManualEarning).filter(ManualEarning.id.in_(self.earning_ids)).delete(synchronize_session=False)
        if self.expense_ids:
            self.db.query(BusinessExpense).filter(BusinessExpense.id.in_(self.expense_ids)).delete(synchronize_session=False)
        if self.run_ids:
            self.db.query(PayrollRun).filter(PayrollRun.id.in_(self.run_ids)).delete(synchronize_session=False)
        if self.invoice_ids:
            self.db.query(Invoice).filter(Invoice.id.in_(self.invoice_ids)).delete(synchronize_session=False)
        if self.client_ids:
            self.db.query(Client).filter(Client.id.in_(self.client_ids)).delete(synchronize_session=False)
        if self.user_ids:
            self.db.query(VA).filter(VA.user_id.in_(self.user_ids)).delete(synchronize_session=False)
            self.db.query(User).filter(User.id.in_(self.user_ids)).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _params(self, currency):
        return {
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "usd_php_rate": "58",
            "display_currency": currency,
        }

    def test_statement_matches_earnings_and_names_each_line(self):
        invoice = Invoice(
            invoice_number=f"T{uuid4().hex[:8]}",
            client_id=self.customer.id,
            currency="USD",
            period_label="November",
            period_start=date(2026, 11, 1),
            period_end=date(2026, 11, 15),
            total_hours=Decimal("1"),
            billing_type=BillingType.hourly,
            rate=Decimal("100.00"),
            amount=Decimal("100.00"),
            status=InvoiceStatus.paid,
            payment_method=PaymentMethod.wise,
            issue_date=date(2026, 11, 4),
            due_date=date(2026, 11, 11),
        )
        earning = ManualEarning(
            client_id=self.customer.id,
            earned_date=date(2026, 11, 5),
            description="Retainer note",
            amount=Decimal("580.00"),
            currency="PHP",
            created_by=self.admin.id,
        )
        expense = BusinessExpense(
            expense_date=date(2026, 11, 6),
            description="Canva Pro",
            amount=Decimal("20.00"),
            currency="USD",
            created_by=self.admin.id,
        )
        run = PayrollRun(
            va_id=self.va.id,
            period_start=date(2026, 11, 1),
            period_end=date(2026, 11, 15),
            total_hours=Decimal("8"),
            total_pay=Decimal("1000.00"),
            currency="PHP",
            usd_php_rate=Decimal("60"),
            paid_at=datetime(2026, 11, 16, 8, tzinfo=timezone.utc),
        )
        self.db.add_all([invoice, earning, expense, run])
        self.db.commit()
        self.invoice_ids.append(invoice.id)
        self.earning_ids.append(earning.id)
        self.expense_ids.append(expense.id)
        self.run_ids.append(run.id)

        finance = self.client.get(
            "/dashboard/owner-finance",
            headers=_auth(self.admin),
            params={"date_from": "2026-11-01", "date_to": "2026-11-30", "usd_php_rate": "58"},
        )
        self.assertEqual(finance.status_code, 200, finance.text)
        fin = finance.json()

        for currency, key in (("PHP", "combined_php"), ("USD", "combined_usd")):
            statement = self.client.get("/dashboard/owner-statement", headers=_auth(self.admin), params=self._params(currency))
            self.assertEqual(statement.status_code, 200, statement.text)
            body = statement.json()
            self.assertEqual(body["opening_balance"], "0.00")
            self.assertEqual(body["total_in"], fin["earned"][key])
            self.assertEqual(body["va_pay"], fin["va_payroll"][key])
            self.assertEqual(body["business_expenses"], fin["business_expenses"][key])
            self.assertEqual(body["total_out"], fin["expense_totals"][key])
            self.assertEqual(body["net"], fin["net"][key])
            self.assertEqual(body["lines"][-1]["balance"], body["net"])
            blob = " ".join(line["description"] for line in body["lines"])
            self.assertNotIn("\u2014", blob)
            self.assertNotIn("\u2013", blob)

        pesos = self.client.get("/dashboard/owner-statement", headers=_auth(self.admin), params=self._params("PHP")).json()
        text = {line["description"]: line for line in pesos["lines"]}
        payment = next(line for line in pesos["lines"] if line["description"].startswith("Client payment:"))
        self.assertIn(self.customer.name, payment["description"])
        self.assertIn(invoice.invoice_number, payment["description"])
        self.assertEqual(payment["original_currency"], "USD")
        manual = next(line for line in pesos["lines"] if line["description"].startswith("Manual earning:"))
        self.assertIn("Retainer note", manual["description"])
        va_line = next(line for line in pesos["lines"] if line["description"].startswith("VA pay:"))
        self.assertIn("Nov 1 to Nov 15", va_line["description"])
        self.assertIn("60.00 PHP/USD", va_line["description"])
        self.assertIn(self.va.name, va_line["description"])
        expense_line = next(line for line in pesos["lines"] if line["description"].startswith("Business expense:"))
        self.assertIn("Canva Pro", expense_line["description"])
        self.assertTrue(text)

        denied = self.client.get("/dashboard/owner-statement", headers=_auth(self.pm), params=self._params("PHP"))
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertNotIn("total_in", denied.text)
        self.assertNotIn(self.customer.name, denied.text)
