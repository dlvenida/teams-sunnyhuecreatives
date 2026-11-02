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
