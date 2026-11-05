"""Kyla's bi-weekly package is a monthly amount. One half is one period.

A Manila midnight saved with toISOString() lands on the previous UTC date,
so Nov 1 to Nov 15 was stored as Oct 31 to Nov 14 and both halves were added.
"""
import unittest
from datetime import date
from decimal import Decimal

from app.services.payroll_calendar import period_lookup_keys, snap_payroll_period
from app.services.va_rates import package_amount_for_window

# The figures Jane saw. They are the whole month, not one period.
KYLA_MONTHLY = [
    ("Ever After Numbers", Decimal("4666.68")),
    ("Krysten Mack Perez | ASC", Decimal("2333.34")),
    ("Joshua Fox", Decimal("2000.00")),
    ("The Apolonia-on-Main", Decimal("1166.67")),
    ("Morgan King", Decimal("1166.67")),
]


class ManilaPeriodTests(unittest.TestCase):
    def test_oct_31_through_nov_14_is_november_1_to_15(self):
        start, end = snap_payroll_period(date(2026, 10, 31), date(2026, 11, 14))
        self.assertEqual((start, end), (date(2026, 11, 1), date(2026, 11, 15)))

    def test_second_half_shifts_back_the_same_way(self):
        start, end = snap_payroll_period(date(2026, 11, 15), date(2026, 11, 29))
        self.assertEqual((start, end), (date(2026, 11, 16), date(2026, 11, 30)))

    def test_a_real_period_stays_put(self):
        self.assertEqual(
            snap_payroll_period(date(2026, 11, 1), date(2026, 11, 15)),
            (date(2026, 11, 1), date(2026, 11, 15)),
        )
        self.assertEqual(
            snap_payroll_period(date(2026, 2, 15), date(2026, 2, 27)),
            (date(2026, 2, 16), date(2026, 2, 28)),
        )

    def test_lookup_finds_the_stored_shift_and_the_real_period(self):
        keys = period_lookup_keys(date(2026, 11, 1), date(2026, 11, 15))
        self.assertIn((date(2026, 11, 1), date(2026, 11, 15)), keys)
        self.assertIn((date(2026, 10, 31), date(2026, 11, 14)), keys)


class KylaPackageTests(unittest.TestCase):
    def test_the_shifted_window_adds_both_halves_into_the_month(self):
        total = sum(
            (
                package_amount_for_window(amount, "biweekly", date(2026, 10, 31), date(2026, 11, 14))
                for _name, amount in KYLA_MONTHLY
            ),
            Decimal("0"),
        )
        self.assertEqual(total, Decimal("11333.36"))

    def test_november_1_to_15_is_the_lower_half_of_each_client(self):
        expected = {
            "Ever After Numbers": Decimal("2333.34"),
            "Krysten Mack Perez | ASC": Decimal("1166.67"),
            "Joshua Fox": Decimal("1000.00"),
            "The Apolonia-on-Main": Decimal("583.33"),
            "Morgan King": Decimal("583.33"),
        }
        start, end = snap_payroll_period(date(2026, 10, 31), date(2026, 11, 14))
        got = {
            name: package_amount_for_window(amount, "biweekly", start, end)
            for name, amount in KYLA_MONTHLY
        }
        self.assertEqual(got, expected)
        self.assertEqual(sum(got.values(), Decimal("0")), Decimal("5666.67"))

    def test_the_16th_keeps_the_remainder_and_the_month_still_adds_up(self):
        first = sum(
            (package_amount_for_window(amount, "biweekly", date(2026, 11, 1), date(2026, 11, 15)) for _n, amount in KYLA_MONTHLY),
            Decimal("0"),
        )
        second = sum(
            (package_amount_for_window(amount, "biweekly", date(2026, 11, 16), date(2026, 11, 30)) for _n, amount in KYLA_MONTHLY),
            Decimal("0"),
        )
        self.assertEqual(first, Decimal("5666.67"))
        self.assertEqual(second, Decimal("5666.69"))
        self.assertEqual(first + second, Decimal("11333.36"))
