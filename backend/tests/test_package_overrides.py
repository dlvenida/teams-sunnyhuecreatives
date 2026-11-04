"""Per-period Fixed Package overrides: skip, adjust, revert, and who may edit."""
import inspect
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import HTTPException

from app.deps import CurrentUser, require_admin
from app.models import UserRole
from app.services.package_overrides import apply_for_period, describe_package_review, effective_package_amount, include_package_pay, plan_override


class EffectiveTests(unittest.TestCase):
    def test_skip_pays_zero_and_keeps_the_calculation(self):
        effective, skipped, adjusted = effective_package_amount(Decimal("1000.00"), skipped=True)
        self.assertEqual(effective, Decimal("0.00"))
        self.assertTrue(skipped)
        self.assertFalse(adjusted)

    def test_adjust_replaces_only_the_period_amount(self):
        effective, skipped, adjusted = effective_package_amount(Decimal("1000.00"), amount=Decimal("750"))
        self.assertEqual((effective, skipped, adjusted), (Decimal("750.00"), False, True))

    def test_same_amount_is_not_an_adjustment(self):
        effective, skipped, adjusted = effective_package_amount(Decimal("1000"), amount=Decimal("1000.00"))
        self.assertEqual(effective, Decimal("1000.00"))
        self.assertFalse(adjusted)
        self.assertFalse(skipped)

    def test_negative_amount_is_rejected(self):
        with self.assertRaises(ValueError):
            effective_package_amount(Decimal("1000.00"), amount=Decimal("-1"))
        with self.assertRaises(ValueError):
            plan_override(Decimal("1000.00"), skipped=False, amount=Decimal("-0.01"), note=None)

    def test_revert_to_default_deletes_the_override(self):
        planned = plan_override(Decimal("1000.00"), skipped=False, amount=Decimal("1000.00"), note="  ")
        self.assertEqual(planned.action, "delete")
        blank = plan_override(Decimal("83.33"), skipped=False, amount=None, note=None)
        self.assertEqual(blank.action, "delete")
        effective, skipped, adjusted = effective_package_amount(Decimal("83.33"))
        self.assertEqual((effective, skipped, adjusted), (Decimal("83.33"), False, False))

    def test_skip_is_stored_even_when_the_amount_matches(self):
        planned = plan_override(Decimal("1000.00"), skipped=True, amount=None, note="No work this period")
        self.assertEqual(planned.action, "save")
        self.assertTrue(planned.skipped)
        self.assertEqual(planned.note, "No work this period")
        self.assertIsNone(planned.amount)

    def test_override_does_not_change_the_next_period(self):
        first = (date(2027, 2, 1), date(2027, 2, 15))
        second = (date(2027, 2, 16), date(2027, 2, 28))
        stored = {first: (False, Decimal("400.00"))}
        this_period = apply_for_period(Decimal("1000.00"), stored, first)
        next_period = apply_for_period(Decimal("1000.00"), stored, second)
        self.assertEqual(this_period, (Decimal("400.00"), False, True))
        self.assertEqual(next_period, (Decimal("1000.00"), False, False))

    def test_a_skipped_client_does_not_follow_into_the_next_period(self):
        first = (date(2027, 2, 1), date(2027, 2, 15))
        second = (date(2027, 2, 16), date(2027, 2, 28))
        stored = {first: (True, None)}
        skipped = apply_for_period(Decimal("83.34"), stored, first)
        later = apply_for_period(Decimal("83.34"), stored, second)
        self.assertEqual(skipped[0], Decimal("0.00"))
        self.assertTrue(skipped[1])
        self.assertEqual(later, (Decimal("83.34"), False, False))


class ReviewScreenTests(unittest.TestCase):
    def test_review_lists_the_period_amount_and_an_edit(self):
        shown = describe_package_review(Decimal("1000.00"), amount=Decimal("700"), note="days off")
        self.assertEqual(shown["calculated_amount"], Decimal("1000.00"))
        self.assertEqual(shown["amount"], Decimal("700.00"))
        self.assertTrue(shown["pay_this_period"])
        self.assertEqual(shown["reason"], "days off")
        self.assertTrue(shown["adjusted"])

    def test_turning_pay_off_shows_zero(self):
        shown = describe_package_review(Decimal("1000.00"), skipped=True)
        self.assertFalse(shown["pay_this_period"])
        self.assertEqual(shown["amount"], Decimal("0.00"))

    def test_project_manager_does_not_receive_package_pay(self):
        self.assertTrue(include_package_pay("admin"))
        self.assertFalse(include_package_pay("auditor"))
        self.assertFalse(include_package_pay("va"))


class PermissionTests(unittest.TestCase):
    def test_project_manager_and_va_are_blocked(self):
        pm = CurrentUser(user=SimpleNamespace(role=UserRole.auditor, id=uuid4(), is_active=True))
        va = CurrentUser(user=SimpleNamespace(role=UserRole.va, id=uuid4(), is_active=True))
        admin = CurrentUser(user=SimpleNamespace(role=UserRole.admin, id=uuid4(), is_active=True))
        for blocked in (pm, va):
            with self.assertRaises(HTTPException) as caught:
                require_admin(blocked)
            self.assertEqual(caught.exception.status_code, 403)
        self.assertIs(require_admin(admin), admin)

    def test_override_route_depends_on_admin_only(self):
        from app.routers.payroll import router

        route = next(r for r in router.routes if getattr(r, "path", "") == "/payroll/package-overrides")
        names = [dep.call.__name__ for dep in route.dependant.dependencies]
        self.assertIn("require_admin", names)
        self.assertNotIn("require_admin_or_auditor", names)
        source = inspect.getsource(route.endpoint)
        self.assertIn("period_is_paid", source)
        self.assertIn("Undo Paid", source)


if __name__ == "__main__":
    unittest.main()
