"""Admin and Project Manager can return a submitted or approved timesheet for fixes.

A paid period stays locked until Undo Paid. The response has no pay fields.
"""
import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException

from app.database import SessionLocal
from app.deps import CurrentUser
from app.models import (
    Currency,
    PayrollRun,
    TimesheetStatus,
    TimesheetSubmission,
    User,
    UserRole,
    VA,
)
from app.routers.payroll import reject_timesheet, timesheet_entries
from app.schemas import TimesheetRejectRequest


class ReturnTimesheetTests(unittest.TestCase):
    def test_submitted_and_approved_can_be_returned_until_paid(self):
        db = SessionLocal()
        ids = {"users": [], "vas": [], "sheets": [], "runs": []}
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            self.assertIsNotNone(admin)
            va_user = User(
                email=f"return-va-{uuid4().hex[:8]}@example.com",
                password_hash="x",
                role=UserRole.va,
                display_name="Return VA",
            )
            pm = User(
                email=f"return-pm-{uuid4().hex[:8]}@example.com",
                password_hash="x",
                role=UserRole.auditor,
                display_name="Return PM",
            )
            db.add_all([va_user, pm])
            db.flush()
            ids["users"] = [va_user.id, pm.id]
            va = VA(user_id=va_user.id, name="Return VA", currency=Currency.PHP, is_active=True)
            pm_va = VA(user_id=pm.id, name="Return PM", currency=Currency.PHP, is_active=True)
            db.add_all([va, pm_va])
            db.flush()
            ids["vas"] = [va.id, pm_va.id]
            submitted = TimesheetSubmission(
                va_id=va.id,
                period_start=date(2026, 11, 1),
                period_end=date(2026, 11, 15),
                status=TimesheetStatus.submitted,
            )
            approved = TimesheetSubmission(
                va_id=va.id,
                period_start=date(2026, 10, 16),
                period_end=date(2026, 10, 31),
                status=TimesheetStatus.reviewed,
            )
            own = TimesheetSubmission(
                va_id=pm_va.id,
                period_start=date(2026, 11, 1),
                period_end=date(2026, 11, 15),
                status=TimesheetStatus.submitted,
            )
            db.add_all([submitted, approved, own])
            db.commit()
            ids["sheets"] = [submitted.id, approved.id, own.id]

            sent = reject_timesheet(
                submitted.id,
                TimesheetRejectRequest(reason="Please add Friday"),
                CurrentUser(admin),
                db,
            )
            self.assertEqual(sent.status, "rejected")
            self.assertEqual(sent.review_note, "Please add Friday")
            self.assertFalse(hasattr(sent, "total_pay"))
            detail = timesheet_entries(submitted.id, CurrentUser(admin), db)
            self.assertEqual(detail["timesheet"].review_note, "Please add Friday")
            self.assertNotIn("package_pay", detail)
            self.assertFalse(detail["is_paid"])

            pm_sent = reject_timesheet(
                approved.id,
                TimesheetRejectRequest(reason="Hours look short"),
                CurrentUser(pm, va_id=pm_va.id),
                db,
            )
            self.assertEqual(pm_sent.status, "rejected")
            self.assertEqual(pm_sent.review_note, "Hours look short")
            hidden = timesheet_entries(approved.id, CurrentUser(pm, va_id=pm_va.id), db)
            self.assertNotIn("package_pay", hidden)
            self.assertIsNone(hidden["entries"][0]["va_pay"] if hidden["entries"] else None)
            blob = str(hidden)
            self.assertNotIn("monthly_amount", blob)
            self.assertNotIn("total_pay", blob)

            with self.assertRaises(HTTPException) as own_err:
                reject_timesheet(own.id, TimesheetRejectRequest(reason="nope"), CurrentUser(pm, va_id=pm_va.id), db)
            self.assertEqual(own_err.exception.status_code, 403)

            run = PayrollRun(
                va_id=va.id,
                period_start=date(2026, 9, 1),
                period_end=date(2026, 9, 15),
                total_hours=Decimal("1"),
                total_pay=Decimal("100.00"),
                currency="PHP",
            )
            paid_sheet = TimesheetSubmission(
                va_id=va.id,
                period_start=date(2026, 9, 1),
                period_end=date(2026, 9, 15),
                status=TimesheetStatus.reviewed,
            )
            db.add_all([run, paid_sheet])
            db.commit()
            ids["runs"].append(run.id)
            ids["sheets"].append(paid_sheet.id)
            with self.assertRaises(HTTPException) as paid_err:
                reject_timesheet(paid_sheet.id, TimesheetRejectRequest(reason="too late"), CurrentUser(admin), db)
            self.assertEqual(paid_err.exception.status_code, 400)
            self.assertIn("Undo Paid", paid_err.exception.detail)
        finally:
            db.rollback()
            if ids["runs"]:
                db.query(PayrollRun).filter(PayrollRun.id.in_(ids["runs"])).delete(synchronize_session=False)
            if ids["sheets"]:
                db.query(TimesheetSubmission).filter(TimesheetSubmission.id.in_(ids["sheets"])).delete(synchronize_session=False)
            if ids["vas"]:
                db.query(VA).filter(VA.id.in_(ids["vas"])).delete(synchronize_session=False)
            if ids["users"]:
                db.query(User).filter(User.id.in_(ids["users"])).delete(synchronize_session=False)
            db.commit()
            db.close()


if __name__ == "__main__":
    unittest.main()
