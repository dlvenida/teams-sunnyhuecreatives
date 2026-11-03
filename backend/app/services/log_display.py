"""Display helpers for work-log task names on payslips and reviews."""


def log_task_name(log) -> str | None:
    named = (getattr(log, "task_name", None) or "").strip()
    if named:
        return named
    task = getattr(log, "task", None)
    title = getattr(task, "title", None) if task is not None else None
    if title and str(title).strip():
        return str(title).strip()
    return None


def approval_task_label(log) -> str:
    """Name shown on the approval screen. Old and clock entries often have no task_name."""
    named = log_task_name(log)
    if named:
        return named
    desc = (getattr(log, "description_plain", None) or "").strip()
    if desc:
        line = desc.splitlines()[0].strip()
        if line:
            return line[:140]
    return "Untitled task"
