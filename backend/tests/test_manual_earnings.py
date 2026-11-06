"""Manual owner earnings: both currencies, past clients, and custom date ranges."""
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
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
from app.services.owner_finance import MoneySplit, combine


def _auth(user, va=None):
    token = create_access_token(create_token_payload(user.id, user.role.value, va.id if va else None))
    return {"Authorization": f"Bearer {token}"}


class CombineTests(unittest.TestCase):
    def test_rate_makes_one_total_in_each_currency(self):
        usd, php = combine(Decimal("150.00"), Decimal("580.00"), Decimal("58"))
        self.assertEqual(usd, Decimal("160.00"))
        self.assertEqual(php, Decimal("9280.00"))

    def test_no_rate_does_not_convert(self):
        self.assertEqual(combine(Decimal("10"), Decimal("20"), None), (None, None))
        self.assertEqual(combine(Decimal("10"), Decimal("20"), Decimal("0")), (None, None))

    def test_peso_is_not_added_onto_dollars(self):
        split = MoneySplit()
        split.add(Decimal("10"), "USD")
        split.add(Decimal("500"), "PHP")
        split.add(Decimal("5"), "usd")
        self.assertEqual(split.usd, Decimal("15"))
        self.assertEqual(split.php, Decimal("500"))


class ManualEarningApiTests(unittest.TestCase):
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
        self.current = self._client(f"Current Co {stamp}", active=True)
        self.past = self._client(f"Past Co {stamp}", active=False)
        self.admin = self._staff(f"Jane {stamp}", UserRole.admin)
        self.pm = self._staff(f"PM {stamp}", UserRole.auditor)
        self.va_user, self.va = self._va(f"VA {stamp}")
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

    def _client(self, name, active):
        row = Client(
            name=name,
            billing_type=BillingType.hourly,
            is_active=active,
            approval_status=ClientApprovalStatus.approved,
        )
        self.db.add(row)
        self.db.flush()
        self.client_ids.append(row.id)
        return row

    def _invoice(self, client, amount, currency, issue):
        row = Invoice(
            invoice_number=f"T{uuid4().hex[:10]}",
            client_id=client.id,
            currency=currency,
            period_label="Test",
            period_start=issue,
            period_end=issue,
            total_hours=Decimal("1"),
            billing_type=BillingType.hourly,
            rate=amount,
            amount=amount,
            status=InvoiceStatus.unpaid,
            payment_method=PaymentMethod.wise,
            issue_date=issue,
            due_date=issue,
        )
        self.db.add(row)
        self.db.flush()
        self.invoice_ids.append(row.id)
        return row

    def tearDown(self):
        self.db.rollback()
        if self.earning_ids or self.client_ids:
            self.db.query(ManualEarning).filter(ManualEarning.client_id.in_(self.client_ids)).delete(synchronize_session=False)
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

    def _add(self, user, client, amount, currency, earned, note=None):
        res = self.client.post(
            "/manual-earnings",
            headers=_auth(user),
            json={
                "client_id": str(client.id),
                "earned_date": earned.isoformat(),
                "amount": str(amount),
                "currency": currency,
                "description": note,
            },
        )
        if res.status_code == 201:
            self.earning_ids.append(res.json()["id"])
        return res

    def _finance(self, start, end, rate=None):
        params = {"date_from": start.isoformat(), "date_to": end.isoformat()}
        if rate is not None:
            params["usd_php_rate"] = str(rate)
        res = self.client.get("/dashboard/owner-finance", headers=_auth(self.admin), params=params)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_current_and_past_clients_keep_usd_and_php_apart(self):
        usd = self._add(self.admin, self.current, "100.00", "USD", date(2026, 11, 2), "Retainer")
        php = self._add(self.admin, self.past, "580.00", "PHP", date(2026, 11, 3), "  ")
        self.assertEqual(usd.status_code, 201, usd.text)
        self.assertEqual(php.status_code, 201, php.text)
        self.assertTrue(usd.json()["client_active"])
        self.assertFalse(php.json()["client_active"])
        self.assertIsNone(php.json()["description"])
        self.assertEqual(usd.json()["description"], "Retainer")

        plain = self._finance(date(2026, 11, 1), date(2026, 11, 6))
        self.assertEqual(plain["period_start"], "2026-11-01")
        self.assertEqual(plain["period_end"], "2026-11-06")
        self.assertIsNone(plain["usd_php_rate"])
        self.assertEqual(plain["earned"]["usd"], "100.00")
        self.assertEqual(plain["earned"]["php"], "580.00")
        self.assertIsNone(plain["earned"]["combined_usd"])
        self.assertIsNone(plain["earned"]["combined_php"])
        self.assertEqual(plain["net"]["usd"], "100.00")
        self.assertEqual(plain["net"]["php"], "580.00")
        names = {row["client_name"]: row for row in plain["by_client"]}
        self.assertEqual(names[self.current.name]["earned_usd"], "100.00")
        self.assertEqual(names[self.current.name]["manual"], 1)
        self.assertEqual(names[self.current.name]["invoices"], 0)
        self.assertEqual(names[self.past.name]["earned_php"], "580.00")
        self.assertEqual(len(plain["manual_earnings"]), 2)

        combined = self._finance(date(2026, 11, 1), date(2026, 11, 6), rate="58")
        self.assertEqual(combined["earned"]["usd"], "100.00")
        self.assertEqual(combined["earned"]["php"], "580.00")
        self.assertEqual(combined["earned"]["combined_usd"], "110.00")
        self.assertEqual(combined["earned"]["combined_php"], "6380.00")
        self.assertEqual(combined["net"]["combined_usd"], "110.00")
        past = next(row for row in combined["by_client"] if row["client_name"] == self.past.name)
        self.assertEqual(past["combined_usd"], "10.00")
        self.assertEqual(past["combined_php"], "580.00")
        self.assertEqual(past["earned_php"], "580.00")

    def test_custom_range_mixes_invoices_and_drops_outside_dates(self):
        self._add(self.admin, self.current, "100.00", "USD", date(2026, 11, 2))
        later = self._add(self.admin, self.current, "1160.00", "PHP", date(2026, 11, 10))
        outside = self._add(self.admin, self.current, "999.00", "USD", date(2026, 10, 15))
        self.assertEqual(later.status_code, 201)
        self.assertEqual(outside.status_code, 201)
        self._invoice(self.current, Decimal("50.00"), "USD", date(2026, 11, 4))
        self._invoice(self.past, Decimal("200.00"), "PHP", date(2026, 11, 4))
        expense = BusinessExpense(
            expense_date=date(2026, 11, 5),
            description="Canva",
            amount=Decimal("20.00"),
            currency="USD",
            created_by=self.admin.id,
        )
        run = PayrollRun(
            va_id=self.va.id,
            period_start=date(2026, 11, 1),
            period_end=date(2026, 11, 15),
            total_hours=Decimal("5"),
            total_pay=Decimal("1000.00"),
            currency="PHP",
            paid_at=datetime(2026, 11, 4, 12, tzinfo=timezone.utc),
        )
        self.db.add(expense)
        self.db.add(run)
        self.db.commit()
        self.expense_ids.append(expense.id)
        self.run_ids.append(run.id)

        early = self._finance(date(2026, 11, 1), date(2026, 11, 6), rate="58")
        self.assertEqual(early["earned"]["usd"], "150.00")
        self.assertEqual(early["earned"]["php"], "200.00")
        self.assertEqual(early["earned"]["combined_usd"], "153.45")
        self.assertEqual(early["earned"]["combined_php"], "8900.10")
        self.assertEqual(early["va_payroll"]["php"], "1000.00")
        self.assertEqual(early["va_payroll"]["usd"], "0.00")
        self.assertEqual(early["expense_totals"]["usd"], "20.00")
        self.assertEqual(early["net"]["usd"], "130.00")
        self.assertEqual(early["net"]["php"], "-800.00")
        self.assertEqual(early["manual_count"], 1)
        self.assertEqual(early["invoices_count"], 2)
        current = next(row for row in early["by_client"] if row["client_name"] == self.current.name)
        self.assertEqual(current["invoices"], 1)
        self.assertEqual(current["manual"], 1)
        self.assertEqual(current["earned_usd"], "150.00")
        self.assertNotIn("999.00", str(early["earned"]))

        wider = self._finance(date(2026, 11, 1), date(2026, 11, 15))
        self.assertEqual(wider["earned"]["usd"], "150.00")
        self.assertEqual(wider["earned"]["php"], "1360.00")
        self.assertEqual(wider["manual_count"], 2)

        october = self._finance(date(2026, 10, 1), date(2026, 10, 31))
        self.assertEqual(october["earned"]["usd"], "999.00")
        self.assertEqual(october["earned"]["php"], "0.00")
        self.assertEqual(october["manual_count"], 1)
        self.assertEqual(october["invoices_count"], 0)
        self.assertEqual(october["net"]["usd"], "999.00")

        empty = self._finance(date(2026, 1, 1), date(2026, 1, 31))
        self.assertEqual(empty["earned"]["usd"], "0.00")
        self.assertEqual(empty["earned"]["php"], "0.00")
        self.assertEqual(empty["by_client"], [])
        self.assertEqual(empty["manual_earnings"], [])

    def test_remove_and_edit_update_the_range_total(self):
        created = self._add(self.admin, self.past, "40.00", "USD", date(2026, 11, 2))
        earning_id = created.json()["id"]
        edited = self.client.patch(
            f"/manual-earnings/{earning_id}",
            headers=_auth(self.admin),
            json={"amount": "75.50", "currency": "PHP", "client_id": str(self.current.id), "description": "Corrected"},
        )
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["currency"], "PHP")
        self.assertEqual(edited.json()["amount"], "75.50")
        self.assertTrue(edited.json()["client_active"])
        seen = self._finance(date(2026, 11, 1), date(2026, 11, 30))
        self.assertEqual(seen["earned"]["php"], "75.50")
        self.assertEqual(seen["earned"]["usd"], "0.00")
        self.assertEqual(seen["by_client"][0]["client_name"], self.current.name)

        removed = self.client.delete(f"/manual-earnings/{earning_id}", headers=_auth(self.admin))
        self.assertEqual(removed.status_code, 204)
        self.earning_ids.remove(earning_id)
        after = self._finance(date(2026, 11, 1), date(2026, 11, 30))
        self.assertEqual(after["earned"]["php"], "0.00")
        self.assertEqual(after["manual_count"], 0)

    def test_rejects_bad_money_and_missing_clients(self):
        missing = self._add(self.admin, Client(id=uuid4(), name="x", billing_type=BillingType.hourly), "10", "USD", date(2026, 11, 2))
        self.assertEqual(missing.status_code, 404)
        zero = self._add(self.admin, self.current, "0", "USD", date(2026, 11, 2))
        self.assertEqual(zero.status_code, 400)
        negative = self._add(self.admin, self.current, "-5", "PHP", date(2026, 11, 2))
        self.assertEqual(negative.status_code, 400)
        other = self._add(self.admin, self.current, "5", "EUR", date(2026, 11, 2))
        self.assertEqual(other.status_code, 400)

    def test_project_manager_and_va_cannot_see_earnings(self):
        self._add(self.admin, self.current, "25.00", "USD", date(2026, 11, 2))
        for user, va in ((self.pm, None), (self.va_user, self.va)):
            headers = _auth(user, va)
            for method, path in (
                ("get", "/manual-earnings"),
                ("get", "/dashboard/owner-finance"),
                ("post", "/manual-earnings"),
            ):
                kwargs = {"headers": headers}
                if method == "post":
                    kwargs["json"] = {
                        "client_id": str(self.current.id),
                        "earned_date": "2026-11-02",
                        "amount": "10",
                        "currency": "USD",
                    }
                res = getattr(self.client, method)(path, **kwargs)
                self.assertEqual(res.status_code, 403, f"{user.role} {method} {path} {res.text}")
            res = self.client.delete(f"/manual-earnings/{self.earning_ids[0]}", headers=headers)
            self.assertEqual(res.status_code, 403, res.text)

    def test_picker_lists_past_clients_and_keeps_the_rate_field(self):
        panel = Path(__file__).resolve().parents[2].joinpath(
            "frontend/src/components/dashboard/OwnerFinancePanel.tsx"
        ).read_text()
        self.assertIn("/clients?include_archived=true", panel)
        self.assertNotIn("active_only", panel)
        self.assertIn('label="Current clients"', panel)
        self.assertIn('label="Past clients"', panel)
        self.assertIn("USD to PHP Rate", panel)
        self.assertIn('aria-label="From"', panel)
        self.assertIn('aria-label="To"', panel)
        self.assertIn("This month", panel)
        self.assertNotIn("\u2014", panel)
        self.assertNotIn("\u2013", panel)
