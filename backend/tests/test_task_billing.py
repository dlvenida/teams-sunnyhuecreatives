"""Task billing: hourly by default, package hours kept off the hourly invoice."""
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException

from app.services.client_billing import compose_invoice, format_duration


def _task(title, mode="hourly", line_id=None, project_id=None):
    return SimpleNamespace(
        id=uuid4(),
        title=title,
        billing_mode=mode,
        package_line_id=line_id,
        project_id=project_id,
    )


def _log(task, project_id, hours, status="approved"):
    return SimpleNamespace(
        status=status,
        project_id=project_id,
        task_id=None if task is None else task.id,
        hours=Decimal(str(hours)),
    )


def _line(kind, project_id=None, description="", amount=None, line_id=None):
    return SimpleNamespace(
        id=line_id or uuid4(),
        billing_type=kind,
        project_id=project_id,
        project=SimpleNamespace(name="Social Media") if project_id else None,
        description=description,
        default_hours=None,
        default_rate=None,
        default_amount=None if amount is None else Decimal(str(amount)),
    )


def sara_fixture():
    """Sara Montreuil-Althaus: hourly tasks $180, Instagram Engagement package $75, same project."""
    project_id = uuid4()
    package_line = _line("package", description="Instagram Engagement (Package)", amount="75")
    actual = _line("actual_hours", project_id=project_id)
    content = _task("Content Creation", project_id=project_id)
    email = _task("Email Management", project_id=project_id)
    reporting = _task("Reporting", project_id=project_id)
    instagram = _task("Instagram Engagement", mode="package", line_id=package_line.id, project_id=project_id)
    logs = [
        _log(content, project_id, "6.00"),
        _log(email, project_id, "4.00"),
        _log(reporting, project_id, "2.00"),
        _log(instagram, project_id, "0.42"),
        _log(instagram, project_id, "0.42"),
        _log(instagram, project_id, "0.42"),
        _log(instagram, project_id, "0.42"),
        _log(instagram, project_id, "0.40"),
        _log(instagram, project_id, "1.00", status="submitted"),
    ]
    return {
        "project_id": project_id,
        "package_line": package_line,
        "setup": [actual, package_line],
        "tasks": [content, email, reporting, instagram],
        "logs": logs,
        "instagram": instagram,
        "content": content,
    }


class DurationTests(unittest.TestCase):
    def test_minutes_use_hours_and_zero_padded_minutes(self):
        self.assertEqual(format_duration(Decimal("6")), "6h")
        self.assertEqual(format_duration(Decimal("2.08")), "2h 05m")
        self.assertNotIn("\u2014", format_duration(Decimal("2.08")))


