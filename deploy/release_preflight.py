#!/usr/bin/env python3
"""Refuse a release before backup/build can consume live service disk headroom."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

MIB = 1024 * 1024


def setting(name, fallback):
    raw = os.environ.get(name, str(fallback))
    if not raw.isdigit() or not 1 <= int(raw) <= 1024 * 1024:
        raise ValueError(f"{name} must be a positive integer MiB value")
    return int(raw) * MIB


def existing_parent(path):
    path = Path(path).resolve()
    while not path.exists():
        path = path.parent
    return path


def check_space(paths, minimum, backup_bytes=0, allocations=()):
    results = []
    # All named locations must be writable without using root-reserved blocks.
    # Do not add the same headroom repeatedly for directories on one filesystem.
    seen = set()
    for path in paths:
        parent = existing_parent(path)
        device = parent.stat().st_dev
        if device in seen:
            continue
        seen.add(device)
        stat = os.statvfs(parent)
        available = stat.f_bavail * stat.f_frsize
        planned = sum(size for target, size in allocations if existing_parent(target).stat().st_dev == device)
        required = minimum + backup_bytes + planned
        results.append({"path": str(parent), "availableMiB": available // MIB,
                        "requiredMiB": (required + MIB - 1) // MIB,
                        "plannedArchiveMiB": (planned + MIB - 1) // MIB, "ok": available >= required})
    return results


def pending_archive_size(repo, revision, archive):
    """Budget a gzip tar before it exists, without creating another archive.

    Uncompressed blob sizes plus tar/PAX headers and gzip expansion are a
    conservative upper bound, including incompressible checked-in media.
    """
    if not archive or Path(archive).exists():
        return 0
    if not re.fullmatch(r"[a-f0-9]{40}", revision or ""):
        raise ValueError("A pending release archive requires a full release revision")
    listing = subprocess.check_output(
        ["git", f"--git-dir={repo}", "ls-tree", "-rlz", revision],
        timeout=60
    )
    total = MIB
    for entry in listing.split(b"\0"):
        if not entry:
            continue
        metadata, filename = entry.split(b"\t", 1)
        fields = metadata.split()
        size = int(fields[3]) if fields[3] != b"-" else 0
        total += ((size + 511) // 512) * 512 + 2048 + len(filename) * 2
    return (total * 105 + 99) // 100


def latest_backup_size(root):
    candidates = [p for p in Path(root).glob("*/COMPLETE") if p.is_file()]
    if not candidates:
        return 512 * MIB
    last = max(candidates, key=lambda p: p.stat().st_mtime).parent
    files = [last / name for name in ("source.tgz", "storage.tar.gz", "aigc_drama.dump", "redis.rdb") if (last / name).is_file()]
    # Allow growth beyond the previous complete backup. This is a capacity
    # estimate, not a guarantee against unrelated writers on a shared disk.
    return max(128 * MIB, sum(p.stat().st_size for p in files) * 5 // 4)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--backups", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--phase", choices=("backup", "build", "activate"), required=True)
    parser.add_argument("--prebuilt", action="store_true")
    args = parser.parse_args()
    runtime = args.prebuilt or args.phase == "activate"
    minimum = setting("MANJIAO_MIN_RUNTIME_FREE_MB", 1024) if runtime else setting("MANJIAO_MIN_BUILD_FREE_MB", 6144)
    backup_bytes = latest_backup_size(args.backups) if args.phase == "backup" else 0
    docker_root = os.environ.get("MANJIAO_DOCKER_ROOT", "/var/lib/docker")
    archive = os.environ.get("MANJIAO_RELEASE_ARCHIVE")
    archive_bytes = pending_archive_size(args.repo, os.environ.get("MANJIAO_RELEASE"), archive) if args.phase == "backup" else 0
    paths = [args.app, args.backups, args.repo, docker_root] + ([archive] if archive else [])
    results = check_space(paths, minimum, backup_bytes, [(archive, archive_bytes)] if archive else [])
    print(json.dumps({"phase": args.phase, "prebuilt": args.prebuilt, "filesystems": results}))
    if not all(item["ok"] for item in results):
        raise SystemExit("DISK_PREFLIGHT_STOPPED: insufficient free space; archive unused releases or load the exact CI image before retrying. Live containers have not been replaced.")


if __name__ == "__main__":
    main()
