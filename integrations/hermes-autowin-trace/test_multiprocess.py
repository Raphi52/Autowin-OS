from __future__ import annotations

import importlib.util
import json
import multiprocessing
import os
import tempfile
import unittest
from pathlib import Path

PLUGIN = Path(__file__).with_name("__init__.py")


def _write_events(parent: str, worker: int) -> None:
    os.environ["AUTOWIN_HERMES_TRACE_DIR"] = parent
    spec = importlib.util.spec_from_file_location(f"autowin_trace_{worker}", PLUGIN)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module._MAX_SPOOL_BYTES = 2_000
    for index in range(40):
        module.on_pre_api_request(
            request={"body": {"messages": [{"content": f"worker-{worker}-event-{index}-" + "x" * 80}]}},
            session_id=f"worker-{worker}",
            api_request_id=f"{worker}:{index}",
        )


class MultiprocessSpoolTest(unittest.TestCase):
    def test_concurrent_rotation_stays_parseable_and_bounded(self) -> None:
        with tempfile.TemporaryDirectory(prefix="autowin-hermes-multiprocess-") as parent:
            processes = [multiprocessing.Process(target=_write_events, args=(parent, worker)) for worker in range(4)]
            for process in processes:
                process.start()
            for process in processes:
                process.join(20)
                self.assertEqual(process.exitcode, 0)

            root = Path(parent) / "hermes-trace-spool"
            files = [path for path in (root / "events.previous.jsonl", root / "events.jsonl") if path.exists()]
            self.assertTrue(files)
            self.assertLessEqual(sum(path.stat().st_size for path in files), 4_500)
            events = [json.loads(line) for path in files for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertTrue(events)
            self.assertEqual(len({event["api_request_id"] for event in events}), len(events))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    unittest.main()
