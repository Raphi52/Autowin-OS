"""Autowin OS observability bridge for Hermes pre_api_request events."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_LOCK = threading.Lock()
_MAX_EVENT_BYTES = 2 * 1024 * 1024
_MAX_SPOOL_BYTES = 32 * 1024 * 1024
_SECRET_VALUE = re.compile(
    r"(Bearer\s+)[^\s\"']+|((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,\"']+|\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{30,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
    re.I,
)


def _secret_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    return (
        normalized in {"authorization", "proxyauthorization", "cookie", "setcookie", "token"}
        or normalized.endswith(("apikey", "accesstoken", "refreshtoken", "idtoken", "secret", "password", "credential"))
        or "privatekey" in normalized
    )


def _redact(value: Any, key: str = "") -> Any:
    if _secret_key(key):
        return "[REDACTED]"
    if isinstance(value, str):
        return _SECRET_VALUE.sub(lambda match: f"{match.group(1) or match.group(2) or ''}[REDACTED]", value)
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, dict):
        return {str(name): _redact(item, str(name)) for name, item in value.items()}
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)


def _spool_path() -> Path:
    configured = os.environ.get("AUTOWIN_HERMES_TRACE_DIR")
    if configured:
        # La configuration désigne un parent ; ne jamais réécrire les ACL du parent lui-même.
        root = Path(configured).resolve() / "hermes-trace-spool"
    else:
        appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        root = Path(appdata) / "autowin-os" / "hermes-trace-spool"
    root.mkdir(parents=True, exist_ok=True)
    return root / "events.jsonl"


def _secure_path(path: Path) -> None:
    if os.name != "nt":
        path.chmod(0o700 if path.is_dir() else 0o600)
        return
    user = f"{os.environ.get('USERDOMAIN', '')}\\{os.environ.get('USERNAME', '')}".strip("\\")
    if not user:
        raise OSError("cannot resolve current Windows user for Hermes trace ACL")
    result = subprocess.run(
        ["icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:(OI)(CI)F" if path.is_dir() else f"{user}:F", "*S-1-5-18:F", "*S-1-5-32-544:F"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise OSError(f"cannot secure Hermes trace ACL: {result.stderr or result.stdout}")


def _rotate_if_needed(path: Path, incoming_bytes: int) -> None:
    if not path.exists() or path.stat().st_size + incoming_bytes <= _MAX_SPOOL_BYTES:
        return
    previous = path.with_name("events.previous.jsonl")
    if previous.exists():
        previous.unlink()
    os.replace(path, previous)


@contextmanager
def _interprocess_lock(root: Path):
    lock_path = root / ".events.lock"
    lock_file = lock_path.open("a+b")
    try:
        if lock_path.stat().st_size == 0:
            lock_file.write(b"0")
            lock_file.flush()
        deadline = time.monotonic() + 10
        while True:
            try:
                lock_file.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (OSError, BlockingIOError):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Hermes trace spool lock timed out")
                time.sleep(0.01)
        try:
            yield lock_path
        finally:
            lock_file.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    finally:
        lock_file.close()


def on_pre_api_request(**kwargs: Any) -> None:
    request = kwargs.get("request")
    if not isinstance(request, dict) or not isinstance(request.get("body"), dict):
        return
    event = {
        "schema": "autowin.hermes-preflight/v1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "session_id": str(kwargs.get("session_id") or "unknown"),
        "turn_id": str(kwargs.get("turn_id") or "unknown"),
        "api_request_id": str(kwargs.get("api_request_id") or "unknown"),
        "conversation_id": str(kwargs.get("conversation_id") or os.environ.get("AUTOWIN_CONVERSATION_ID") or ""),
        "provider": str(kwargs.get("provider") or "unknown"),
        "model": str(kwargs.get("model") or "unknown"),
        "api_mode": str(kwargs.get("api_mode") or ""),
        "request": _redact(request),
    }
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    if len(line.encode("utf-8")) > _MAX_EVENT_BYTES:
        return
    with _LOCK:
        path = _spool_path()
        encoded_bytes = len((line + "\n").encode("utf-8"))
        try:
            with _interprocess_lock(path.parent) as lock_path:
                _secure_path(path.parent)
                _secure_path(lock_path)
                _rotate_if_needed(path, encoded_bytes)
                with path.open("a", encoding="utf-8") as spool:
                    spool.write(line + "\n")
                    spool.flush()
                _secure_path(path)
                previous = path.with_name("events.previous.jsonl")
                if previous.exists():
                    _secure_path(previous)
        except (OSError, TimeoutError):
            # La capture est fail-closed et ne doit jamais bloquer l'appel provider.
            return


def register(ctx: Any) -> None:
    ctx.register_hook("pre_api_request", on_pre_api_request)
