"""Flexible invoices, manual lines, presets, and one-off clients."""
import inspect
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi.routing import APIRoute

from app.main import app
from app.services.client_billing import (
    approved_hours_for_project,
    blank_manual_line,
    build_setup_drafts,
    clean_invoice_text,
    description_lines,
    hour_description,
    normalize_invoice_line,
    resolve_amount,
)


def _line(**kwargs):
    return SimpleNamespace(**kwargs)


class ManualLineTests(unittest.TestCase):
    def test_a_new_manual_line_starts_blank(self):
        line = blank_manual_line()
        self.assertEqual(line["description"], "")
        self.assertEqual(line["billing_type"], "manual")
        self.assertIsNone(line["hours"])
        self.assertIsNone(line["rate"])
        self.assertIsNone(line["amount"])

    def test_hours_times_rate_fills_the_amount(self):
        self.assertEqual(resolve_amount("hourly", Decimal("5.5"), Decimal("10"), None), Decimal("55.00"))
        self.assertEqual(resolve_amount("manual", "2", "12.50", "1"), Decimal("25.00"))

    def test_package_and_flat_use_the_typed_amount(self):
        self.assertEqual(resolve_amount("package", Decimal("9"), Decimal("9"), Decimal("400")), Decimal("400.00"))
        flat = normalize_invoice_line(
            _line(billing_type="flat_fee", project_id=uuid4(), description="", hours=None, rate=None, amount=Decimal("250")),
            "Instagram Engagement",
        )
        self.assertEqual(flat["description"], "Instagram Engagement")
        self.assertEqual(flat["amount"], Decimal("250.00"))
        self.assertEqual(flat["hours"], Decimal("0.00"))

    def test_formula_uses_a_plain_hyphen(self):
        text = hour_description("Instagram Engagement", Decimal("5.5"), Decimal("10"))
        self.assertEqual(text, "Instagram Engagement - 5.5 hrs x $10.00/hr = $55.00")
        self.assertNotIn("\u2014", text)
        self.assertNotIn("\u2013", text)

    def test_manual_text_keeps_line_breaks(self):
        raw = _line(billing_type="manual", project_id=None, description="Rush fee\nSecond line \u2014 still here", hours=None, rate=None, amount=Decimal("40"))
        saved = normalize_invoice_line(raw, "")
        self.assertEqual(saved["description"], "Rush fee\nSecond line - still here")
        self.assertEqual(description_lines(saved["description"]), ["Rush fee", "Second line - still here"])
        self.assertEqual(clean_invoice_text("A \u2014 B\nC"), "A - B\nC")


class ProjectAndPresetTests(unittest.TestCase):
    def test_actual_hours_count_only_the_line_project(self):
        project = uuid4()
        other = uuid4()
        logs = [
            _line(status="approved", project_id=project, hours=Decimal("1.25")),
            _line(status="approved", project_id=other, hours=Decimal("9")),
            _line(status="submitted", project_id=project, hours=Decimal("4")),
            _line(status="invoiced", project_id=project, hours=Decimal("3")),
        ]
        self.assertEqual(approved_hours_for_project(logs, project), Decimal("1.25"))

    def test_mixed_lines_and_an_extra_do_not_change_the_setup(self):
        project = uuid4()
        preset = _line(
            id=uuid4(), billing_type="entered_hours", project_id=project,
            project=_line(name="Instagram Engagement"), default_hours=Decimal("5.5"),
            default_rate=None, default_amount=None, description=None,
        )
        drafts = build_setup_drafts([preset], [], Decimal("10"))
        self.assertEqual(len(drafts), 1)
        drafts[0]["description"] = "Changed on this invoice only"
        again = build_setup_drafts([preset], [], Decimal("10"))
        self.assertIn("5.5 hrs", again[0]["description"])
        self.assertNotIn("Changed", again[0]["description"])
        extra = normalize_invoice_line(
            _line(billing_type="extra", project_id=None, description="Rush fee", hours=None, rate=None, amount=Decimal("25")),
            "",
        )
        self.assertEqual(extra["billing_type"], "extra")
        self.assertTrue(all(row["billing_type"] != "extra" for row in again))

    def test_several_manual_lines_stay_independent(self):
        first = normalize_invoice_line(
            _line(billing_type="hourly", description="Design\nreview", hours=Decimal("2"), rate=Decimal("15"), amount=None, project_id=None),
            "",
        )
        second = normalize_invoice_line(
            _line(billing_type="package", description="Monthly package", hours=None, rate=None, amount=Decimal("800"), project_id=None),
            "",
        )
        self.assertEqual(first["amount"], Decimal("30.00"))
        self.assertEqual(second["amount"], Decimal("800.00"))
        self.assertIn("\n", first["description"])


