#!/usr/bin/env python3
"""Install hash-verified GitHub Git API objects and detached rehearsal worktrees.

Only a normal repository is accepted. Metadata is fetched by the authorized
GitHub connector and supplied as JSON; no credentials or network are used here.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import subprocess


def git_hash(kind, data):
    return hashlib.sha1(kind.encode() + b" " + str(len(data)).encode() + b"\0" + data).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--git-dir", required=True)
    p.add_argument("--metadata-dir", required=True)
    p.add_argument("--sources-dir", required=True)
    p.add_argument("--blob-batch")
    p.add_argument("--node")
    a = p.parse_args()
    g = pathlib.Path(a.git_dir).resolve()
    if not (g / "objects").is_dir() or not (g / "HEAD").is_file():
        raise SystemExit("A normal repository .git with objects and HEAD is required")
    meta = pathlib.Path(a.metadata_dir).resolve()
    sources = pathlib.Path(a.sources_dir).resolve()
    sources.mkdir(parents=True, exist_ok=True)

    def run(*args, data=None):
        return subprocess.check_output(["git", "--git-dir=" + str(g), *args], input=data)

    def install(kind, data, expected):
        actual = git_hash(kind, data)
        if actual != expected:
            raise ValueError((kind, expected, actual))
        written = run("hash-object", "-w", "-t", kind, "--stdin", data=data).decode().strip()
        assert written == expected

    if a.blob_batch:
        blobs = json.loads(pathlib.Path(a.blob_batch).read_text())
        for blob in blobs:
            assert blob["encoding"] == "base64", blob
            data = base64.b64decode(blob["content"])
            assert len(data) == blob["size"], (blob["sha"], len(data), blob["size"])
            install("blob", data, blob["sha"])
        print(json.dumps({"installedBlobs": len(blobs)}))
        return

    for node in ([a.node] if a.node else ["98e560a", "7eaa4aa", "a3e79e2", "46f4e8f"]):
        commit = json.loads((meta / (node + "-commit.json")).read_text())
        tree = json.loads((meta / (node + "-tree.json")).read_text())
        assert not tree.get("truncated")
        assert tree["sha"] == commit["tree"]["sha"]
        entries = tree["tree"]
        missing = []
        for entry in entries:
            if entry["type"] == "blob":
                check = subprocess.run(["git", "--git-dir=" + str(g), "cat-file", "-e", entry["sha"]], capture_output=True)
                if check.returncode:
                    missing.append(entry["path"])
        if missing:
            raise SystemExit("Missing blobs for " + node + ": " + ", ".join(missing))

        # Build raw trees bottom-up. The tree sort compares directory names
        # with a trailing slash, exactly as Git does.
        directories = {"": commit["tree"]["sha"]}
        directories.update({e["path"]: e["sha"] for e in entries if e["type"] == "tree"})
        for directory, expected in sorted(directories.items(), key=lambda e: e[0].count("/"), reverse=True):
            children = []
            for entry in entries:
                parent, _, name = entry["path"].rpartition("/")
                if parent == directory:
                    children.append((name, entry))
            children.sort(key=lambda n: (n[0] + ("/" if n[1]["type"] == "tree" else "")).encode())
            raw = b""
            for name, entry in children:
                mode = "40000" if entry["type"] == "tree" else entry["mode"]
                raw += mode.encode() + b" " + name.encode() + b"\0" + bytes.fromhex(entry["sha"])
            install("tree", raw, expected)

        verification = commit["verification"]
        payload = verification.get("payload")
        signature = verification.get("signature")
        if not payload or not signature:
            raise SystemExit("Exact signed commit payload required: " + node)
        header, separator, message = payload.partition("\n\n")
        assert separator
        # SSH signatures normally omit a final continuation line. GitHub's
        # PGP merge signatures retain it. Only an exact expected-hash match
        # is accepted, including the commit message's final newline.
        variants = []
        for sig in [signature.rstrip("\n"), signature]:
            signed_header = "gpgsig " + sig.replace("\n", "\n ")
            raw = (header + "\n" + signed_header + "\n\n" + message).encode()
            variants.extend([raw, raw + b"\n", raw.rstrip(b"\n")])
        matching = [v for v in variants if git_hash("commit", v) == commit["sha"]]
        if not matching:
            raise SystemExit("Signed commit hash cannot be reconstructed: " + node)
        install("commit", matching[0], commit["sha"])
        destination = sources / node
        if destination.exists():
            actual = subprocess.check_output(["git", "-C", str(destination), "rev-parse", "HEAD"]).decode().strip()
            assert actual == commit["sha"], (destination, actual, commit["sha"])
        else:
            run("worktree", "add", "--detach", str(destination), commit["sha"])
        actual_tree = subprocess.check_output(["git", "-C", str(destination), "rev-parse", "HEAD^{tree}"]).decode().strip()
        assert actual_tree == commit["tree"]["sha"]
        status = subprocess.check_output(["git", "-C", str(destination), "status", "--porcelain"]).decode()
        assert not status, (node, status)
        receipt = {"short": node, "commitSha": commit["sha"], "treeSha": actual_tree, "path": str(destination),
                   "source": commit["url"], "blobCount": sum(e["type"] == "blob" for e in entries),
                   "verification": "Every blob/tree and exact signed commit reproduced by Git SHA-1",
                   "gitHubSignatureVerified": verification["verified"], "dependencies": "pending npm ci"}
        (meta / (node + "-receipt.json")).write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)


if __name__ == "__main__":
    main()
