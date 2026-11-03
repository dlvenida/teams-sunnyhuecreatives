"""Bi-weekly package halves, monthly once, and a mixed hourly total."""
import unittest
from datetime import date
from decimal import Decimal

from app.services.va_rates import package_amount_for_dates, package_amount_for_window, split_biweekly


class SplitTests(unittest.TestCase):
    def test_even_monthly_amount_splits_in_half(self):
        first, second = split_biweekly(Decimal("2000.00"))
        self.assertEqual(first, Decimal("1000.00"))
        self.assertEqual(second, Decimal("1000.00"))
        self.assertEqual(first + second, Decimal("2000.00"))

    def test_odd_centavos_stay_balanced_and_sum_to_the_total(self):
        first, second = split_biweekly(Decimal("2001.00"))
        self.assertEqual((first, second), (Decimal("1000.50"), Decimal("1000.50")))
        self.assertEqual(first + second, Decimal("2001.00"))

    def test_leftover_centavo_goes_on_the_second_half(self):
        first, second = split_biweekly(Decimal("2000.01"))
        self.assertEqual(first + second, Decimal("2000.01"))
        self.assertEqual(second - first, Decimal("0.01"))


class WindowTests(unittest.TestCase):
    def test_biweekly_halves_of_november(self):
        amount = Decimal("2000")
        first = package_amount_for_window(amount, "biweekly", date(2026, 11, 1), date(2026, 11, 15))
        second = package_amount_for_window(amount, "biweekly", date(2026, 11, 16), date(2026, 11, 30))
        whole = package_amount_for_window(amount, "biweekly", date(2026, 11, 1), date(2026, 11, 30))
        self.assertEqual(first, Decimal("1000.00"))
        self.assertEqual(second, Decimal("1000.00"))
        self.assertEqual(whole, Decimal("2000.00"))

    def test_odd_amount_halves_sum_across_both_periods(self):
        amount = Decimal("2001")
        first = package_amount_for_window(amount, "biweekly", date(2026, 11, 1), date(2026, 11, 15))
        second = package_amount_for_window(amount, "biweekly", date(2026, 11, 16), date(2026, 11, 30))
        self.assertEqual(first, Decimal("1000.50"))
        self.assertEqual(second, Decimal("1000.50"))
        self.assertEqual(first + second, amount)

    def test_monthly_is_due_once_on_the_first_half(self):
        amount = Decimal("2000")
        first = package_amount_for_window(amount, "monthly", date(2026, 11, 1), date(2026, 11, 15))
        second = package_amount_for_window(amount, "monthly", date(2026, 11, 16), date(2026, 11, 30))
        whole = package_amount_for_window(amount, "monthly", date(2026, 11, 1), date(2026, 11, 30))
        self.assertEqual(first, Decimal("2000.00"))
        self.assertEqual(second, Decimal("0.00"))
        self.assertEqual(whole, Decimal("2000.00"))

    def test_blank_frequency_stays_monthly(self):
        amount = Decimal("2000")
        self.assertEqual(
            package_amount_for_window(amount, None, date(2026, 11, 1), date(2026, 11, 15)),
            Decimal("2000.00"),
        )
        self.assertEqual(
            package_amount_for_window(amount, None, date(2026, 11, 16), date(2026, 11, 30)),
            Decimal("0.00"),
        )

    def test_mixed_package_and_hourly_use_the_period_package_only(self):
        package_due = package_amount_for_window(Decimal("2000"), "biweekly", date(2026, 11, 1), date(2026, 11, 15))
        hourly = (Decimal("3.00") * Decimal("250")).quantize(Decimal("0.01"))
        # Package time logs store va_pay of 0, so they do not add to the hourly total.
        self.assertEqual(package_due + hourly + Decimal("0.00"), Decimal("1750.00"))


class DatesTests(unittest.TestCase):
    def test_biweekly_dates_in_both_halves_pay_the_month(self):
        due = package_amount_for_dates(
            Decimal("2000"),
            "biweekly",
            [date(2026, 11, 10), date(2026, 11, 20)],
        )
        self.assertEqual(due, Decimal("2000.00"))

    def test_monthly_dates_only_in_the_second_half_do_not_add_a_second_payment(self):
        due = package_amount_for_dates(Decimal("2000"), None, [date(2026, 11, 20)])
        self.assertEqual(due, Decimal("0.00"))


if __name__ == "__main__":
    unittest.main()
