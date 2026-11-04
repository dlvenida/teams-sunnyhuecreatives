"""Who may see pay, and who may approve a timesheet.

Project Managers use the same rates and payroll as VAs. On team screens their
responses stay redacted. A Project Manager's own timesheet and payslip are the
only place her amounts are returned, and she cannot approve or edit that pay.
"""


def role_value(role) -> str:
    return role.value if hasattr(role, "value") else str(role or "")


def hide_team_money(role) -> bool:
    """True when this person must not receive anyone else's rates, pay, or invoices."""
    return role_value(role) == "auditor"


def may_review_timesheet(actor_role, actor_user_id, owner_user_id) -> bool:
    """Admins review every timesheet. A Project Manager cannot review her own."""
    role = role_value(actor_role)
    if role == "admin":
        return True
    if role != "auditor":
        return False
    if owner_user_id is not None and actor_user_id == owner_user_id:
        return False
    return True


def pay_notice_path(role) -> str:
    """Where a payslip or timesheet decision opens for this person."""
    if role_value(role) == "auditor":
        return "/admin/my-pay"
    return "/va/payroll"


def rates_notice_path(role) -> str:
    if role_value(role) == "auditor":
        return "/admin/my-rates"
    return "/va/rates"


def person_role_label(role) -> str:
    if role_value(role) == "auditor":
        return "Project Manager"
    if role_value(role) == "va":
        return "VA"
    return role_value(role) or "Team"
