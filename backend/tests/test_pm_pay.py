"""Project Managers are paid through the same VA rates, and only see their own money."""
import inspect
import unittest
from uuid import uuid4

from fastapi.routing import APIRoute

from app.deps import require_admin, require_va
from app.main import app
from app.schemas import VARateAdminCreate
from app.services.package_overrides import include_package_pay
from app.services.pay_access import (
    hide_team_money,
    may_review_timesheet,
    pay_notice_path,
    person_role_label,
    rates_notice_path,
)


def _deps(route: APIRoute) -> set:
    names = set()
    for dep in route.dependant.dependencies:
        call = getattr(dep, "call", None)
        if call is not None:
            names.add(getattr(call, "__name__", "") or "")
    return names


def _policy(method: str, path: str) -> str | None:
    """admin: Project Manager gets 403. redacted: team payload hides money. self: caller only."""
    if path.startswith("/va-rates/mine"):
        return "self"
    if path == "/va-rates/people" or path.startswith("/va-rates"):
        return "admin"
    if path in {"/va/earnings", "/va/payroll-history"} or path.startswith("/va/work-logs"):
        return "self"
    if path.startswith("/invoices") or path.startswith("/expenses") or path == "/dashboard/owner-finance":
        return "admin"
    if path == "/dashboard/summary":
        return "redacted"
    if path.startswith("/payroll/runs") or path == "/payroll/package-overrides":
        return "admin"
    if path in {"/payroll/calculate", "/payroll/timesheets/{timesheet_id}/entries"}:
        return "redacted"
    if path in {"/payroll/timesheets/{timesheet_id}/review", "/payroll/timesheets/{timesheet_id}/reject"}:
        return "guard"
    if path == "/payroll/timesheets":
        return "hours"
    if path.startswith("/reports"):
        return "redacted"
    if path.startswith("/work-logs/export") or (path == "/work-logs/{log_id}" and method == "DELETE"):
        return "admin"
    if path == "/work-logs" or (path == "/work-logs/{log_id}" and method == "PATCH"):
        return "redacted"
    if path in {"/work-logs/{log_id}/approve", "/work-logs/{log_id}/reject"}:
        return "delegated"
    if path == "/settings/display" or (path == "/settings" and method == "GET"):
        return "redacted"
    if path.startswith("/settings"):
        return "admin"
    if method == "GET" and path in {"/clients", "/clients/{client_id}/packages", "/clients/{client_id}/detail"}:
        return "redacted"
    if path == "/auth/users/{user_id}/detail":
        return "redacted"
    return None


class PayAccessTests(unittest.TestCase):
    def test_a_project_manager_cannot_review_her_own_timesheet(self):
        person = uuid4()
        self.assertTrue(may_review_timesheet("admin", uuid4(), person))
        self.assertTrue(may_review_timesheet("auditor", uuid4(), person))
        self.assertFalse(may_review_timesheet("auditor", person, person))
        self.assertFalse(may_review_timesheet("va", person, uuid4()))

    def test_team_money_stays_hidden_and_self_notices_open_her_pages(self):
        self.assertTrue(hide_team_money("auditor"))
        self.assertFalse(hide_team_money("admin"))
        self.assertFalse(hide_team_money("va"))
        self.assertFalse(include_package_pay("auditor"))
        self.assertEqual(pay_notice_path("auditor"), "/admin/my-pay")
        self.assertEqual(pay_notice_path("va"), "/va/payroll")
        self.assertEqual(rates_notice_path("auditor"), "/admin/my-rates")
        self.assertEqual(rates_notice_path("va"), "/va/rates")
        self.assertEqual(person_role_label("auditor"), "Project Manager")

    def test_pm_rates_reuse_the_va_rate_form(self):
        """No separate salary type. A rate still needs a client, a pay type, and a currency."""
        fields = VARateAdminCreate.model_fields
        self.assertIn("pay_type", fields)
        self.assertIn("currency", fields)
        self.assertIn("payment_frequency", fields)
        self.assertTrue(fields["client_id"].is_required())
        self.assertTrue(fields["va_id"].is_required())

    def test_money_endpoints_hide_other_peoples_pay_from_a_project_manager(self):
        seen = []
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in sorted(route.methods - {"HEAD"}):
                policy = _policy(method, route.path)
                if policy is None:
                    continue
                seen.append((method, route.path, policy))
                deps = _deps(route)
                source = inspect.getsource(route.endpoint)
                if policy == "admin":
                    self.assertIn("require_admin", deps, f"{method} {route.path} must be admin-only")
                    self.assertNotIn(require_va, {dep.call for dep in route.dependant.dependencies if dep.call})
                elif policy == "self":
                    self.assertIn("require_va", deps, f"{method} {route.path} must be the caller's own record")
                    self.assertIn("current.va_id", source, f"{method} {route.path} must filter to current.va_id")
                elif policy == "redacted":
                    self.assertNotIn("require_admin", deps, f"{method} {route.path} is a team screen")
                    self.assertIn("hide_team_money", source, f"{method} {route.path} must hide team money")
                elif policy == "guard":
                    self.assertIn("may_review_timesheet", source, f"{method} {route.path} must block a self approval")
                elif policy == "delegated":
                    self.assertIn("update_work_log", source, f"{method} {route.path} must reuse the redacted update")
                elif policy == "hours":
                    self.assertNotIn("total_pay", source, f"{method} {route.path} must not send pay")
                    self.assertNotIn("va_pay", source, f"{method} {route.path} must not send pay")
                else:
                    self.fail(policy)
        required = {
            ("POST", "/payroll/calculate"),
            ("PUT", "/payroll/package-overrides"),
            ("POST", "/payroll/runs"),
            ("GET", "/va/earnings"),
            ("GET", "/va/payroll-history"),
            ("GET", "/va-rates"),
            ("GET", "/va-rates/mine"),
            ("GET", "/invoices"),
            ("GET", "/expenses"),
            ("GET", "/dashboard/summary"),
            ("GET", "/dashboard/owner-finance"),
            ("GET", "/work-logs"),
            ("POST", "/reports/generate"),
        }
        found = {(method, path) for method, path, _policy in seen}
        self.assertTrue(required <= found, f"missing money routes: {sorted(required - found)}")
        self.assertGreaterEqual(len(seen), len(required))


class ReviewRouteTests(unittest.TestCase):
    def test_review_and_reject_use_the_self_approval_guard(self):
        from app.routers import payroll

        for name in ("review_timesheet", "reject_timesheet"):
            source = inspect.getsource(getattr(payroll, name))
            self.assertIn("may_review_timesheet", source)
        self.assertIn("require_admin", inspect.getsource(payroll.upsert_package_override))
        self.assertIs(payroll.upsert_package_override.__defaults__, None)
        # The route dependency, not a default argument, is what blocks a Project Manager.
        route = next(
            r for r in app.routes
            if isinstance(r, APIRoute) and r.path == "/payroll/package-overrides"
        )
        self.assertIn(require_admin, [dep.call for dep in route.dependant.dependencies if dep.call])
