#!/usr/bin/env python3
"""Serial, bounded replay of one B-survey item. No shell or extra test arguments.

Usage: python3 scripts/evals/flaky-repeat.py --list
       python3 scripts/evals/flaky-repeat.py test:session-env
       python3 scripts/evals/flaky-repeat.py live:runtime-hardening --live
Only the last form can make paid requests (30 attempts, at most 60 requests).
Evidence and process-local caches stay under .sciencescope-local/temp/dot.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
TESTS = (
    "chat-branch-runtime credential-isolation dsh-production-retry "
    "expert-approval-runtime expert-discussion-runtime hybrid-live-runtime "
    "provider-failure-surface reasoning-effort-wire research-tools-runtime "
    "role-prompt-runtime secret-isolation-runtime session-env "
    "session-fork-runtime tool-preamble-runtime discussion-api"
).split()
SMOKES = "assistant-api chat-api dsh-goal dsh-reopen dsh-stream skills-runtime dsh-approval".split()
BROWSERS = (
    "dsh-retry-ui secret-isolation-ui background-chat chat-branch-ui chat-ui "
    "context-access-ui creation-details deliverables desktop-interaction "
    "desktop-navigation discussion-ui extensions-ui failed-send-draft features "
    "i18n marks-ui minutes python-env-ui research-base-ui research-input-ui "
    "semantic-ui settings-ui shortcuts-ui summary-policy-ui viewer-ui "
    "workbench-ui workspace-ui"
).split()
CATALOG = {
    **{f"test:{name}": ("node", "--test", "--test-concurrency=1", "--test-reporter=tap",
                           f"tests/{name}.test.mjs") for name in TESTS},
    **{f"smoke:{name}": ("node", f"scripts/{name}-smoke.mjs") for name in SMOKES},
    **{f"browser:{name}": ("node", f"scripts/{name}-smoke.mjs") for name in BROWSERS},
    "browser:assistant-api-ui": ("node", "scripts/assistant-api-smoke.mjs", "--ui"),
    "live:runtime-hardening": ("node", "scripts/runtime-hardening-live-smoke.mjs", "--live"),
}
STATUSES = ("PASSED", "FAILED", "SKIPPED", "UNFINISHED", "TIMEOUT", "ENV_BLOCKED", "CLEANUP_FAILED")


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "flaky-repeat: invalid or unsafe options; use --help for the catalog and limits\n")


def parser():
    result = SafeArgumentParser(description=__doc__, allow_abbrev=False)
    result.add_argument("item", nargs="?", choices=sorted(CATALOG))
    result.add_argument("--list", action="store_true", help="list fixed commands without executing")
    result.add_argument("--attempts", type=int, default=30, help="serial attempts, at least 30; live is exactly 30")
    result.add_argument("--timeout", type=float, default=180, help="seconds per attempt, at most 180")
    result.add_argument("--deadline", type=float, default=10800, help="total seconds including cleanup, at most 10800")
    result.add_argument("--evidence-dir", help="empty or new directory strictly beneath checkout .sciencescope-local/temp/dot")
    result.add_argument("--live", action="store_true", help="explicitly permit the fixed paid smoke only")
    return result


def validate(args):
    if not args.item:
        raise ValueError("choose exactly one catalog item")
    if args.attempts < 30:
        raise ValueError("at least 30 attempts are required")
    if not 0 < args.timeout <= 180 or not 0 < args.deadline <= 10800:
        raise ValueError("timeout must be in (0, 180], deadline in (0, 10800]")
    live = args.item.startswith("live:")
    if live and (not args.live or args.attempts != 30):
        raise ValueError("paid replay requires --live and exactly 30 attempts (at most 60 requests)")
    if args.live and not live:
        raise ValueError("--live is only valid for live:runtime-hardening")


def contained(path, parent):
    return path != parent and path.is_relative_to(parent)


def evidence_directory(root, supplied, item):
    root = root.resolve()
    base = root / ".sciencescope-local/temp/dot"
    if base.resolve() != base:
        raise ValueError("evidence base must not contain symlinks")
    candidate = Path(supplied) if supplied else base / (
        "flaky-repeat-" + item.replace(":", "-") + "-" + uuid.uuid4().hex[:12])
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve()
    if not contained(candidate, base):
        raise ValueError("evidence directory must resolve strictly beneath checkout .sciencescope-local/temp/dot")
    if candidate.exists() and (not candidate.is_dir() or any(candidate.iterdir())):
        raise ValueError("refusing to overwrite nonempty evidence directory")
    candidate.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Check again after creation; do not follow an escaped symlink destination.
    if candidate.resolve() != candidate or base.resolve() != base:
        raise ValueError("evidence directory changed during creation")
    return candidate


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_file(root, name):
    path = root / name
    if Path(name).is_absolute() or ".." in Path(name).parts or not contained(path, root):
        raise ValueError("source must stay inside the checkout")
    for part in (*reversed(path.parents), path):
        if part.is_symlink():
            raise ValueError("source files and ancestors must not be symlinks")
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("source must be a regular file")
    return path


def git(root, *arguments):
    return subprocess.check_output(["git", "-C", str(root), *arguments], text=True).strip()


def provenance(root, item):
    head = git(root, "rev-parse", "HEAD")
    branch = git(root, "branch", "--show-current")
    if not branch.startswith("dot/"):
        raise ValueError("replay is restricted to dot/ branches")
    files = [arg for arg in CATALOG[item] if arg.endswith(".mjs")]
    files += ["scripts/evals/flaky-repeat.py", "package.json", "package-lock.json"]
    if item.startswith("live:"):
        files += ["scripts/evals/context-live-harness.mjs"]
    paths = {name: source_file(root, name) for name in files}
    if item.startswith("live:"):
        smoke = paths[files[0]].read_text()
        # The vetted existing harness limits the short smoke to two requests.
        if not re.search(r"maxRequests\s*:\s*process\.argv\.includes\('--long'\)\s*\?\s*4\s*:\s*2", smoke):
            raise ValueError("paid smoke request ceiling changed; review required before replay")
        harness = paths[files[-1]].read_text()
        if "evidence.requests.length>=maxRequests" not in harness:
            raise ValueError("paid harness request guard changed; review required before replay")
    hashes = {}
    for name in files:
        hashes[name] = sha256(paths[name])
    # Hash current tracked code, including dirty source, without reading local state,
    # credentials, environment values, or returning any source contents.
    tree = hashlib.sha256()
    for name in sorted(git(root, "ls-files", "-z").split("\0")):
        path = root / name
        if name and (name.startswith(("adapters/", "desktop/", "scripts/", "tests/", "src-tauri/"))
                     or name in ("package.json", "package-lock.json")):
            if path.suffix not in (".mjs", ".js", ".py", ".json", ".rs", ".toml", ".lock", ".css", ".html"):
                continue
            tree.update(name.encode() + b"\0" + bytes.fromhex(sha256(source_file(root, name))))
    for name, digest in sorted(hashes.items()):
        tree.update(name.encode() + b"\0" + bytes.fromhex(digest))
    return {"head": head, "branch": branch, "sourceSha256": hashes,
            "trackedSourceSha256": tree.hexdigest(), "command": list(CATALOG[item])}


def process_environment(directory, browser):
    paths = {"TMPDIR": "tmp", "TMP": "tmp", "TEMP": "tmp", "HOME": "home",
             "XDG_CACHE_HOME": "cache", "XDG_CONFIG_HOME": "config", "npm_config_cache": "npm-cache"}
    env = {"PATH": os.pathsep.join(os.get_exec_path()), "LANG": "C.UTF-8"}
    for key, name in paths.items():
        target = directory / name
        target.mkdir(mode=0o700, exist_ok=True)
        env[key] = str(target)
    # Only the browser executable setting is inherited. Do not copy credential or
    # NODE_OPTIONS environments into the replay process, or print any env values.
    if browser and "SCIENCESCOPE_BROWSER" in os.environ:
        env["SCIENCESCOPE_BROWSER"] = os.environ["SCIENCESCOPE_BROWSER"]
    return env


def group_members(pgid):
    """Linux non-zombie members of this wrapper-owned process group only."""
    members = []
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
                if int(fields[2]) == pgid and fields[0] != "Z":
                    members.append(int(entry.name))
            except (OSError, ValueError, IndexError):
                continue
    return members


def cleanup_group(process):
    result = {"needed": False, "termSent": False, "killSent": False, "remaining": 0}
    for sig, grace in ((signal.SIGTERM, 1), (signal.SIGKILL, 2)):
        if not group_members(process.pid):
            break
        result["needed"] = True
        try:
            os.killpg(process.pid, sig)
            result["termSent" if sig == signal.SIGTERM else "killSent"] = True
        except ProcessLookupError:
            break
        until = time.monotonic() + grace
        while group_members(process.pid) and time.monotonic() < until:
            time.sleep(0.05)
    process.poll()  # Reap our direct child; never kill unrelated processes.
    result["remaining"] = len(group_members(process.pid))
    return result


def classify(item, returncode, output, timed_out=False):
    result = {"status": "FAILED"}
    # Restrict this diagnosis to the known pre-page Chromium launch failure.
    if item.startswith("browser:") and re.search(
            r"(?:AF_UNIX|socketpair|\bsocket\b|CreatePlatformChannel|platform_channel)", output, re.I) and re.search(
            r"Operation not permitted|Permission denied|\bEPERM\b|\bEACCES\b", output, re.I) and re.search(
            r"browserType\.launch|Failed to launch|<launching>|FATAL:.*(?:socket|channel)", output, re.I):
        result["status"] = "ENV_BLOCKED"
        return result
    if timed_out:
        result["status"] = "TIMEOUT"
    elif item.startswith("test:"):
        counts = {key: int(value) for key, value in re.findall(
            r"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$", output, re.M)}
        result["tap"] = counts
        if returncode:
            return result
        if not all(key in counts for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo")) or not re.search(r"^1\.\.\d+\s*$", output, re.M):
            result["status"] = "UNFINISHED"
        elif counts["fail"] or counts["cancelled"]:
            result["status"] = "FAILED" if counts["fail"] else "UNFINISHED"
        elif counts["skipped"] or counts["todo"] or counts["tests"] == 0 or re.search(r"^\s*(?:not )?ok\b.*#\s*(?:SKIP|TODO)\b", output, re.M | re.I):
            result["status"] = "SKIPPED"
        elif counts["tests"] == counts["pass"] and counts["pass"] > 0:
            result["status"] = "PASSED"
        else:
            result["status"] = "UNFINISHED"
    elif returncode == 0:
        result["status"] = "PASSED"
    if item.startswith("live:"):
        receipts = []
        for line in output.splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, dict) and "paidRequests" in value:
                    receipts.append(value["paidRequests"])
            except ValueError:
                continue
        if len(receipts) != 1 or type(receipts[0]) is not int or not 0 <= receipts[0] <= 2:
            result["status"] = "ENV_BLOCKED"
            result["paidRequests"] = None
        else:
            result["paidRequests"] = receipts[0]
            if receipts[0] == 0 and result["status"] == "PASSED":
                result["status"] = "ENV_BLOCKED"  # No real-provider auth coverage.
    return result


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def run(args, directory, snapshot):
    started = time.monotonic()
    deadline = started + args.deadline
    attempts = []
    stop = None
    command = list(CATALOG[args.item])
    command[0] = shutil.which("node")
    if not command[0]:
        raise ValueError("node is not available")
    snapshot = {**snapshot, "command": command, "item": args.item,
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "requestedAttempts": args.attempts, "timeoutSeconds": args.timeout,
                "deadlineSeconds": args.deadline, "maxPaidRequests": 60 if args.live else 0}
    write_json(directory / "run.json", snapshot)
    print(json.dumps(snapshot, separators=(",", ":")), flush=True)
    try:
        for number in range(1, args.attempts + 1):
            # Reserve cleanup's maximum three seconds within the total deadline.
            remaining = deadline - time.monotonic() - 3
            if remaining <= 0:
                stop = "DEADLINE"
                break
            attempt_dir = directory / f"attempt-{number:03d}"
            attempt_dir.mkdir(mode=0o700)
            env = process_environment(attempt_dir, args.item.startswith("browser:"))
            attempt_start = time.monotonic()
            process = None
            timed_out = False
            interrupted = False
            launch_failed = False
            with (attempt_dir / "output.log").open("w") as log:
                try:
                    process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log,
                                               stderr=subprocess.STDOUT, start_new_session=True)
                    process.wait(timeout=min(args.timeout, remaining))
                except subprocess.TimeoutExpired:
                    timed_out = True
                except KeyboardInterrupt:
                    interrupted = True
                except OSError:
                    launch_failed = True
                finally:
                    cleanup = cleanup_group(process) if process else {"needed": False, "remaining": 0}
            output = (attempt_dir / "output.log").read_text(errors="replace")
            returncode = process.returncode if process else None
            result = classify(args.item, returncode, output, timed_out)
            if launch_failed:
                result["status"] = "ENV_BLOCKED"
            result.update({"attempt": number, "returncode": returncode, "timedOut": timed_out,
                           "elapsedSeconds": round(time.monotonic() - attempt_start, 3), "cleanup": cleanup})
            if cleanup["remaining"]:
                result["status"] = "CLEANUP_FAILED"
            if interrupted:
                result["status"] = "UNFINISHED"
                stop = "INTERRUPTED"
            attempts.append(result)
            write_json(attempt_dir / "receipt.json", result)
            print(f"{number}/{args.attempts} {result['status']} {result['elapsedSeconds']}s", flush=True)
            if stop or result["status"] in ("ENV_BLOCKED", "CLEANUP_FAILED"):
                stop = stop or result["status"]
                break
    except KeyboardInterrupt:
        stop = "INTERRUPTED"
    finally:
        counts = Counter(result["status"] for result in attempts)
        summary = {"item": args.item, "head": snapshot["head"], "branch": snapshot["branch"],
                   "trackedSourceSha256": snapshot["trackedSourceSha256"],
                   "requestedAttempts": args.attempts, "attempted": len(attempts),
                   "notAttempted": args.attempts - len(attempts), "stoppedReason": stop,
                   "counts": {status: counts[status] for status in STATUSES},
                   "timeouts": sum(result["timedOut"] for result in attempts),
                   "cleanupNeeded": sum(result["cleanup"]["needed"] for result in attempts),
                   "cleanupFailed": sum(bool(result["cleanup"]["remaining"]) for result in attempts),
                   "elapsedSeconds": round(time.monotonic() - started, 3),
                   "completedRequestedAttempts": len(attempts) == args.attempts,
                   "allAttemptsPassed": len(attempts) == args.attempts and counts["PASSED"] == args.attempts}
        if args.live:
            summary["maxPaidRequests"] = 60
            summary["paidRequests"] = sum(result.get("paidRequests") or 0 for result in attempts)
            summary["paidRequestCountVerified"] = all(result.get("paidRequests") is not None for result in attempts)
        write_json(directory / "summary.json", summary)
        print(json.dumps(summary, separators=(",", ":")), flush=True)
    return 0 if summary["allAttemptsPassed"] else 1


def main(argv=None):
    cli = parser()
    args = cli.parse_args(argv)
    if args.list:
        if args.item or args.live or args.evidence_dir:
            cli.error("--list does not accept an item, --live, or --evidence-dir")
        for item, command in sorted(CATALOG.items()):
            print(item + "\t" + " ".join(command))
        return 0
    try:
        validate(args)
        if sys.platform != "linux":
            raise ValueError("this wrapper requires Linux /proc and owned POSIX process groups")
        snapshot = provenance(ROOT, args.item)
        directory = evidence_directory(ROOT, args.evidence_dir, args.item)
        if subprocess.run(["git", "-C", str(ROOT), "check-ignore", "-q", "--", str(directory)],
                          check=False).returncode != 0:
            raise ValueError("evidence directory must be Git-ignored")
        return run(args, directory, snapshot)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # Errors contain paths/codes only; command output and env are never echoed.
        cli.error(str(error))


def terminate(signum, frame):
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate)
    sys.exit(main())
