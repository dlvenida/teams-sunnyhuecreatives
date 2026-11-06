"""Timesheet review package pay follows the payroll window, not only the saved timesheet."""
import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.database import SessionLocal
from app.deps import CurrentUser
from app.models import (
    BillingType,
    Client,
    Currency,
    PayType,
    RateStatus,
    TimesheetStatus,
    TimesheetSubmission,
    User,
    UserRole,
    VA,
    VARate,
)
from app.routers.payroll import timesheet_entries


class HalfReviewTests(unittest.TestCase):
    def test_requested_half_replaces_a_full_month_timesheet(self):
        db = SessionLocal()
        user = va = client = sheet = None
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            self.assertIsNotNone(admin)
            user = User(
                email=f"half-{uuid4().hex[:8]}@example.com",
                password_hash="x",
                role=UserRole.va,
                display_name="Half Review",
            )
            db.add(user)
            db.flush()
            va = VA(user_id=user.id, name="Half Review", currency=Currency.PHP, is_active=True)
            db.add(va)
            db.flush()
            client = Client(name=f"Half Client {uuid4().hex[:6]}", billing_type=BillingType.hourly, is_active=True)
            db.add(client)
            db.flush()
            db.add(VARate(
                va_id=va.id,
                client_id=client.id,
                pay_type=PayType.package,
                payment_frequency="biweekly",
                currency=Currency.PHP,
                amount=Decimal("2000.00"),
                status=RateStatus.approved,
            ))
            sheet = TimesheetSubmission(
                va_id=va.id,
                period_start=date(2026, 11, 1),
                period_end=date(2026, 11, 30),
                status=TimesheetStatus.submitted,
            )
            db.add(sheet)
            db.commit()
            whole = timesheet_entries(sheet.id, CurrentUser(admin), db)
            first = timesheet_entries(sheet.id, CurrentUser(admin), db, date(2026, 11, 1), date(2026, 11, 15))
            second = timesheet_entries(sheet.id, CurrentUser(admin), db, date(2026, 11, 16), date(2026, 11, 30))
            self.assertEqual(Decimal(whole["package_pay"]["clients"][0]["calculated_amount"]), Decimal("2000.00"))
            self.assertEqual(first["package_pay"]["period_start"], "2026-11-01")
            self.assertEqual(first["package_pay"]["period_end"], "2026-11-15")
            self.assertEqual(Decimal(first["package_pay"]["clients"][0]["calculated_amount"]), Decimal("1000.00"))
            self.assertEqual(Decimal(second["package_pay"]["clients"][0]["calculated_amount"]), Decimal("1000.00"))
            self.assertEqual(first["package_pay"]["currency"], "PHP")
        finally:
            db.rollback()
            if sheet is not None:
                db.query(TimesheetSubmission).filter(TimesheetSubmission.id == sheet.id).delete()
            if va is not None:
                db.query(VARate).filter(VARate.va_id == va.id).delete()
                db.query(VA).filter(VA.id == va.id).delete()
            if client is not None:
                db.query(Client).filter(Client.id == client.id).delete()
            if user is not None:
                db.query(User).filter(User.id == user.id).delete()
            db.commit()
            db.close()


if __name__ == "__main__":
    unittest.main()
