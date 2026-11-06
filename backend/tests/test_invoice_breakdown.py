"""Client invoice breakdown: amounts, pulled hours, and the PDF payload."""
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.database import SessionLocal
from app.models import Client, Currency, Invoice, PaymentMethod, Project, User, UserRole, VA, WorkLog, WorkLogStatus
from app.routers.invoices import _generate_flexible, generate_invoice
from app.schemas import InvoiceDraftLine, InvoiceGenerateRequest
from app.services.invoice_breakdown import flat_group, group_hourly_logs, walk_strings


def _va(db):
    va = db.query(VA).first()
    if va:
        return va
    user = User(
        email=f"va-{uuid4().hex[:8]}@example.com",
        password_hash="x",
        role=UserRole.va,
        display_name="Tester",
    )
    db.add(user)
    db.flush()
    va = VA(user_id=user.id, name="Tester", currency=Currency.USD)
    db.add(va)
    db.flush()
    return va


def _no_dash(value):
    text = "\n".join(walk_strings(value))
    return "\u2014" not in text and "\u2013" not in text and "\u2012" not in text


class BreakdownMathTests(unittest.TestCase):
    def test_hourly_rows_sum_to_the_line_and_keep_a_plain_hyphen(self):
        logs = [
            SimpleNamespace(id=1, work_date=date(2026, 10, 19), task_name="Content Creation", description_plain="Draft \u2014 first pass.", hours=Decimal("0.67")),
            SimpleNamespace(id=2, work_date=date(2026, 10, 22), task_name="Content Creation", description_plain="Final artwork.", hours=Decimal("2.00")),
            SimpleNamespace(id=3, work_date=date(2026, 10, 20), task_name="Calendar & Scheduling", description_plain="Plan the year.", hours=Decimal("1.08")),
        ]
        groups = group_hourly_logs(logs, Decimal("10"), Decimal("37.50"))
        self.assertEqual(sum(Decimal(group["amount"]) for group in groups), Decimal("37.50"))
        content = next(group for group in groups if group["name"] == "Content Creation")
        self.assertEqual(Decimal(content["hours"]), Decimal("2.67"))
        self.assertEqual(Decimal(content["amount"]), Decimal("26.70"))
        self.assertEqual(content["tasks"][0]["date_label"], "Oct 19, 2026")
        self.assertIn("Draft - first pass.", content["tasks"][0]["description"])
        self.assertNotIn("\u2014", content["tasks"][0]["description"])
        self.assertEqual(content["tasks"][0]["rate"], "10.00")
        self.assertEqual(sum(Decimal(task["amount"]) for task in content["tasks"]), Decimal(content["amount"]))

    def test_two_tasks_on_one_flat_fee_are_not_charged_twice(self):
        logs = [
            SimpleNamespace(id=1, work_date=date(2026, 11, 5), task_name="Instagram Engagement", description_plain="Stories.", hours=Decimal("0.42")),
            SimpleNamespace(id=2, work_date=date(2026, 11, 6), task_name="Instagram Engagement", description_plain="Comments.", hours=Decimal("0.20")),
        ]
        group = flat_group("Instagram package", Decimal("75"), logs)
        self.assertEqual(group["amount"], "75.00")
        self.assertEqual(group["hours"], "0.62")
        self.assertTrue(group["reference_hours"])
        self.assertIsNone(group["rate"])
        self.assertTrue(all(task["amount"] is None for task in group["tasks"]))
        self.assertTrue(all(task["reference_only"] for task in group["tasks"]))


class InvoiceScenarioTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.va = _va(self.db)
        self.client = Client(
            name=f"Breakdown {uuid4().hex[:8]}",
            billing_type="hourly",
            default_rate=Decimal("10"),
            is_active=True,
        )
        self.db.add(self.client)
        self.db.flush()
        self.project = Project(client_id=self.client.id, name="Social", color="#ec4899")
        self.db.add(self.project)
        self.db.flush()
        self.logs = {}
        specs = (
            ("planning", date(2026, 11, 3), "Content Planning", "Researched current real estate trends \u2014 and wrote the November plan.", "3.32", "15"),
            ("engage", date(2026, 11, 5), "Instagram Engagement", "Engaging with posts and stories for the brand.", "0.42", "8"),
        )
        for key, work_date, name, note, hours, pay in specs:
            log = WorkLog(
                work_date=work_date,
                va_id=self.va.id,
                client_id=self.client.id,
                project_id=self.project.id,
                task_name=name,
                description_plain=note,
                hours=Decimal(hours),
                va_rate=Decimal("5"),
                va_pay=Decimal(pay),
                status=WorkLogStatus.approved,
            )
            self.db.add(log)
            self.logs[key] = log
        self.db.commit()
        self.before = {
            log.id: (log.hours, log.va_pay, log.status, log.invoice_id, log.description_plain)
            for log in self.logs.values()
        }

    def tearDown(self):
        self.db.rollback()
        self.db.query(WorkLog).filter(WorkLog.client_id == self.client.id).delete(synchronize_session=False)
        self.db.query(Invoice).filter(Invoice.client_id == self.client.id).delete(synchronize_session=False)
        self.db.query(Project).filter(Project.client_id == self.client.id).delete(synchronize_session=False)
        self.db.query(Client).filter(Client.id == self.client.id).delete(synchronize_session=False)
        self.db.commit()
        self.db.close()

    def _assert_logs_unchanged(self):
        for log in self.logs.values():
            self.db.refresh(log)
            self.assertEqual(
                (log.hours, log.va_pay, log.status, log.invoice_id, log.description_plain),
                self.before[log.id],
            )

    def _groups(self, invoice):
        groups = (invoice.task_breakdown or {}).get("groups") or []
        self.assertTrue(_no_dash(invoice.task_breakdown))
        for line in invoice.line_items:
            self.assertNotIn("\u2014", line.description or "")
            self.assertNotIn("\u2013", line.description or "")
        self.assertEqual(sum((Decimal(group["amount"]) for group in groups), Decimal("0")), invoice.amount)
        return groups

    def test_hourly_only_uses_unpulled_tasks_times_rate(self):
        body = InvoiceGenerateRequest(
            client_id=self.client.id,
            year=2026,
            month=11,
            cutoff=15,
            billing_type="hourly",
            rate=Decimal("10"),
            payment_method=PaymentMethod.paypal,
            service_description="Social Media VA",
            include_task_breakdown=False,
            lines=None,
        )
        invoice = generate_invoice(body, None, self.db)
        self.assertFalse(invoice.include_task_breakdown)
        self.assertEqual(invoice.task_breakdown["service_title"], "Social Media VA")
        self.assertEqual(invoice.amount, Decimal("37.40"))
        groups = self._groups(invoice)
        planning = next(group for group in groups if group["name"] == "Content Planning")
        engage = next(group for group in groups if group["name"] == "Instagram Engagement")
        self.assertEqual(Decimal(planning["hours"]), Decimal("3.32"))
        self.assertEqual(Decimal(planning["rate"]), Decimal("10.00"))
        self.assertEqual(Decimal(planning["amount"]), Decimal("33.20"))
        self.assertIn("Researched current real estate trends - and wrote the November plan.", planning["detail"])
        self.assertEqual(Decimal(engage["amount"]), Decimal("4.20"))
        self.assertIn("Social Media VA", invoice.line_items[0].description)
        for log in self.logs.values():
            self.db.refresh(log)
            self.assertEqual(log.va_pay, self.before[log.id][1])
            self.assertEqual(log.hours, self.before[log.id][0])

    def test_package_only_charges_the_flat_amount(self):
        self.db.delete(self.logs["planning"])
        self.db.commit()
        del self.before[self.logs["planning"].id]
        del self.logs["planning"]
        body = InvoiceGenerateRequest(
            client_id=self.client.id,
            year=2026,
            month=11,
            cutoff=15,
            billing_type="hourly",
            rate=Decimal("10"),
            payment_method=PaymentMethod.wise,
            service_description="Social Media VA",
            lines=[
                InvoiceDraftLine(
                    billing_type="package",
                    description="Instagram package",
                    amount=Decimal("75"),
                    pulled_log_ids=[self.logs["engage"].id],
                )
            ],
        )
        invoice = _generate_flexible(
            self.db, body, self.client, date(2026, 11, 1), date(2026, 11, 15), "Nov 1 - Nov 15, 2026",
        )
        self._assert_logs_unchanged()
        self.assertEqual(invoice.amount, Decimal("75.00"))
        self.assertEqual(invoice.total_hours, Decimal("0.00"))
        package = next(row for row in invoice.line_items if row.line_kind == "package")
        self.assertEqual(package.amount, Decimal("75.00"))
        self.assertEqual(package.hours or Decimal("0"), Decimal("0"))
        self.assertIn("Instagram package", package.description)
        self.assertIn("Instagram Engagement", package.description)
        self.assertIn("Engaging with posts and stories", package.description)
        groups = self._groups(invoice)
        self.assertEqual(len(groups), 1)
        self.assertTrue(groups[0]["reference_hours"])
        self.assertEqual(groups[0]["amount"], "75.00")
        self.assertEqual(groups[0]["hours"], "0.42")
        self.assertIsNone(groups[0]["rate"])
        self.assertNotEqual(groups[0]["amount"], "4.20")
        self.assertEqual(invoice.task_breakdown["service_title"], "Social Media VA")

    def test_mixed_hourly_package_and_extra(self):
        body = InvoiceGenerateRequest(
            client_id=self.client.id,
            year=2026,
            month=11,
            cutoff=15,
            billing_type="hourly",
            rate=Decimal("10"),
            payment_method=PaymentMethod.wise,
            service_description="Social Media VA",
            include_task_breakdown=True,
            lines=[
                InvoiceDraftLine(
                    billing_type="package",
                    description="Instagram package",
                    amount=Decimal("75"),
                    pulled_log_ids=[self.logs["engage"].id],
                ),
                InvoiceDraftLine(billing_type="extra", description="Rush fee", amount=Decimal("12.50")),
            ],
        )
        invoice = _generate_flexible(
            self.db, body, self.client, date(2026, 11, 1), date(2026, 11, 15), "Nov 1 - Nov 15, 2026",
        )
        self._assert_logs_unchanged()
        self.assertTrue(invoice.include_task_breakdown)
        self.assertEqual(invoice.amount, Decimal("120.70"))
        self.assertEqual(invoice.total_hours, Decimal("3.32"))
        hourly = next(row for row in invoice.line_items if row.line_kind == "hourly")
        package = next(row for row in invoice.line_items if row.line_kind == "package")
        extra = next(row for row in invoice.line_items if row.line_kind == "extra")
        self.assertEqual(hourly.hours, Decimal("3.32"))
        self.assertEqual(hourly.amount, Decimal("33.20"))
        self.assertEqual(hourly.rate, Decimal("10.00"))
        self.assertIn("Content Planning", hourly.description)
        self.assertIn("Researched current real estate trends - and wrote the November plan.", hourly.description)
        self.assertNotIn("Instagram Engagement", hourly.description)
        self.assertEqual(package.amount, Decimal("75.00"))
        self.assertEqual(package.hours or Decimal("0"), Decimal("0.00"))
        self.assertEqual(extra.amount, Decimal("12.50"))
        groups = self._groups(invoice)
        names = {group["name"] for group in groups}
        self.assertIn("Content Planning", names)
        self.assertIn("Instagram Engagement", names)
        self.assertIn("Rush fee", names)
        planning = next(group for group in groups if group["name"] == "Content Planning")
        pulled = next(group for group in groups if group["name"] == "Instagram Engagement")
        self.assertEqual(planning["amount"], "33.20")
        self.assertEqual(planning["tasks"][0]["amount"], "33.20")
        self.assertEqual(planning["tasks"][0]["rate"], "10.00")
        self.assertEqual(planning["tasks"][0]["hours"], "3.32")
        self.assertIn("November plan", planning["tasks"][0]["description"])
        self.assertEqual(pulled["amount"], "75.00")
        self.assertTrue(pulled["reference_hours"])
        self.assertTrue(pulled["tasks"][0]["reference_only"])
        self.assertEqual(pulled["tasks"][0]["amount"], "75.00")
        self.assertNotEqual(pulled["tasks"][0]["amount"], "4.20")
        self.assertEqual(invoice.task_breakdown["service_title"], "Social Media VA")
        self.assertIn("Social Media VA", hourly.description)

    def test_detailed_off_still_keeps_descriptions(self):
        body = InvoiceGenerateRequest(
            client_id=self.client.id,
            year=2026,
            month=11,
            cutoff=15,
            billing_type="hourly",
            rate=Decimal("10"),
            payment_method=PaymentMethod.wise,
            service_description="Social Media VA",
            include_task_breakdown=False,
            lines=[
                InvoiceDraftLine(
                    billing_type="package",
                    description="",
                    amount=Decimal("75"),
                    pulled_log_ids=[self.logs["engage"].id],
                )
            ],
        )
        invoice = _generate_flexible(
            self.db, body, self.client, date(2026, 11, 1), date(2026, 11, 15), "Nov 1 - Nov 15, 2026",
        )
        self.assertFalse(invoice.include_task_breakdown)
        groups = self._groups(invoice)
        planning = next(group for group in groups if group["name"] == "Content Planning")
        pulled = next(group for group in groups if group["name"] == "Instagram Engagement")
        self.assertIn("November plan", planning["detail"])
        self.assertIn("Engaging with posts", pulled["detail"])
        self.assertEqual(invoice.amount, Decimal("108.20"))

    def test_blank_rate_and_blank_flat_still_show_the_work(self):
        body = InvoiceGenerateRequest(
            client_id=self.client.id,
            year=2026,
            month=11,
            cutoff=15,
            billing_type="hourly",
            rate=None,
            payment_method=PaymentMethod.wise,
            service_description="Social Media VA",
            include_task_breakdown=False,
            lines=[
                InvoiceDraftLine(
                    billing_type="package",
                    description="",
                    amount=None,
                    pulled_log_ids=[self.logs["engage"].id],
                )
            ],
        )
        invoice = _generate_flexible(
            self.db, body, self.client, date(2026, 11, 1), date(2026, 11, 15), "Nov 1 - Nov 15, 2026",
        )
        self._assert_logs_unchanged()
        self.assertEqual(invoice.amount, Decimal("0.00"))
        self.assertEqual(invoice.total_hours, Decimal("3.32"))
        hourly = next(row for row in invoice.line_items if row.line_kind == "hourly")
        package = next(row for row in invoice.line_items if row.line_kind == "package")
        self.assertEqual(hourly.rate, Decimal("0.00"))
        self.assertEqual(hourly.amount, Decimal("0.00"))
        self.assertIn("Content Planning", hourly.description)
        self.assertIn("November plan", hourly.description)
        self.assertEqual(package.amount, Decimal("0.00"))
        self.assertEqual(package.hours or Decimal("0"), Decimal("0"))
        self.assertIn("Instagram Engagement", package.description)
        self.assertIn("Engaging with posts", package.description)
        groups = self._groups(invoice)
        planning = next(group for group in groups if group["name"] == "Content Planning")
        pulled = next(group for group in groups if group["name"] == "Instagram Engagement")
        self.assertEqual(planning["rate"], "0.00")
        self.assertEqual(planning["amount"], "0.00")
        self.assertIn("November plan", planning["detail"])
        self.assertIsNone(pulled["rate"])
        self.assertEqual(pulled["amount"], "0.00")
        self.assertIn("Engaging with posts", pulled["detail"])
        self.assertNotEqual(pulled["amount"], "4.20")
        self.assertEqual(invoice.task_breakdown["service_title"], "Social Media VA")


