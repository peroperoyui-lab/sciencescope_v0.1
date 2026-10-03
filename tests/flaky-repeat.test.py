"""Wrapper-only checks; never launch a surveyed DSH, browser, or paid item.

Run with: python3 -B tests/flaky-repeat.test.py
"""

import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/evals/flaky-repeat.py"
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("flaky_repeat", SCRIPT)
REPEAT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPEAT)


def tap(tests=1, passed=1, failed=0, cancelled=0, skipped=0, todo=0, plan=True):
    return ("TAP version 13\nok 1 - fixture\n" + ("1..1\n" if plan else "")
            + f"# tests {tests}\n# pass {passed}\n# fail {failed}\n"
            + f"# cancelled {cancelled}\n# skipped {skipped}\n# todo {todo}\n")


class WrapperSafety(unittest.TestCase):
    def setUp(self):
        base = ROOT / ".sciencescope-local/temp/dot"
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=base, prefix="flaky-repeat-unit-")
        self.directory = Path(self.temp.name)
        self.checkout = self.directory / "checkout"
        self.checkout.mkdir()
        self.base = self.checkout / ".sciencescope-local/temp/dot"

    def tearDown(self):
        self.temp.cleanup()

    def cli(self, *arguments):
        return subprocess.run([sys.executable, "-B", str(SCRIPT), *arguments], cwd=ROOT,
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def test_list_is_the_fixed_catalog(self):
        result = self.cli("--list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(result.stdout.splitlines()), 51)
        self.assertIn("browser:assistant-api-ui\tnode scripts/assistant-api-smoke.mjs --ui", result.stdout)

    def test_commands_and_extra_arguments_are_rejected(self):
        for args in (("node",), ("test:session-env", "--", "anything"),
                     ("test:session-env", "--command", "echo"),
                     ("live:runtime-hardening", "--live", "--long")):
            with self.subTest(args=args):
                self.assertEqual(self.cli(*args).returncode, 2)

    def test_rejected_values_never_echo(self):
        token = "secret-synthetic-token"
        for args in ((token,), ("test:session-env", "--", token),
                     ("test:session-env", "--attempts", token),
                     ("test:session-env", "--unknown", token)):
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn(token, result.stdout + result.stderr)

    def test_attempt_timeout_and_live_ceilings(self):
        for args in (("test:session-env", "--attempts", "29"),
                     ("test:session-env", "--timeout", "181"),
                     ("test:session-env", "--deadline", "10801"),
                     ("live:runtime-hardening",),
                     ("live:runtime-hardening", "--live", "--attempts", "31"),
                     ("smoke:chat-api", "--live")):
            with self.subTest(args=args):
                self.assertEqual(self.cli(*args).returncode, 2)

    def test_evidence_escape_base_and_overwrite_are_rejected(self):
        for path in (self.directory / "outside", self.base, self.base / "../../escape"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                REPEAT.evidence_directory(self.checkout, str(path), "test:session-env")
        target = self.base / "occupied"
        target.mkdir(parents=True)
        (target / "receipt.json").write_text("{}")
        with self.assertRaises(ValueError):
            REPEAT.evidence_directory(self.checkout, str(target), "test:session-env")

    def test_evidence_symlink_escape_is_rejected(self):
        self.base.mkdir(parents=True)
        (self.base / "escape").symlink_to(self.directory)
        with self.assertRaises(ValueError):
            REPEAT.evidence_directory(self.checkout, str(self.base / "escape/run"), "test:session-env")
        other = self.directory / "other"
        other.mkdir()
        alternate = self.directory / "alternate"
        alternate.mkdir()
        (alternate / ".sciencescope-local").symlink_to(other)
        with self.assertRaises(ValueError):
            REPEAT.evidence_directory(alternate, None, "test:session-env")

    def test_new_and_empty_evidence_paths_are_allowed(self):
        target = REPEAT.evidence_directory(self.checkout, None, "test:session-env")
        self.assertTrue(target.is_relative_to(self.base))
        self.assertEqual(REPEAT.evidence_directory(self.checkout, str(target), "test:session-env"), target)

    def test_source_aliases_never_read_the_owned_private_fixture(self):
        private = self.checkout / ".sciencescope-local/secret"
        private.mkdir(parents=True)
        target = private / "synthetic-private.mjs"
        target.write_text("synthetic fixture only")
        for ancestor_alias in (False, True):
            root = self.checkout / ("ancestor-alias" if ancestor_alias else "file-alias")
            root.mkdir()
            if ancestor_alias:
                (root / "scripts").symlink_to(private, target_is_directory=True)
            else:
                (root / "scripts").mkdir()
                (root / "scripts/runtime-hardening-live-smoke.mjs").symlink_to(target)
            with self.subTest(ancestor_alias=ancestor_alias), \
                    mock.patch.object(REPEAT, "git", side_effect=lambda root, *args:
                                      "dot/fixture" if args == ("branch", "--show-current") else "fixture"), \
                    mock.patch.object(Path, "read_text", side_effect=AssertionError("source text was read")), \
                    mock.patch.object(Path, "read_bytes", side_effect=AssertionError("source bytes were read")), \
                    self.assertRaises(ValueError):
                REPEAT.provenance(root, "live:runtime-hardening")

    def test_process_caches_are_local_and_credentials_are_not_inherited(self):
        # Values here are synthetic test fixtures, not real credentials.
        old = os.environ.get("FLAKY_REPEAT_SYNTHETIC_SECRET")
        os.environ["FLAKY_REPEAT_SYNTHETIC_SECRET"] = "synthetic-only"
        try:
            env = REPEAT.process_environment(self.directory, False)
            self.assertNotIn("FLAKY_REPEAT_SYNTHETIC_SECRET", env)
            self.assertNotIn("NODE_OPTIONS", env)
            for name in ("TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "npm_config_cache", "HOME"):
                self.assertTrue(Path(env[name]).is_relative_to(self.directory))
                self.assertTrue(Path(env[name]).is_dir())
        finally:
            if old is None:
                del os.environ["FLAKY_REPEAT_SYNTHETIC_SECRET"]
            else:
                os.environ["FLAKY_REPEAT_SYNTHETIC_SECRET"] = old

    def test_tap_pass_requires_a_complete_non_skipped_run(self):
        self.assertEqual(REPEAT.classify("test:session-env", 0, tap())["status"], "PASSED")
        for output, expected in ((tap(tests=2, passed=1, skipped=1), "SKIPPED"),
                                 (tap(passed=0, todo=1), "SKIPPED"),
                                 (tap(passed=0, cancelled=1), "UNFINISHED"),
                                 (tap(plan=False), "UNFINISHED"),
                                 ("ok 1 - fixture\n", "UNFINISHED"),
                                 (tap(tests=0, passed=0), "SKIPPED"),
                                 (tap(tests=2, passed=1), "UNFINISHED"),
                                 (tap() + "ok 2 - fixture # SKIP unavailable\n", "SKIPPED")):
            with self.subTest(output=output):
                self.assertEqual(REPEAT.classify("test:session-env", 0, output)["status"], expected)
        self.assertEqual(REPEAT.classify("test:session-env", 1, tap())["status"], "FAILED")
        self.assertEqual(REPEAT.classify("test:session-env", 0, tap(), True)["status"], "TIMEOUT")

    def test_known_pre_page_socket_failure_is_blocked(self):
        output = "browserType.launch: <launching> Chromium\nFATAL:platform_channel.cc: socketpair: Operation not permitted"
        self.assertEqual(REPEAT.classify("browser:chat-ui", 1, output)["status"], "ENV_BLOCKED")
        self.assertEqual(REPEAT.classify("smoke:chat-api", 1, output)["status"], "FAILED")
        self.assertEqual(REPEAT.classify("browser:chat-ui", 1, "application socket Permission denied")["status"], "FAILED")

    def test_live_receipt_must_verify_zero_to_two_requests(self):
        self.assertEqual(REPEAT.classify("live:runtime-hardening", 0, '{"paidRequests":2}')["paidRequests"], 2)
        zero = REPEAT.classify("live:runtime-hardening", 0, '{"paidRequests":0}')
        self.assertEqual(zero["paidRequests"], 0)
        self.assertEqual(zero["status"], "ENV_BLOCKED")
        timed_out = REPEAT.classify("live:runtime-hardening", -signal.SIGTERM, '{"paidRequests":1}', True)
        self.assertEqual(timed_out, {"status": "TIMEOUT", "paidRequests": 1})
        for output in ('{}', '{"paidRequests":3}', '{"paidRequests":true}',
                       '{"paidRequests":1}\n{"paidRequests":1}'):
            with self.subTest(output=output):
                self.assertEqual(REPEAT.classify("live:runtime-hardening", 0, output)["status"], "ENV_BLOCKED")
        self.assertEqual(REPEAT.classify("live:runtime-hardening", -signal.SIGTERM, "", True)["status"], "ENV_BLOCKED")

    def test_owned_process_group_cleanup(self):
        # One harmless Python fixture; this does not execute any catalog command.
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                                   cwd=self.directory, start_new_session=True)
        try:
            result = REPEAT.cleanup_group(process)
            self.assertTrue(result["needed"])
            self.assertTrue(result["termSent"])
            self.assertEqual(result["remaining"], 0)
            self.assertIsNotNone(process.returncode)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()

    def fixture_run(self, item, output, deadline=30):
        fixture = self.directory / "fixture.py"
        fixture.write_text("print(" + repr(output) + ")\n")
        evidence = self.directory / "evidence"
        evidence.mkdir()
        args = REPEAT.parser().parse_args(["test:session-env"])
        args.item = item
        args.timeout = 1
        args.deadline = deadline
        snapshot = {"head": "fixture", "branch": "dot/fixture", "trackedSourceSha256": "fixture"}
        with mock.patch.dict(REPEAT.CATALOG, {item: ("node", str(fixture))}), \
                mock.patch.object(REPEAT, "ROOT", self.directory), \
                mock.patch.object(REPEAT.shutil, "which", return_value=sys.executable), \
                contextlib.redirect_stdout(io.StringIO()):
            code = REPEAT.run(args, evidence, snapshot)
        return code, json.loads((evidence / "summary.json").read_text())

    def test_serial_thirty_attempts_and_compact_summary_using_python_fixture(self):
        code, summary = self.fixture_run("test:fixture", tap())
        self.assertEqual(code, 0)
        self.assertEqual(summary["attempted"], 30)
        self.assertEqual(summary["counts"]["PASSED"], 30)
        self.assertTrue(summary["completedRequestedAttempts"])
        self.assertTrue(summary["allAttemptsPassed"])
        self.assertNotIn("TAP version", json.dumps(summary))

    def test_failed_attempts_complete_the_survey_without_passing(self):
        code, summary = self.fixture_run("test:fixture", tap(passed=0, failed=1))
        self.assertEqual(code, 1)
        self.assertEqual(summary["counts"]["FAILED"], 30)
        self.assertTrue(summary["completedRequestedAttempts"])
        self.assertFalse(summary["allAttemptsPassed"])

    def test_blocked_browser_fixture_stops_after_one_attempt(self):
        output = "browserType.launch: <launching>\nFATAL:platform_channel.cc: AF_UNIX socket Operation not permitted"
        code, summary = self.fixture_run("browser:fixture", output)
        self.assertEqual(code, 1)
        self.assertEqual(summary["counts"]["ENV_BLOCKED"], 1)
        self.assertEqual(summary["attempted"], 1)
        self.assertEqual(summary["notAttempted"], 29)
        self.assertFalse(summary["completedRequestedAttempts"])
        self.assertFalse(summary["allAttemptsPassed"])

    def test_deadline_prevents_fixture_launch(self):
        code, summary = self.fixture_run("test:fixture", tap(), deadline=0.1)
        self.assertEqual(code, 1)
        self.assertEqual(summary["attempted"], 0)
        self.assertEqual(summary["stoppedReason"], "DEADLINE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
