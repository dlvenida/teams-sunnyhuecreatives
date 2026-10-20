"""File storage for uploads (profile photos).

Uses an S3-compatible bucket (Railway Bucket in production) when configured,
otherwise falls back to local disk for development.

Env (Railway bucket variable names are also accepted):
  S3_ENDPOINT_URL / BUCKET_ENDPOINT
  S3_ACCESS_KEY_ID / BUCKET_ACCESS_KEY
  S3_SECRET_ACCESS_KEY / BUCKET_SECRET_KEY
  S3_BUCKET / BUCKET_NAME
  S3_REGION (default "auto")
"""

import os
from pathlib import Path

from app.config import settings


def _s3_config():
    endpoint = (
        os.getenv("S3_ENDPOINT_URL") or os.getenv("BUCKET_ENDPOINT") or os.getenv("S3_ENDPOINT")
        or os.getenv("AWS_ENDPOINT_URL")
    )
    access = os.getenv("S3_ACCESS_KEY_ID") or os.getenv("BUCKET_ACCESS_KEY") or os.getenv("AWS_ACCESS_KEY_ID")
    secret = os.getenv("S3_SECRET_ACCESS_KEY") or os.getenv("BUCKET_SECRET_KEY") or os.getenv("AWS_SECRET_ACCESS_KEY")
    bucket = (
        os.getenv("S3_BUCKET") or os.getenv("BUCKET_NAME")
        or os.getenv("AWS_S3_BUCKET") or os.getenv("AWS_S3_BUCKET_NAME")
    )
    if endpoint and access and secret and bucket:
        return {"endpoint": endpoint, "access": access, "secret": secret, "bucket": bucket,
                "region": os.getenv("S3_REGION", "auto")}
    return None


def bucket_enabled() -> bool:
    return _s3_config() is not None


def _client():
    import boto3  # imported lazily so local dev doesn't require it
    from botocore.config import Config

    cfg = _s3_config()
    style = os.getenv("S3_URL_STYLE") or os.getenv("AWS_S3_URL_STYLE") or "path"
    addressing = "virtual" if style.startswith("virtual") else "path"
    return boto3.client(
        "s3",
        endpoint_url=cfg["endpoint"],
        aws_access_key_id=cfg["access"],
        aws_secret_access_key=cfg["secret"],
        region_name=cfg["region"],
        config=Config(s3={"addressing_style": addressing}),
    ), cfg["bucket"]


def _local_path(key: str) -> Path:
    path = Path(settings.uploads_dir) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def save_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Store bytes under `key`; returns a storage ref (s3://... or local path)."""
    if bucket_enabled():
        client, bucket = _client()
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
        return f"s3://{bucket}/{key}"
    path = _local_path(key)
    path.write_bytes(data)
    return str(path)


def read_bytes(key: str) -> bytes | None:
    if bucket_enabled():
        client, bucket = _client()
        try:
            obj = client.get_object(Bucket=bucket, Key=key)
            return obj["Body"].read()
        except Exception:
            return None
    path = _local_path(key)
    return path.read_bytes() if path.exists() else None


def exists(key: str) -> bool:
    if bucket_enabled():
        client, bucket = _client()
        try:
            client.head_object(Bucket=bucket, Key=key)
            return True
        except Exception:
            return False
    return _local_path(key).exists()


def delete(key: str) -> None:
    if bucket_enabled():
        client, bucket = _client()
        try:
            client.delete_object(Bucket=bucket, Key=key)
        except Exception:
            pass
        return
    path = _local_path(key)
    if path.exists():
        path.unlink()
