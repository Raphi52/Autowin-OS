#!/usr/bin/env python3
"""Fail-open UserPromptSubmit adapter for Claude Code and Codex CLI."""
import json
import os
import re
import uuid
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from brain_auth import seal_request, service_token, verified_context
from brain_singleton import ProcessMutex

DEFAULT_PORT = 8765


def _endpoint(path="/query"):
    port = int(os.environ.get("AMITEL_BRAIN_PORT", DEFAULT_PORT))
    return f"http://127.0.0.1:{port}{path}"


def _port():
    return int(os.environ.get("AMITEL_BRAIN_PORT", DEFAULT_PORT))


def _validate_response(payload, token):
    return verified_context(payload, token)


def _authenticate_service(token, timeout):
    """Prove the listener owns the local secret before disclosing a prompt or bearer token."""
    endpoint = _endpoint().removesuffix("/query")
    request = Request(f"{endpoint}/challenge", method="GET")
    with urlopen(request, timeout=timeout) as response:
        declared = int(response.headers.get("Content-Length", "0") or 0)
        if declared < 0 or declared > 16_384:
            raise ValueError("invalid Amitel Brain challenge")
        raw = response.read(16_385)
    if len(raw) > 16_384:
        raise ValueError("invalid Amitel Brain challenge")
    payload = json.loads(raw)
    challenge = _validate_response(payload, token)
    match = re.fullmatch(r"challenge:([0-9a-f]{24})", challenge)
    if match is None:
        raise ValueError("Amitel Brain server authentication failed")
    return match.group(1)


def _request_context(prompt, timeout=1.0, harness=None):
    token = service_token()
    nonce = _authenticate_service(token, timeout)
    request_payload = {
        "query": prompt[:8000],
        "max_chars": 2000,
        "harness": harness or os.environ.get("AMITEL_BRAIN_HARNESS", "unknown"),
        "trace_id": uuid.uuid4().hex,
    }
    body = json.dumps(seal_request(request_payload, token, nonce)).encode("utf-8")
    request = Request(
        _endpoint().replace("/query", "/query-secure"), data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read())
    return _validate_response(payload, token)


def _configured_root():
    default = Path(__file__).resolve().parents[1]
    return str(Path(os.environ.get("AMITEL_BRAIN_ROOT", default)).resolve())


def _same_root(left, right):
    return os.path.normcase(os.path.normpath(left)) == os.path.normcase(os.path.normpath(right))


