"""Item 71: pull approved logs onto a manual flat line and drop them from hourly."""
import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.database import SessionLocal
from app.models import Client, Invoice, PaymentMethod, Project, VA, WorkLog, WorkLogStatus
from app.routers.invoices import _generate_flexible, list_period_logs
from app.schemas import InvoiceDraftLine, InvoiceGenerateRequest


class PullLogsInvoiceTests(unittest.TestCase):
    def test_pulled_logs_leave_hourly_and_stay_unchanged(self):
        db = SessionLocal()
        try:
            va = db.query(VA).first()
            self.assertIsNotNone(va)
            client = Client(
                name=f"Item71 {uuid4().hex[:8]}",
                billing_type="hourly",
                default_rate=Decimal("15"),
                is_active=True,
            )
            db.add(client)
            db.flush()
            project = Project(client_id=client.id, name="Social", color="#ec4899")
            db.add(project)
            db.flush()
            rows = []
            for day, hours, name, note in (
                (18, "2", "Calendar captions", "Draft November captions"),
                (20, "4", "Story replies", "Reply to stories"),
                (22, "1", "IG package shoot", "One-off shoot"),
            ):
                log = WorkLog(
                    work_date=date(2026, 11, day),
                    va_id=va.id,
                    client_id=client.id,
                    project_id=project.id,
                    task_name=name,
                    description_plain=note,
                    hours=Decimal(hours),
                    va_rate=Decimal("15"),
                    va_pay=Decimal(hours) * Decimal("15"),
                    status=WorkLogStatus.approved,
                )
                db.add(log)
                rows.append(log)
            submitted = WorkLog(
                work_date=date(2026, 11, 19),
                va_id=va.id,
                client_id=client.id,
                project_id=project.id,
                task_name="Still submitted",
                description_plain="Not approved",
                hours=Decimal("9"),
                va_rate=Decimal("15"),
                va_pay=Decimal("135"),
                status=WorkLogStatus.submitted,
            )
            db.add(submitted)
            db.commit()
            before = {
                log.id: (log.hours, log.description_plain, log.status, log.va_pay, log.invoice_id)
                for log in rows
            }
            listed = list_period_logs(client.id, 2026, 11, 30, None, db)
            listed_ids = {row.id for row in listed}
            self.assertEqual(listed_ids, {log.id for log in rows})
            self.assertNotIn(submitted.id, listed_ids)

            pulled = rows[2]
            body = InvoiceGenerateRequest(
                client_id=client.id,
                year=2026,
                month=11,
                cutoff=30,
                billing_type="hourly",
                rate=Decimal("15"),
                payment_method=PaymentMethod.wise,
                lines=[
                    InvoiceDraftLine(
                        billing_type="manual",
                        description="IG package",
                        hours=Decimal("1"),
                        rate=Decimal("15"),
                        amount=Decimal("75"),
                        pulled_log_ids=[pulled.id],
                    )
                ],
            )
            invoice = _generate_flexible(
                db, body, client, date(2026, 11, 16), date(2026, 11, 30), "Nov 16 – Nov 30, 2026",
            )
            db.commit()
            for log in rows:
                db.refresh(log)
                self.assertEqual(
                    (log.hours, log.description_plain, log.status, log.va_pay, log.invoice_id),
                    before[log.id],
                )
            self.assertEqual(len(invoice.line_items), 2)
            hourly = next(row for row in invoice.line_items if row.line_kind == "hourly")
            manual = next(row for row in invoice.line_items if row.line_kind == "manual")
            self.assertEqual(hourly.hours, Decimal("6.00"))
            self.assertEqual(hourly.amount, Decimal("90.00"))
            self.assertNotIn("IG package shoot", hourly.description)
            self.assertNotIn("–", hourly.description)
            self.assertNotIn("—", hourly.description)
            self.assertEqual(manual.line_kind, "manual")
            self.assertEqual(manual.amount, Decimal("75.00"))
            self.assertEqual(manual.hours or Decimal("0"), Decimal("0"))
            self.assertEqual(invoice.total_hours, Decimal("6.00"))
            self.assertEqual(invoice.amount, Decimal("165.00"))

            preset = InvoiceGenerateRequest(
                client_id=client.id,
                year=2026,
                month=11,
                cutoff=30,
                billing_type="hourly",
                rate=Decimal("15"),
                payment_method=PaymentMethod.wise,
                lines=[
                    InvoiceDraftLine(
                        project_id=project.id,
                        billing_type="actual_hours",
                        description="Social - 7 hrs x $15.00/hr = $105.00",
                        hours=Decimal("7"),
                        rate=Decimal("15"),
                        amount=Decimal("105"),
                    ),
                    InvoiceDraftLine(
                        billing_type="manual",
                        description="IG package",
                        amount=Decimal("75"),
                        pulled_log_ids=[pulled.id],
                    ),
                ],
            )
            mixed = _generate_flexible(
                db, preset, client, date(2026, 11, 16), date(2026, 11, 30), "Nov 16 – Nov 30, 2026",
            )
            kinds = [row.line_kind for row in mixed.line_items]
            self.assertEqual(kinds.count("hourly"), 0)
            actual = next(row for row in mixed.line_items if row.line_kind == "actual_hours")
            self.assertEqual(actual.hours, Decimal("6.00"))
            self.assertEqual(actual.amount, Decimal("90.00"))
            self.assertNotIn("IG package shoot", actual.description)
            self.assertEqual(mixed.amount, Decimal("165.00"))
            db.refresh(pulled)
            self.assertIsNone(pulled.invoice_id)
            self.assertEqual(pulled.hours, Decimal("1"))
        finally:
            db.rollback()
            db.query(Invoice).filter(Invoice.client_id == client.id).delete(synchronize_session=False)
            db.query(WorkLog).filter(WorkLog.client_id == client.id).delete(synchronize_session=False)
            db.query(Project).filter(Project.client_id == client.id).delete(synchronize_session=False)
            db.query(Client).filter(Client.id == client.id).delete(synchronize_session=False)
            db.commit()
            db.close()


if __name__ == "__main__":
    unittest.main()
