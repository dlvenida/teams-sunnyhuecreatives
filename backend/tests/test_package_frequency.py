"""Bi-weekly package halves, monthly once, and a mixed hourly total."""
import unittest
from datetime import date
from decimal import Decimal

from uuid import uuid4

from fastapi import HTTPException

from app.models import PayType
from app.services.va_rates import (
    combine_period_pay,
    currency_code,
    frequency_for_save,
    frequency_for_update,
    package_amount_for_dates,
    package_amount_for_window,
    resolved_frequency,
    split_biweekly,
)


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
        """The 1st-15th gets the lower half. The 16th-end gets the rest, so the two periods sum to the month."""
        first, second = split_biweekly(Decimal("2000.01"))
        self.assertEqual(first + second, Decimal("2000.01"))
        self.assertEqual(second - first, Decimal("0.01"))

    def test_166_67_splits_as_83_33_then_83_34(self):
        first, second = split_biweekly(Decimal("166.67"))
        self.assertEqual(first, Decimal("83.33"))
        self.assertEqual(second, Decimal("83.34"))
        self.assertEqual(first + second, Decimal("166.67"))


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


class CombineTests(unittest.TestCase):
    def test_biweekly_with_no_logs_uses_only_the_package(self):
        joshua = uuid4()
        other = uuid4()
        dues = {
            joshua: package_amount_for_window(Decimal("2000"), "biweekly", date(2026, 11, 1), date(2026, 11, 15)),
            other: package_amount_for_window(Decimal("166.67"), "biweekly", date(2026, 11, 1), date(2026, 11, 15)),
        }
        self.assertEqual(combine_period_pay(dues, {}), Decimal("1083.33"))

    def test_logs_on_a_package_client_do_not_change_the_pay(self):
        joshua = uuid4()
        dues = {joshua: Decimal("1000.00")}
        logged = {joshua: Decimal("500.00")}
        self.assertEqual(combine_period_pay(dues, logged), Decimal("1000.00"))

    def test_two_biweekly_periods_sum_to_each_monthly_amount(self):
        joshua = uuid4()
        small = uuid4()
        first = {
            joshua: package_amount_for_window(Decimal("2000"), "biweekly", date(2026, 11, 1), date(2026, 11, 15)),
            small: package_amount_for_window(Decimal("166.67"), "biweekly", date(2026, 11, 1), date(2026, 11, 15)),
        }
        second = {
            joshua: package_amount_for_window(Decimal("2000"), "biweekly", date(2026, 11, 16), date(2026, 11, 30)),
            small: package_amount_for_window(Decimal("166.67"), "biweekly", date(2026, 11, 16), date(2026, 11, 30)),
        }
        self.assertEqual(first[small], Decimal("83.33"))
        self.assertEqual(second[small], Decimal("83.34"))
        self.assertEqual(combine_period_pay(first, {}) + combine_period_pay(second, {}), Decimal("2166.67"))

    def test_monthly_is_the_full_amount_once_even_with_logs(self):
        client = uuid4()
        first = {client: package_amount_for_window(Decimal("2000"), "monthly", date(2026, 11, 1), date(2026, 11, 15))}
        second = package_amount_for_window(Decimal("2000"), "monthly", date(2026, 11, 16), date(2026, 11, 30))
        self.assertEqual(combine_period_pay(first, {client: Decimal("80")}), Decimal("2000.00"))
        self.assertEqual(second, Decimal("0.00"))

    def test_mixed_package_and_hourly(self):
        package = uuid4()
        hourly = uuid4()
        dues = {package: Decimal("1000.00")}
        logs = {package: Decimal("0.00"), hourly: Decimal("250.00")}
        self.assertEqual(combine_period_pay(dues, logs), Decimal("1250.00"))


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


class _Rate:
    def __init__(self, pay_type, payment_frequency):
        self.pay_type = pay_type
        self.payment_frequency = payment_frequency


class FrequencyDefaultTests(unittest.TestCase):
    """New package rates omit frequency as Bi-weekly. Stored nulls stay Monthly."""

    def test_omitted_package_frequency_is_biweekly(self):
        self.assertEqual(frequency_for_save(PayType.package, None), "biweekly")
        self.assertEqual(frequency_for_save(PayType.package, ""), "biweekly")
        self.assertEqual(frequency_for_save(PayType.package, "   "), "biweekly")

    def test_explicit_monthly_and_biweekly_are_kept(self):
        self.assertEqual(frequency_for_save(PayType.package, "monthly"), "monthly")
        self.assertEqual(frequency_for_save(PayType.package, "Bi-Weekly"), "biweekly")

    def test_hourly_drops_frequency(self):
        self.assertIsNone(frequency_for_save(PayType.hourly, None))
        self.assertIsNone(frequency_for_save(PayType.hourly, "biweekly"))

    def test_unknown_frequency_is_rejected(self):
        with self.assertRaises(HTTPException):
            frequency_for_save(PayType.package, "weekly")

    def test_edit_requires_an_explicit_choice(self):
        self.assertEqual(frequency_for_update("monthly"), "monthly")
        self.assertEqual(frequency_for_update("biweekly"), "biweekly")
        with self.assertRaises(HTTPException):
            frequency_for_update(None)
        with self.assertRaises(HTTPException):
            frequency_for_update("  ")

    def test_null_on_an_existing_package_stays_monthly(self):
        self.assertEqual(resolved_frequency(_Rate(PayType.package, None)), "monthly")
        self.assertEqual(resolved_frequency(_Rate(PayType.package, "biweekly")), "biweekly")
        self.assertEqual(resolved_frequency(_Rate(PayType.package, "monthly")), "monthly")
        self.assertEqual(resolved_frequency(None), "monthly")

    def test_angeline_monthly_amount_is_half_only_when_biweekly(self):
        amount = Decimal("8400")
        first = date(2026, 11, 1)
        mid = date(2026, 11, 15)
        self.assertEqual(package_amount_for_window(amount, "biweekly", first, mid), Decimal("4200.00"))
        self.assertEqual(package_amount_for_window(amount, "monthly", first, mid), Decimal("8400.00"))
        self.assertEqual(package_amount_for_window(amount, None, first, mid), Decimal("8400.00"))

    def test_currency_code_keeps_php(self):
        self.assertEqual(currency_code("PHP"), "PHP")
        self.assertEqual(currency_code("usd"), "USD")
        self.assertEqual(currency_code(None), "USD")


if __name__ == "__main__":
    unittest.main()