def _request_health(timeout=1.0):
    """Root the listening server serves, read from its SIGNED /health context.

    The listener proves it owns the local secret (challenge) before it receives the bearer.
    503 is the normal answer of a loading or degraded index; its body still names the root.
    A server older than root identification answers an empty root.
    """
    token = service_token()
    _authenticate_service(token, timeout)
    request = Request(_endpoint("/health"), headers={"Authorization": f"Bearer {token}"}, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(65_536)
    except HTTPError as exc:
        if exc.code != 503:
            raise
        raw = exc.read(65_536)
    return _validate_response(json.loads(raw), token)


def _shutdown_server(timeout=1.0):
    token = service_token()
    _authenticate_service(token, timeout)
    request = Request(
        _endpoint("/shutdown"), data=b"{}",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read(65_536))
    _validate_response(payload, token)


def _wait_for_shutdown(timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            _request_health(timeout=0.2)
        except (URLError, TimeoutError, OSError):
            return
        time.sleep(0.05)
    raise TimeoutError("brain service did not stop")


def _server_python():
    configured = os.environ.get("AMITEL_BRAIN_PYTHON")
    if configured:
        return configured
    local_venv = Path.home() / ".brain" / "tooling" / ".venv"
    candidates = [local_venv / "Scripts" / "python.exe", local_venv / "bin" / "python"]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def _spawn_server():
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    command = [_server_python(), str(Path(__file__).with_name("brain_server.py"))]
    kwargs = {
        "cwd": str(Path(__file__).resolve().parent),
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(command, **kwargs)


def query_service(prompt, startup_timeout=8.0, harness=None):
    # A server started for ANOTHER root (reinstall with a new -BrainRoot, switch between two
    # brains) would otherwise keep answering from the old corpus, silently. Lost when the repo
    # was aligned on protocol v2 (PR #1, 2026-09-02); restored here on top of the challenge.
    expected_root = _configured_root()
    try:
        active_root = _request_health()
    except HTTPError:
        return ""  # Occupied port or unauthenticated response: never inject and never retry.
    except (ValueError, json.JSONDecodeError):
        return ""  # Occupied port or unauthenticated response: never inject and never retry.
    except (URLError, TimeoutError, OSError):
        active_root = None  # Nobody listening yet: the startup path below decides.
    # An empty root is a server older than root identification: it cannot be checked, so it
    # keeps today's behaviour instead of being refused forever.
    if active_root and not _same_root(active_root, expected_root):
        return _restart_on_configured_root(prompt, startup_timeout, harness, expected_root)
    try:
        return _request_context(prompt, harness=harness)
    except HTTPError as exc:
        if exc.code == 503:
            return _wait_for_service(prompt, startup_timeout, harness)
        return ""  # Occupied port or unauthenticated response: never inject and never retry.
    except (ValueError, json.JSONDecodeError):
        return ""  # Occupied port or unauthenticated response: never inject and never retry.
    except (URLError, TimeoutError, OSError):
        pass
    startup_mutex = ProcessMutex.try_acquire(f"startup-{_port()}")
    if startup_mutex is not None:
        try:
            # Another hook may have completed startup between the first probe and this lock.
            try:
                return _request_context(prompt, harness=harness)
            except HTTPError as exc:
                if exc.code == 503:
                    return _wait_for_service(prompt, startup_timeout, harness)
                return ""
            except (ValueError, json.JSONDecodeError):
                return ""
            except (URLError, TimeoutError, OSError):
                pass
            try:
                _spawn_server()
            except OSError:
                return ""
            return _wait_for_service(prompt, startup_timeout, harness)
        finally:
            startup_mutex.close()
    return _wait_for_service(prompt, startup_timeout, harness)


def _restart_on_configured_root(prompt, startup_timeout, harness, expected_root):
    startup_mutex = ProcessMutex.try_acquire(f"startup-{_port()}")
    if startup_mutex is None:
        # Another hook is already restarting it: wait for the RIGHT root, never inject the old one.
        return _wait_for_service(prompt, startup_timeout, harness, expected_root)
    try:
        try:
            _shutdown_server()
            _wait_for_shutdown()
            _spawn_server()
        except (HTTPError, ValueError, json.JSONDecodeError, URLError, TimeoutError, OSError):
            return ""
        return _wait_for_service(prompt, startup_timeout, harness, expected_root)
    finally:
        startup_mutex.close()


def _wait_for_service(prompt, startup_timeout, harness, expected_root=None):
    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline:
        try:
            if expected_root is not None and not _same_root(_request_health(), expected_root):
                return ""
            return _request_context(prompt, harness=harness)
        except HTTPError as exc:
            if exc.code != 503:
                return ""
            time.sleep(0.2)
        except (ValueError, json.JSONDecodeError):
            return ""
        except (URLError, TimeoutError, OSError):
            time.sleep(0.2)
    return ""


def hook_output(payload, query_fn=query_service):
    prompt = str(payload.get("prompt") or payload.get("user_message") or "").strip()
    if not prompt:
        return None
    context = query_fn(prompt)
    if not context:
        return None
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }


def main():
    try:
        # Stdin arrive en UTF-8, parfois BOMé par le wrapper PowerShell (.NET StreamWriter) ;
        # le décodage locale (cp1252) mangerait BOM et accents → lire binaire + utf-8-sig.
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
        output = hook_output(payload)
        if output:
            # ensure_ascii (défaut) : un stdout cp1252 lèverait UnicodeEncodeError sur
            # les caractères hors cp1252 des notes ; l'ASCII échappé passe partout.
            print(json.dumps(output))
    except Exception:
        pass  # Retrieval must never block the user's prompt.


if __name__ == "__main__":
    main()
