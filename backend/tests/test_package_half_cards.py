"""Pay cards keep the monthly rate beside the half for this period.

A bi-weekly 1st-15th is already one half. A monthly schedule on that same
window is still the full rate until Jane chooses Half. The card needs both
numbers so it does not halve a half.
"""
import unittest
from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.database import SessionLocal
from app.deps import CurrentUser
from app.models import BillingType, Client, Currency, PayType, RateStatus, User, UserRole, VA, VARate
from app.routers.payroll import calculate_payroll
from app.schemas import PayrollRequest


class PackageHalfCardTests(unittest.TestCase):
    def test_half_window_reports_the_monthly_rate_and_one_half(self):
        user = va = auditor = None
        client_ids: list = []
        db = SessionLocal()
        try:
            admin = db.query(User).filter(User.role == UserRole.admin).first()
            self.assertIsNotNone(admin)
            user = User(email=f"halfcard-{uuid4().hex[:8]}@example.com", password_hash="x", role=UserRole.va, display_name="Half Card")
            db.add(user)
            db.flush()
            va = VA(user_id=user.id, name="Half Card", currency=Currency.PHP, is_active=True)
            db.add(va)
            db.flush()
            client = Client(name=f"Half Card Client {uuid4().hex[:6]}", billing_type=BillingType.hourly, is_active=True)
            db.add(client)
            db.flush()
            client_ids.append(client.id)
            db.add(VARate(
                va_id=va.id, client_id=client.id, pay_type=PayType.package, payment_frequency="biweekly",
                currency=Currency.PHP, amount=Decimal("2000.00"), status=RateStatus.approved,
            ))
            monthly_client = Client(name=f"Monthly Card {uuid4().hex[:6]}", billing_type=BillingType.hourly, is_active=True)
            db.add(monthly_client)
            db.flush()
            client_ids.append(monthly_client.id)
            db.add(VARate(
                va_id=va.id, client_id=monthly_client.id, pay_type=PayType.package, payment_frequency="monthly",
                currency=Currency.PHP, amount=Decimal("1166.67"), status=RateStatus.approved,
            ))
            db.commit()

            def row_for(result, name_part):
                va_row = next(item for item in result.vas if item.va_id == va.id)
                return next(item for item in va_row.by_client if name_part in item.label)

            first = calculate_payroll(
                PayrollRequest(period="custom", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15), va_id=va.id),
                CurrentUser(admin),
                db,
            )
            joshua = row_for(first, "Half Card Client")
            self.assertEqual(joshua.monthly_amount, Decimal("2000.00"))
            self.assertEqual(joshua.half_amount, Decimal("1000.00"))
            self.assertEqual(joshua.calculated_pay, Decimal("1000.00"))
            self.assertEqual(joshua.pay, Decimal("1000.00"))
            self.assertEqual(joshua.payment_frequency, "biweekly")

            monthly = row_for(first, "Monthly Card")
            self.assertEqual(monthly.monthly_amount, Decimal("1166.67"))
            self.assertEqual(monthly.half_amount, Decimal("583.33"))
            self.assertEqual(monthly.calculated_pay, Decimal("1166.67"))
            self.assertEqual(monthly.pay, Decimal("1166.67"))

            second = calculate_payroll(
                PayrollRequest(period="custom", date_from=date(2026, 11, 16), date_to=date(2026, 11, 30), va_id=va.id),
                CurrentUser(admin),
                db,
            )
            monthly_second = row_for(second, "Monthly Card")
            self.assertEqual(monthly_second.half_amount, Decimal("583.34"))
            self.assertEqual(monthly_second.calculated_pay, Decimal("0.00"))
            self.assertEqual(monthly_second.monthly_amount, Decimal("1166.67"))
            self.assertEqual(monthly_second.half_amount + row_for(first, "Monthly Card").half_amount, Decimal("1166.67"))

            whole = calculate_payroll(
                PayrollRequest(period="custom", date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), va_id=va.id),
                CurrentUser(admin),
                db,
            )
            whole_joshua = row_for(whole, "Half Card Client")
            self.assertEqual(whole_joshua.calculated_pay, Decimal("2000.00"))
            self.assertEqual(whole_joshua.pay, Decimal("2000.00"))
            self.assertEqual(whole_joshua.half_amount, Decimal("1000.00"))
            self.assertEqual(whole_joshua.monthly_amount, Decimal("2000.00"))

            auditor = User(email=f"pm-half-{uuid4().hex[:8]}@example.com", password_hash="x", role=UserRole.auditor, display_name="PM Half")
            db.add(auditor)
            db.commit()
            hidden = calculate_payroll(
                PayrollRequest(period="custom", date_from=date(2026, 11, 1), date_to=date(2026, 11, 15), va_id=va.id),
                CurrentUser(auditor),
                db,
            )
            hidden_row = row_for(hidden, "Half Card Client")
            self.assertIsNone(hidden_row.pay)
            self.assertIsNone(hidden_row.monthly_amount)
            self.assertIsNone(hidden_row.half_amount)
            self.assertIsNone(hidden_row.payment_frequency)
            self.assertIsNone(hidden_row.calculated_pay)
            self.assertIsNone(hidden_row.pay_type)
        finally:
            db.rollback()
            if va is not None:
                db.query(VARate).filter(VARate.va_id == va.id).delete()
                db.query(VA).filter(VA.id == va.id).delete()
            if client_ids:
                db.query(Client).filter(Client.id.in_(client_ids)).delete(synchronize_session=False)
            if user is not None:
                db.query(User).filter(User.id == user.id).delete()
            if auditor is not None:
                db.query(User).filter(User.id == auditor.id).delete()
            db.commit()
            db.close()


if __name__ == "__main__":
    unittest.main()