class SaraInvoiceTests(unittest.TestCase):
    def test_same_project_package_hours_stay_off_the_default_invoice(self):
        fixture = sara_fixture()
        self.assertEqual(len({task.project_id for task in fixture["tasks"]}), 1)
        invoice = compose_invoice(fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"))
        self.assertTrue(invoice["show_hourly_breakdown"])
        self.assertFalse(invoice["show_package_time"])
        self.assertEqual(invoice["hourly_subtotal"], Decimal("180.00"))
        self.assertEqual(invoice["package_total"], Decimal("75.00"))
        self.assertEqual(invoice["amount"], Decimal("255.00"))
        self.assertEqual(invoice["total_hours"], Decimal("12.00"))
        hourly = [line for line in invoice["lines"] if line["billing_type"] == "hourly_task"]
        package = [line for line in invoice["lines"] if line["billing_type"] == "package"]
        self.assertEqual([line["amount"] for line in hourly], [Decimal("90.00"), Decimal("60.00"), Decimal("30.00")])
        self.assertEqual(
            [line["description"] for line in hourly],
            [
                "Content Creation - 6h x $15.00/hr = $90.00",
                "Email Management - 4h x $15.00/hr = $60.00",
                "Reporting - 2h x $15.00/hr = $30.00",
            ],
        )
        joined = "\n".join(line["description"] for line in hourly)
        self.assertNotIn("Instagram", joined)
        self.assertNotIn("2h 05m", joined)
        self.assertNotIn("0.42", joined)
        self.assertEqual(len(package), 1)
        self.assertEqual(package[0]["description"], "Instagram Engagement (Package)")
        self.assertEqual(package[0]["amount"], Decimal("75.00"))
        self.assertEqual(package[0]["hours"], Decimal("0.00"))
        self.assertNotIn("2h 05m", package[0]["description"])
        ig = next(row for row in invoice["task_reviews"] if row["title"] == "Instagram Engagement")
        self.assertEqual(ig["billing_mode"], "package")
        self.assertFalse(ig["included"])
        self.assertEqual(ig["hours"], Decimal("2.08"))
        self.assertEqual(invoice["package_tasks"][0]["title"], "Instagram Engagement")

    def test_summary_toggle_hides_task_hours_and_keeps_the_total(self):
        fixture = sara_fixture()
        invoice = compose_invoice(
            fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"),
            show_hourly_breakdown=False,
        )
        self.assertEqual(invoice["amount"], Decimal("255.00"))
        self.assertEqual(invoice["total_hours"], Decimal("12.00"))
        summaries = [line for line in invoice["lines"] if line["billing_type"] == "hourly_summary"]
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["description"], "Hourly VA services")
        self.assertEqual(summaries[0]["amount"], Decimal("180.00"))
        self.assertFalse(any(line["billing_type"] == "hourly_task" for line in invoice["lines"]))
        blob = "\n".join(line["description"] for line in invoice["lines"])
        self.assertNotIn("Content Creation", blob)
        self.assertNotIn("2h 05m", blob)
        self.assertIn("Instagram Engagement (Package)", blob)

    def test_package_time_note_does_not_change_the_total(self):
        fixture = sara_fixture()
        invoice = compose_invoice(
            fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"),
            show_package_time=True,
        )
        package = next(line for line in invoice["lines"] if line["billing_type"] == "package")
        self.assertEqual(
            package["description"],
            "Instagram Engagement - Package $75.00 (time spent: 2h 05m, included)",
        )
        self.assertEqual(package["amount"], Decimal("75.00"))
        self.assertEqual(package["hours"], Decimal("0.00"))
        self.assertEqual(invoice["hourly_subtotal"], Decimal("180.00"))
        self.assertEqual(invoice["amount"], Decimal("255.00"))
        self.assertEqual(invoice["total_hours"], Decimal("12.00"))

    def test_both_toggles_keep_sara_at_255(self):
        fixture = sara_fixture()
        invoice = compose_invoice(
            fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"),
            show_hourly_breakdown=False,
            show_package_time=True,
        )
        self.assertEqual(invoice["amount"], Decimal("255.00"))
        self.assertEqual(invoice["hourly_subtotal"], Decimal("180.00"))
        self.assertEqual(invoice["package_total"], Decimal("75.00"))
        blob = "\n".join(line["description"] for line in invoice["lines"])
        self.assertIn("Hourly VA services", blob)
        self.assertIn("time spent: 2h 05m, included", blob)
        self.assertNotIn("Content Creation", blob)
        self.assertEqual(sum(line["amount"] for line in invoice["lines"]), Decimal("255.00"))

    def test_include_or_exclude_is_only_for_this_invoice(self):
        fixture = sara_fixture()
        content = fixture["content"]
        instagram = fixture["instagram"]
        without_reporting = compose_invoice(
            fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"),
            included_task_ids=[content.id, fixture["tasks"][1].id],
        )
        self.assertEqual(without_reporting["hourly_subtotal"], Decimal("150.00"))
        self.assertEqual(without_reporting["amount"], Decimal("225.00"))
        self.assertEqual(content.billing_mode, "hourly")
        self.assertEqual(fixture["package_line"].default_amount, Decimal("75"))
        again = compose_invoice(fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"))
        self.assertEqual(again["hourly_subtotal"], Decimal("180.00"))
        with_ig = compose_invoice(
            fixture["setup"], fixture["logs"], fixture["tasks"], Decimal("15"),
            included_task_ids=[task.id for task in fixture["tasks"]],
        )
        self.assertEqual(with_ig["hourly_subtotal"], Decimal("180.00"))
        self.assertEqual(with_ig["amount"], Decimal("255.00"))
        ig_lines = "\n".join(line["description"] for line in with_ig["lines"] if line["billing_type"] == "hourly_task")
        self.assertNotIn("Instagram", ig_lines)
        self.assertNotIn("2h 05m", ig_lines)
        self.assertEqual(instagram.billing_mode, "package")
        self.assertEqual(fixture["package_line"].default_amount, Decimal("75"))

    def test_several_package_tasks_share_one_line(self):
        project_id = uuid4()
        line = _line("package", description="Monthly Package - Community Management", amount="400")
        hourly = _task("Blog graphics", project_id=project_id)
        first = _task("Instagram Engagement", mode="package", line_id=line.id, project_id=project_id)
        second = _task("Admin inbox", mode="package", line_id=line.id, project_id=project_id)
        third = _task("Admin scheduling", mode="package", line_id=line.id, project_id=project_id)
        logs = [
            _log(hourly, project_id, "2"),
            _log(first, project_id, "1"),
            _log(second, project_id, "0.50"),
            _log(third, project_id, "0.25"),
        ]
        invoice = compose_invoice(
            [_line("actual_hours", project_id=project_id), line],
            logs,
            [hourly, first, second, third],
            Decimal("10"),
            show_package_time=True,
        )
        package_lines = [row for row in invoice["lines"] if row["billing_type"] == "package"]
        self.assertEqual(len(package_lines), 1)
        self.assertEqual(package_lines[0]["amount"], Decimal("400.00"))
        self.assertEqual(package_lines[0]["hours"], Decimal("0.00"))
        self.assertIn("time spent: 1h 45m, included", package_lines[0]["description"])
        self.assertEqual(invoice["hourly_subtotal"], Decimal("20.00"))
        self.assertEqual(invoice["amount"], Decimal("420.00"))
        self.assertEqual(len(invoice["package_tasks"]), 3)
        hourly_text = " ".join(row["description"] for row in invoice["lines"] if row["billing_type"] == "hourly_task")
        self.assertIn("Blog graphics", hourly_text)
        self.assertNotIn("Admin inbox", hourly_text)

    def test_a_package_task_can_be_covered_by_a_flat_fee_without_hourly_hours(self):
        project_id = uuid4()
        flat = _line("flat_fee", project_id=project_id, description="Community retainer", amount="75")
        hourly = _task("Hourly edits", project_id=project_id)
        package = _task("Community Management", mode="package", line_id=flat.id, project_id=project_id)
        invoice = compose_invoice(
            [_line("actual_hours", project_id=project_id), flat],
            [_log(hourly, project_id, "2"), _log(package, project_id, "3")],
            [hourly, package],
            Decimal("10"),
        )
        self.assertEqual(invoice["hourly_subtotal"], Decimal("20.00"))
        self.assertEqual(invoice["amount"], Decimal("95.00"))
        fee = next(row for row in invoice["lines"] if row["billing_type"] == "flat_fee")
        self.assertEqual(fee["hours"], Decimal("0.00"))
        self.assertNotIn("3h", fee["description"])


class DatabaseTaskBillingTests(unittest.TestCase):
    def test_permissions_defaults_logs_and_existing_invoices(self):
        from app.database import SessionLocal
        from app.deps import CurrentUser
        from app.models import (
            Client,
            ClientBillingLine,
            ClientVARole,
            Invoice,
            PaymentMethod,
            Project,
            Task,
            User,
            UserRole,
            VA,
            WorkLog,
            WorkLogStatus,
        )
        from app.routers.invoices import _generate_flexible
        from app.routers.tasks import create_task, get_task, update_task
        from app.schemas import InvoiceDraftLine, InvoiceGenerateRequest, TaskCreate, TaskUpdate

        db = SessionLocal()
        created = []
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            auditor = db.query(User).filter(User.role == UserRole.auditor).first()
            va_user = db.query(User).filter(User.role == UserRole.va).first()
            va = db.query(VA).filter(VA.user_id == va_user.id).first()
            self.assertIsNotNone(admin)
            self.assertIsNotNone(auditor)
            self.assertIsNotNone(va)
            client = Client(
                name=f"Sara Montreuil-Althaus {uuid4().hex[:6]}",
                billing_type="hourly",
                default_rate=Decimal("15"),
                is_active=True,
            )
            db.add(client)
            db.flush()
            project = Project(client_id=client.id, name="Social Media", color="#ec4899")
            db.add(project)
            db.flush()
            package_line = ClientBillingLine(
                client_id=client.id,
                billing_type="package",
                description="Instagram Engagement (Package)",
                default_amount=Decimal("75.00"),
                sort_order=0,
            )
            actual = ClientBillingLine(
                client_id=client.id,
                project_id=project.id,
                billing_type="actual_hours",
                sort_order=1,
            )
            db.add_all([package_line, actual])
            db.flush()
            db.add(ClientVARole(client_id=client.id, va_id=va.id, role="General VA"))
            db.commit()
            admin_current = CurrentUser(user=admin, va_id=None)
            auditor_current = CurrentUser(user=auditor, va_id=None)
            va_current = CurrentUser(user=va_user, va_id=va.id)
            created_task = create_task(
                TaskCreate(title="VA default", client_id=client.id, project_id=project.id),
                va_current,
                db,
            )
            self.assertIsNone(created_task.billing_mode)
            stored = db.query(Task).filter(Task.id == created_task.id).one()
            self.assertEqual(stored.billing_mode, "hourly")
            self.assertIsNone(stored.package_line_id)
            with self.assertRaises(HTTPException) as denied:
                create_task(
                    TaskCreate(title="VA package", client_id=client.id, project_id=project.id, billing_mode="package"),
                    va_current,
                    db,
                )
            self.assertEqual(denied.exception.status_code, 403)
            content = create_task(
                TaskCreate(title="Content Creation", client_id=client.id, project_id=project.id),
                admin_current,
                db,
            )
            self.assertEqual(content.billing_mode, "hourly")
            instagram = create_task(
                TaskCreate(
                    title="Instagram Engagement",
                    client_id=client.id,
                    project_id=project.id,
                    billing_mode="package",
                    package_line_id=package_line.id,
                ),
                admin_current,
                db,
            )
            self.assertEqual(instagram.billing_mode, "package")
            self.assertEqual(instagram.package_line_id, package_line.id)
            as_pm = get_task(instagram.id, auditor_current, db)
            self.assertEqual(as_pm.billing_mode, "package")
            self.assertIsNone(as_pm.package_line_id)
            with self.assertRaises(HTTPException) as pm_denied:
                update_task(instagram.id, TaskUpdate(billing_mode="hourly"), auditor_current, db)
            self.assertEqual(pm_denied.exception.status_code, 403)
            with self.assertRaises(HTTPException) as va_denied:
                update_task(content.id, TaskUpdate(billing_mode="package"), va_current, db)
            self.assertEqual(va_denied.exception.status_code, 403)
            db.refresh(stored)
            self.assertEqual(db.query(Task).filter(Task.id == instagram.id).one().billing_mode, "package")
            old = _generate_flexible(
                db,
                InvoiceGenerateRequest(
                    client_id=client.id,
                    year=2026,
                    month=10,
                    cutoff=15,
                    payment_method=PaymentMethod.wise,
                    lines=[InvoiceDraftLine(billing_type="manual", description="Older invoice", amount=Decimal("10"))],
                ),
                client,
                date(2026, 10, 1),
                date(2026, 10, 15),
                "Oct 1 - Oct 15, 2026",
            )
            old_amount = old.amount
            old_text = old.line_items[0].description
            logs = []
            email = create_task(TaskCreate(title="Email Management", client_id=client.id, project_id=project.id), admin_current, db)
            reporting = create_task(TaskCreate(title="Reporting", client_id=client.id, project_id=project.id), admin_current, db)
            for task_id, hours, label in (
                (content.id, Decimal("6.00"), "content"),
                (email.id, Decimal("4.00"), "email"),
                (reporting.id, Decimal("2.00"), "report"),
                (instagram.id, Decimal("0.42"), "ig"),
                (instagram.id, Decimal("0.42"), "ig"),
                (instagram.id, Decimal("0.42"), "ig"),
                (instagram.id, Decimal("0.42"), "ig"),
                (instagram.id, Decimal("0.40"), "ig"),
            ):
                log = WorkLog(
                    work_date=date(2026, 11, 3),
                    va_id=va.id,
                    client_id=client.id,
                    project_id=project.id,
                    task_id=task_id,
                    description_plain=label,
                    hours=hours,
                    va_rate=Decimal("15"),
                    va_pay=Decimal("1.00"),
                    status=WorkLogStatus.approved,
                )
                db.add(log)
                logs.append(log)
            db.commit()
            before = [(log.id, log.hours, log.status, log.invoice_id, log.va_pay) for log in logs]
            invoice = _generate_flexible(
                db,
                InvoiceGenerateRequest(
                    client_id=client.id,
                    year=2026,
                    month=11,
                    cutoff=15,
                    payment_method=PaymentMethod.wise,
                    compose_from_tasks=True,
                    show_hourly_breakdown=True,
                    show_package_time=False,
                ),
                client,
                date(2026, 11, 1),
                date(2026, 11, 15),
                "Nov 1 - Nov 15, 2026",
            )
            self.assertEqual(invoice.amount, Decimal("255.00"))
            self.assertEqual(invoice.total_hours, Decimal("12.00"))
            self.assertTrue(invoice.show_hourly_breakdown)
            self.assertFalse(invoice.show_package_time)
            text = "\n".join(item.description for item in invoice.line_items)
            self.assertIn("Content Creation - 6h x $15.00/hr = $90.00", text)
            self.assertIn("Instagram Engagement (Package)", text)
            self.assertNotIn("2h 05m", text)
            self.assertEqual(sum(item.amount for item in invoice.line_items), Decimal("255.00"))
            for log, snap in zip(logs, before):
                db.refresh(log)
                self.assertEqual((log.id, log.hours, log.status, log.invoice_id, log.va_pay), snap)
            db.refresh(package_line)
            self.assertEqual(package_line.default_amount, Decimal("75.00"))
            self.assertEqual(db.query(Task).filter(Task.id == instagram.id).one().billing_mode, "package")
            noted = _generate_flexible(
                db,
                InvoiceGenerateRequest(
                    client_id=client.id,
                    year=2026,
                    month=11,
                    cutoff=15,
                    payment_method=PaymentMethod.wise,
                    compose_from_tasks=True,
                    show_hourly_breakdown=False,
                    show_package_time=True,
                    invoice_number=f"SHC-TEST-{uuid4().hex[:8]}",
                ),
                client,
                date(2026, 11, 1),
                date(2026, 11, 15),
                "Nov 1 - Nov 15, 2026",
            )
            self.assertEqual(noted.amount, Decimal("255.00"))
            self.assertEqual(noted.total_hours, Decimal("12.00"))
            noted_text = "\n".join(item.description for item in noted.line_items)
            self.assertIn("Hourly VA services", noted_text)
            self.assertIn("time spent: 2h 05m, included", noted_text)
            self.assertEqual(sum(item.amount for item in noted.line_items), Decimal("255.00"))
            db.refresh(old)
            self.assertEqual(old.amount, old_amount)
            self.assertEqual(old.line_items[0].description, old_text)
            from app.models import InvoiceLineItem
            invoice_ids = [invoice.id, noted.id, old.id]
            db.query(InvoiceLineItem).filter(InvoiceLineItem.invoice_id.in_(invoice_ids)).delete(synchronize_session=False)
            db.query(Invoice).filter(Invoice.id.in_(invoice_ids)).delete(synchronize_session=False)
            db.query(WorkLog).filter(WorkLog.client_id == client.id).delete(synchronize_session=False)
            db.query(Task).filter(Task.client_id == client.id).delete(synchronize_session=False)
            db.query(ClientBillingLine).filter(ClientBillingLine.client_id == client.id).delete(synchronize_session=False)
            db.query(ClientVARole).filter(ClientVARole.client_id == client.id).delete(synchronize_session=False)
            db.query(Project).filter(Project.client_id == client.id).delete(synchronize_session=False)
            db.query(Client).filter(Client.id == client.id).delete(synchronize_session=False)
            db.commit()
        finally:
            db.rollback()
            db.close()
