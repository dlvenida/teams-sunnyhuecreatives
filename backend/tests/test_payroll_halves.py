"""1st-15th and 16th-end presets follow the Asia/Manila calendar month."""
import unittest
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.services.payroll_calendar import calendar_half, manila_today, snap_payroll_period
from app.services.va_rates import package_amount_for_window


class HalfPresetTests(unittest.TestCase):
    def test_november_2026_halves(self):
        today = date(2026, 11, 6)
        self.assertEqual(calendar_half("first_half", today), (date(2026, 11, 1), date(2026, 11, 15)))
        self.assertEqual(calendar_half("second_half", today), (date(2026, 11, 16), date(2026, 11, 30)))

    def test_second_half_on_the_6th_is_still_this_month(self):
        start, end = calendar_half("second_half", date(2026, 11, 6))
        self.assertEqual(start.month, 11)
        self.assertEqual(end, date(2026, 11, 30))

    def test_february_leap_and_non_leap(self):
        self.assertEqual(calendar_half("second_half", date(2026, 2, 20)), (date(2026, 2, 16), date(2026, 2, 28)))
        self.assertEqual(calendar_half("second_half", date(2028, 2, 1)), (date(2028, 2, 16), date(2028, 2, 29)))
        self.assertEqual(calendar_half("first_half", date(2028, 2, 29)), (date(2028, 2, 1), date(2028, 2, 15)))

    def test_manila_date_is_ahead_of_utc_in_the_morning(self):
        # 7:00 in Manila on Nov 6 is still Nov 5 in UTC.
        now = datetime(2026, 11, 5, 23, 0, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(manila_today(now), date(2026, 11, 6))

    def test_half_dates_are_not_snapped_into_a_different_window(self):
        for which, today in (("first_half", date(2026, 11, 6)), ("second_half", date(2026, 11, 20))):
            start, end = calendar_half(which, today)
            self.assertEqual(snap_payroll_period(start, end), (start, end))

    def test_biweekly_package_on_a_half_is_half_the_month(self):
        start, end = calendar_half("first_half", date(2026, 11, 6))
        self.assertEqual(
            package_amount_for_window(Decimal("8400"), "biweekly", start, end),
            Decimal("4200.00"),
        )
        later, month_end = calendar_half("second_half", date(2026, 11, 6))
        self.assertEqual(
            package_amount_for_window(Decimal("8400"), "biweekly", later, month_end),
            Decimal("4200.00"),
        )


if __name__ == "__main__":
    unittest.main()
