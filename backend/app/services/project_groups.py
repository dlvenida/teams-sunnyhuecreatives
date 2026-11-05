"""Group projects under their clients for the Projects page."""


def group_projects(rows: list[dict]) -> list[dict]:
    """Alphabetical client sections. Projects inside each section are alphabetical too."""
    buckets: dict = {}
    for row in rows:
        key = row.get("client_id")
        name = (row.get("client_name") or "Client").strip() or "Client"
        bucket = buckets.setdefault(key, {"client_id": key, "client_name": name, "projects": []})
        bucket["projects"].append(row)
    groups = []
    for bucket in buckets.values():
        bucket["projects"].sort(key=lambda project: (project.get("name") or "").lower())
        bucket["count"] = len(bucket["projects"])
        groups.append(bucket)
    groups.sort(key=lambda group: group["client_name"].lower())
    return groups


def matching_client_ids(groups: list[dict], query: str) -> set:
    """Clients whose name or a project name matches. Search opens these sections."""
    needle = query.strip().lower()
    if not needle:
        return set()
    matched = set()
    for group in groups:
        if needle in group["client_name"].lower():
            matched.add(group["client_id"])
            continue
        for project in group["projects"]:
            if needle in (project.get("name") or "").lower():
                matched.add(group["client_id"])
                break
    return matched
