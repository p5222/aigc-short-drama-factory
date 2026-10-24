#!/usr/bin/env python3
"""Refuse a release before backup/build can consume live service disk headroom."""
import argparse
import json
import os
from pathlib import Path

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


def check_space(paths, minimum, backup_bytes=0):
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
        required = minimum + backup_bytes
        results.append({"path": str(parent), "availableMiB": available // MIB,
                        "requiredMiB": (required + MIB - 1) // MIB, "ok": available >= required})
    return results


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
    results = check_space([args.app, args.backups, args.repo, docker_root], minimum, backup_bytes)
    print(json.dumps({"phase": args.phase, "prebuilt": args.prebuilt, "filesystems": results}))
    if not all(item["ok"] for item in results):
        raise SystemExit("DISK_PREFLIGHT_STOPPED: insufficient free space; archive unused releases or load the exact CI image before retrying. Live containers have not been replaced.")


if __name__ == "__main__":
    main()