class OneOffTests(unittest.TestCase):
    def test_one_off_rejects_project_lines(self):
        with self.assertRaises(ValueError):
            normalize_invoice_line(
                _line(billing_type="actual_hours", project_id=uuid4(), description="", hours=1, rate=10, amount=10),
                "Project",
                one_off=True,
            )

    def test_invoice_routes_are_admin_only(self):
        protected = []
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            if not route.path.startswith("/invoices"):
                continue
            names = {getattr(dep.call, "__name__", "") for dep in route.dependant.dependencies if dep.call}
            self.assertIn("require_admin", names, route.path)
            protected.append(route.path)
        self.assertIn("/invoices/clients/{client_id}/billing-lines", protected)
        self.assertIn("/invoices/generate", protected)
        self.assertIn("/invoices/{invoice_id}/send", protected)
        source = inspect.getsource(__import__("app.routers.invoices", fromlist=["generate_invoice"]).generate_invoice)
        self.assertIn("one_off_name", source)
        self.assertIn("must not create a client", source)


class LogSafetyTests(unittest.TestCase):
    def test_flexible_generate_does_not_assign_log_status(self):
        from app.routers import invoices

        source = inspect.getsource(invoices._generate_flexible)
        self.assertNotIn("WorkLogStatus.invoiced", source)
        self.assertNotIn("log.invoice_id", source)
        self.assertNotIn("log.status", source)


class DatabaseInvoiceTests(unittest.TestCase):
    def test_one_off_does_not_create_a_client_and_logs_stay_approved(self):
        from app.database import SessionLocal
        from app.models import Client, Invoice, PaymentMethod, Project, VA, WorkLog, WorkLogStatus
        from app.routers.invoices import _generate_flexible
        from app.schemas import InvoiceDraftLine, InvoiceGenerateRequest

        db = SessionLocal()
        try:
            before = db.query(Client).count()
            va = db.query(VA).first()
            self.assertIsNotNone(va)
            client = Client(name=f"Item70 {uuid4().hex[:8]}", billing_type="hourly", default_rate=Decimal("10"), is_active=True)
            db.add(client)
            db.flush()
            project = Project(client_id=client.id, name="Instagram Engagement", color="#ec4899")
            db.add(project)
            db.flush()
            log = WorkLog(
                work_date=date(2026, 11, 3),
                va_id=va.id,
                client_id=client.id,
                project_id=project.id,
                description_plain="IG",
                hours=Decimal("0.42"),
                va_rate=Decimal("10"),
                va_pay=Decimal("4.20"),
                status=WorkLogStatus.approved,
            )
            db.add(log)
            db.commit()
            body = InvoiceGenerateRequest(
                client_id=client.id,
                year=2026,
                month=11,
                cutoff=15,
                payment_method=PaymentMethod.wise,
                lines=[
                    InvoiceDraftLine(project_id=project.id, billing_type="actual_hours", description="", hours=Decimal("0.42"), rate=Decimal("10"), amount=Decimal("4.20")),
                    InvoiceDraftLine(billing_type="extra", description="Rush fee", amount=Decimal("15")),
                ],
            )
            invoice = _generate_flexible(db, body, client, date(2026, 11, 1), date(2026, 11, 15), "Nov 1 - Nov 15, 2026")
            db.refresh(log)
            self.assertEqual(log.status, WorkLogStatus.approved)
            self.assertIsNone(log.invoice_id)
            self.assertEqual(len(invoice.line_items), 2)
            one = InvoiceGenerateRequest(
                year=2026,
                month=11,
                cutoff=15,
                payment_method=PaymentMethod.wise,
                one_off_name="Pop-up Studio",
                one_off_email="popup@example.com",
                one_off_business="Pop-up Studio LLC",
                one_off_address="12 Sample Street",
                currency="USD",
                lines=[
                    InvoiceDraftLine(billing_type="manual", description="Cover design\nSecond line", hours=Decimal("2"), rate=Decimal("20"), amount=None),
                    InvoiceDraftLine(billing_type="extra", description="Rush fee", amount=Decimal("15")),
                ],
            )
            one_off = _generate_flexible(db, one, None, date(2026, 11, 1), date(2026, 11, 15), "Nov 1 - Nov 15, 2026")
            self.assertIsNone(one_off.client_id)
            self.assertEqual(one_off.one_off_name, "Pop-up Studio")
            self.assertEqual(db.query(Client).count(), before + 1)
            self.assertIn("\n", one_off.line_items[0].description)
            db.delete(one_off)
            saved = db.query(Invoice).filter(Invoice.client_id == client.id).all()
            for row in saved:
                db.delete(row)
            db.delete(log)
            db.delete(project)
            db.delete(client)
            db.commit()
        finally:
            db.rollback()
            db.close()