class HttpGenerateTests(unittest.TestCase):
    def test_generate_endpoint_returns_the_breakdown(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as client:
            login = client.post("/auth/login", json={"email": "janelaurine@gmail.com", "password": "admin123"})
            self.assertEqual(login.status_code, 200, login.text)
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            db = SessionLocal()
            try:
                va = _va(db)
                row = Client(name=f"Http {uuid4().hex[:8]}", billing_type="hourly", default_rate=Decimal("10"), is_active=True)
                db.add(row)
                db.flush()
                project = Project(client_id=row.id, name="Social", color="#ec4899")
                db.add(project)
                db.flush()
                planning = WorkLog(
                    work_date=date(2026, 11, 3), va_id=va.id, client_id=row.id, project_id=project.id,
                    task_name="Content Planning", description_plain="November plan for the brand.",
                    hours=Decimal("3.32"), va_rate=Decimal("5"), va_pay=Decimal("16.60"), status=WorkLogStatus.approved,
                )
                engage = WorkLog(
                    work_date=date(2026, 11, 5), va_id=va.id, client_id=row.id, project_id=project.id,
                    task_name="Instagram Engagement", description_plain="Engaging with posts and stories.",
                    hours=Decimal("0.42"), va_rate=Decimal("5"), va_pay=Decimal("2.10"), status=WorkLogStatus.approved,
                )
                db.add(planning)
                db.add(engage)
                db.commit()
                pay_before = (planning.va_pay, engage.va_pay, planning.status, engage.status)
                response = client.post("/invoices/generate", headers=headers, json={
                    "client_id": str(row.id),
                    "year": 2026,
                    "month": 11,
                    "cutoff": 15,
                    "billing_type": "hourly",
                    "rate": 10,
                    "payment_method": "wise",
                    "payment_terms_days": 7,
                    "service_description": "Social Media VA",
                    "include_task_breakdown": True,
                    "lines": [
                        {
                            "billing_type": "package",
                            "description": "Instagram package",
                            "amount": 75,
                            "pulled_log_ids": [str(engage.id)],
                        },
                        {"billing_type": "extra", "description": "Rush fee", "amount": 12.5},
                    ],
                })
                self.assertEqual(response.status_code, 201, response.text)
                body = response.json()
                self.assertEqual(Decimal(body["amount"]), Decimal("120.70"))
                self.assertEqual(Decimal(body["total_hours"]), Decimal("3.32"))
                self.assertTrue(body["include_task_breakdown"])
                self.assertEqual(body["task_breakdown"]["service_title"], "Social Media VA")
                groups = body["task_breakdown"]["groups"]
                self.assertEqual(sum(Decimal(group["amount"]) for group in groups), Decimal("120.70"))
                planning_group = next(group for group in groups if group["name"] == "Content Planning")
                package_group = next(group for group in groups if group["name"] == "Instagram Engagement")
                self.assertEqual(planning_group["amount"], "33.20")
                self.assertEqual(planning_group["tasks"][0]["description"], "November plan for the brand.")
                self.assertEqual(package_group["amount"], "75.00")
                self.assertTrue(package_group["reference_hours"])
                self.assertNotEqual(package_group["amount"], "4.20")
                self.assertTrue(_no_dash(body))
                db.refresh(planning)
                db.refresh(engage)
                self.assertEqual((planning.va_pay, engage.va_pay, planning.status, engage.status), pay_before)
                self.assertIsNone(planning.invoice_id)
                self.assertIsNone(engage.invoice_id)
            finally:
                db.rollback()
                if "row" in locals():
                    db.query(WorkLog).filter(WorkLog.client_id == row.id).delete(synchronize_session=False)
                    db.query(Invoice).filter(Invoice.client_id == row.id).delete(synchronize_session=False)
                    db.query(Project).filter(Project.client_id == row.id).delete(synchronize_session=False)
                    db.query(Client).filter(Client.id == row.id).delete(synchronize_session=False)
                    db.commit()
                db.close()


if __name__ == "__main__":
    unittest.main()
