"""Ephemeral Amitel Brain recall for Hermes prompts."""
import ast
import importlib.util
import json
import os
import sys
import threading
from pathlib import Path

_MODULE_LOCK = threading.Lock()
_HOOK_MODULE = None
_HOOK_PATH = None


def _configured_paths() -> tuple[Path, Path]:
    root = os.environ.get("AMITEL_BRAIN_ROOT")
    code_root = os.environ.get("AMITEL_BRAIN_CODE_ROOT")
    python = os.environ.get("AMITEL_BRAIN_PYTHON")
    local = os.environ.get("LOCALAPPDATA")
    config_path = Path(local) / "AmitelBrain" / "config.json" if local else None
    if config_path and config_path.is_file():
        config = json.loads(config_path.read_text(encoding="utf-8"))
        root = root or config.get("brain_root")
        code_root = code_root or config.get("code_root")
        python = python or config.get("python")
    if not isinstance(root, str) or not root.strip():
        raise RuntimeError("Amitel Brain is not configured")
    if not isinstance(code_root, str) or not code_root.strip():
        raise RuntimeError("Amitel Brain local runtime is not configured")
    os.environ["AMITEL_BRAIN_ROOT"] = root
    os.environ["AMITEL_BRAIN_CODE_ROOT"] = code_root
    if isinstance(python, str) and python.strip():
        os.environ["AMITEL_BRAIN_PYTHON"] = python
    return Path(root), Path(code_root)


def _local_dependencies(module_path: Path) -> list[str]:
    """Local modules `module_path` imports at top level, dependencies first.

    Derived from the source, never listed by hand: a hand-written list (brain_auth only)
    missed `brain_singleton` when brain_hook gained it, and Hermes recall failed with
    ModuleNotFoundError, swallowed by _pre_llm_call — an empty recall with no message.
    """
    ordered: list[str] = []
    visiting: set[str] = set()

    def visit(path: Path) -> None:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            elif isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            else:
                continue
            for name in names:
                candidate = module_path.with_name(f"{name}.py")
                if "." in name or name in ordered or name in visiting or not candidate.is_file():
                    continue
                visiting.add(name)
                visit(candidate)
                ordered.append(name)

    visit(module_path)
    return ordered


def _load_hook_module():
    global _HOOK_MODULE, _HOOK_PATH
    _, code_root = _configured_paths()
    hook_path = code_root / "brain_hook.py"
    with _MODULE_LOCK:
        if _HOOK_MODULE is not None and _HOOK_PATH == hook_path:
            return _HOOK_MODULE
        # Every dependency is loaded by explicit path from the LOCAL runtime, never through
        # sys.path: a shared brain must not be able to substitute one of them.
        specs = []
        for name in _local_dependencies(hook_path):
            dep_spec = importlib.util.spec_from_file_location(name, hook_path.with_name(f"{name}.py"))
            specs.append((name, dep_spec))
        spec = importlib.util.spec_from_file_location("_amitel_brain_local_hook", hook_path)
        if spec is None or spec.loader is None or any(s is None or s.loader is None for _, s in specs):
            raise RuntimeError(f"cannot load Amitel Brain hook dependencies from: {hook_path.parent}")
        module = importlib.util.module_from_spec(spec)
        previous = {name: sys.modules.get(name) for name, _ in specs}
        try:
            for name, dep_spec in specs:
                dep_module = importlib.util.module_from_spec(dep_spec)
                sys.modules[name] = dep_module
                dep_spec.loader.exec_module(dep_module)
            spec.loader.exec_module(module)
        finally:
            for name, earlier in previous.items():
                if earlier is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = earlier
        _HOOK_MODULE = module
        _HOOK_PATH = hook_path
        return module


def _query_context(user_message: str) -> str:
    return _load_hook_module().query_service(user_message)


def _pre_llm_call(**kwargs):
    user_message = kwargs.get("user_message")
    if not isinstance(user_message, str) or not user_message.strip():
        return None
    try:
        context = _query_context(user_message)
    except Exception:
        return None
    return {"context": context} if context else None


def register(ctx) -> None:
    ctx.register_hook("pre_llm_call", _pre_llm_call)
