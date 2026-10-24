"""Isolated Linux deployment fault tests; Docker/HTTP are mocked, Git/rsync/flock are real."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from release_preflight import check_space, latest_backup_size, MIB

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "deploy/manjiao_remote.sh"
HOOK = ROOT / "deploy/server_git_post_receive.sh"
REQUIRED = ("bash", "git", "rsync", "flock", "python3", "tar", "sha256sum")


@unittest.skipUnless(all(shutil.which(tool) for tool in REQUIRED), "Linux deployment tools are required")
class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="manjiao-deploy-test-")
        self.base = Path(self.temp.name)
        self.app = self.base / "app"
        self.repo = self.base / "repo"
        self.bin = self.base / "bin"
        for directory in (self.app, self.repo, self.bin):
            directory.mkdir()
        self.events = self.base / "events"
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        TEST_EVENTS=str(self.events), TEST_APP=str(self.app),
                        TEST_COUNT=str(self.base / "build-count"),
                        MANJIAO_REPO_DIR=str(self.repo / ".git"), MANJIAO_APP_DIR=str(self.app),
                        MANJIAO_BACKUP_ROOT=str(self.base / "backups"),
                        MANJIAO_LOG_ROOT=str(self.base / "logs"),
                        MANJIAO_MIN_BUILD_FREE_MB="1", MANJIAO_MIN_RUNTIME_FREE_MB="1",
                        MANJIAO_REDIS_PERSISTENCE_ATTEMPTS="1",
                        MANJIAO_READY_ATTEMPTS="1", MANJIAO_READY_INTERVAL="0")
        self.shim("docker", r'''#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_EVENTS"
case "$*" in
  'image inspect '*)
    if [ "${TEST_PREBUILT:-}" = true ]; then printf '%s' "$MANJIAO_RELEASE"; else exit 1; fi;;
  *pg_dump*)
    [ "${TEST_FAIL:-}" != backup ] || exit 41
    printf 'TEST_CUSTOM_DUMP';;
  *pg_restore*) cat >/dev/null; [ "${TEST_FAIL:-}" != dump_validation ] || exit 43;;
  *'redis-cli --raw CONFIG SET'*)
    if [ "${TEST_FAIL:-}" = redis_config ]; then printf 'ERR CONFIG disabled'; else printf 'OK'; fi;;
  *'redis-cli --raw INFO persistence'*)
    if [ "${TEST_FAIL:-}" = redis_rewrite ]; then printf 'aof_enabled:1\naof_rewrite_in_progress:1\n';
    else printf 'loading:0\naof_enabled:1\naof_rewrite_in_progress:0\naof_rewrite_scheduled:0\naof_last_bgrewrite_status:ok\naof_last_write_status:ok\n'; fi;;
  *db:push:deploy*) [ "${TEST_FAIL:-}" != schema ] || exit 44;;
  *'tar -czf - storage'*)
    if [ "${TEST_FAIL:-}" = storage ]; then printf 'corrupt'; else tar -czf - -C "$TEST_APP" storage; fi;;
  *'build api'*)
    count=0; [ ! -f "$TEST_COUNT" ] || count="$(cat "$TEST_COUNT")"
    count=$((count+1)); printf '%s' "$count" > "$TEST_COUNT"
    if [ "${TEST_FAIL:-}" = recovery ] || { [ "${TEST_FAIL:-}" = rebuild ] && [ "$count" = 1 ]; }; then exit 42; fi;;
esac
''')
        self.shim("curl", r'''#!/usr/bin/env bash
printf 'readiness %s\n' "$*" >> "$TEST_EVENTS"
if [ -n "${TEST_READY_BODY:-}" ]; then printf '%s' "$TEST_READY_BODY"; else printf '{"ok":true,"revision":"%s"}' "${MANJIAO_RELEASE:-local}"; fi
''')
        self.write_app(self.app, "old")
        self.write_app(self.repo, "old")
        self.git("init", "--initial-branch=main", cwd=self.repo)
        self.git("config", "user.name", "Deployment Test", cwd=self.repo)
        self.git("config", "user.email", "deployment-test@example.invalid", cwd=self.repo)
        self.git("add", ".", cwd=self.repo)
        self.git("commit", "-qm", "old release", cwd=self.repo)
        self.old = self.git("rev-parse", "HEAD", cwd=self.repo)
        self.git("update-ref", "refs/heads/deployed", self.old, cwd=self.repo)
        (self.repo / "obsolete.txt").unlink()
        (self.repo / "version.txt").write_text("new")
        self.git("add", "-A", cwd=self.repo)
        self.git("commit", "-qm", "new release", cwd=self.repo)
        self.new = self.git("rev-parse", "HEAD", cwd=self.repo)
        (self.app / ".env.production").write_text("PRESERVE_TEST_VALUE=1\n")
        (self.app / "storage").mkdir()
        (self.app / "storage/customer.txt").write_text("persistent media")

    def tearDown(self):
        self.doCleanups()
        self.temp.cleanup()

    def shim(self, name, source):
        target = self.bin / name
        target.write_text(source)
        target.chmod(0o755)

    def write_app(self, directory, version):
        (directory / "deploy").mkdir()
        shutil.copyfile(HELPER, directory / "deploy/manjiao_remote.sh")
        shutil.copyfile(ROOT / "deploy/release_preflight.py", directory / "deploy/release_preflight.py")
        (directory / "deploy/Dockerfile").write_text("# test image marker\n")
        (directory / "package.json").write_text('{"name":"fixture"}')
        (directory / "docker-compose.prod.yml").write_text("services: {}\n")
        (directory / "version.txt").write_text(version)
        (directory / "obsolete.txt").write_text("remove in next release")

    def git(self, *args, cwd=None):
        return subprocess.check_output(["git", *args], cwd=cwd or self.repo, env=self.env, text=True).strip()

    def run_helper(self, command, *, extra_env=None, backup=None):
        return subprocess.run(["bash", str(HELPER), command, str(self.app), str(backup or self.base / "backup")],
                              env=self.env | (extra_env or {}), text=True, capture_output=True)

    def run_hook(self, *, extra_env=None, ref="refs/heads/main"):
        return subprocess.run(["bash", str(HOOK)], input=f"{self.old} {self.new} {ref}\n",
                              env=self.env | (extra_env or {}), text=True, capture_output=True)

    def deployed(self):
        return self.git("rev-parse", "refs/heads/deployed")

    def root_owned_runtime_fixture(self):
        # Run rsync as an ordinary release user against actual root-owned files.
        # sudo is restricted to freshly created paths inside this test directory.
        if not hasattr(os, "geteuid") or os.geteuid() == 0 or not shutil.which("sudo"):
            self.skipTest("Root-owned legacy fixture needs an unprivileged Linux user with sudo")
        if subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode:
            self.skipTest("Root-owned legacy fixture needs passwordless sudo")
        files = {
            ".pnpm-store/v11/files/legacy.bin": "cached dependency",
            "apps/api/dist/storage/customer-upload.bin": "legacy customer media",
            "apps/web/dist/assets/legacy.js": "live browser bundle",
            "packages/shared/dist/index.js": "live shared module",
        }
        roots = [self.app / name for name in (".pnpm-store", "apps/api/dist", "apps/web/dist", "packages/shared/dist")]
        for name, content in files.items():
            target = self.app / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        for root in roots:
            self.assertTrue(root.resolve().is_relative_to(self.base.resolve()))
            for target in [*root.rglob("*"), root]:
                target.chmod(0o755 if target.is_dir() else 0o644)
        # Register cleanup before changing ownership so failed assertions are safe.
        def restore_ownership():
            for root in roots:
                if not root.resolve().is_relative_to(self.base.resolve()) or root.is_symlink():
                    raise AssertionError("Refusing fixture cleanup outside its temporary directory")
            subprocess.run(["sudo", "-n", "chown", "-R", f"{os.getuid()}:{os.getgid()}", "--", *map(str, roots)], check=True)
            for root in roots:
                for target in [root, *root.rglob("*")]:
                    target.chmod(0o755 if target.is_dir() else 0o644)
        self.addCleanup(restore_ownership)
        subprocess.run(["sudo", "-n", "chown", "-R", "0:0", "--", *map(str, roots)], check=True)
        for root in roots:
            self.assertEqual(root.stat().st_uid, 0)
            self.assertFalse(os.access(root, os.W_OK), "The release user must not be able to modify the runtime directory")
        # A broad storage exclusion would incorrectly skip this genuine source.
        for directory, version in ((self.app, "old storage service"), (self.repo, "new storage service")):
            source = directory / "apps/api/src/storage/service.js"
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(version)
        self.git("add", "apps/api/src/storage/service.js")
        self.git("commit", "-qm", "update storage source")
        self.new = self.git("rev-parse", "HEAD")
        return files

    def assert_runtime_fixture_preserved(self, files):
        for name, content in files.items():
            target = self.app / name
            self.assertEqual(target.read_text(), content)
            self.assertEqual(target.stat().st_uid, 0)
            self.assertEqual(target.stat().st_gid, 0)
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
        self.assertEqual((self.app / "storage/customer.txt").read_text(), "persistent media")
        self.assertEqual((self.app / ".env.production").read_text(), "PRESERVE_TEST_VALUE=1\n")

    def test_real_root_owned_legacy_outputs_survive_unprivileged_release(self):
        files = self.root_owned_runtime_fixture()
        result = self.run_hook()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.deployed(), self.new)
        self.assertEqual((self.app / "version.txt").read_text(), "new")
        self.assertEqual((self.app / "apps/api/src/storage/service.js").read_text(), "new storage service")
        self.assertFalse((self.app / "obsolete.txt").exists())
        self.assert_runtime_fixture_preserved(files)

    def test_real_root_owned_legacy_outputs_survive_unprivileged_rollback(self):
        files = self.root_owned_runtime_fixture()
        result = self.run_hook(extra_env={"TEST_FAIL": "rebuild"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("previous source readiness verified", result.stderr, result.stdout + result.stderr)
        self.assertEqual(self.deployed(), self.old)
        self.assertEqual((self.app / "version.txt").read_text(), "old")
        self.assertEqual((self.app / "apps/api/src/storage/service.js").read_text(), "old storage service")
        self.assertTrue((self.app / "obsolete.txt").exists())
        self.assert_runtime_fixture_preserved(files)

    def test_database_backup_failure_leaves_live_release_unchanged(self):
        result = self.run_hook(extra_env={"TEST_FAIL": "backup"})
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual((self.app / "version.txt").read_text(), "old")
        self.assertEqual(self.deployed(), self.old)
        self.assertFalse(list((self.base / "backups").rglob("COMPLETE")))
        self.assertNotIn("build api", self.events.read_text())

    def test_low_disk_stops_before_backup_build_and_live_source_changes(self):
        result = self.run_hook(extra_env={"MANJIAO_MIN_BUILD_FREE_MB": "1048576"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DISK_PREFLIGHT_STOPPED", result.stderr)
        self.assertEqual(self.deployed(), self.old)
        self.assertEqual((self.app / "version.txt").read_text(), "old")
        events = self.events.read_text() if self.events.exists() else ""
        self.assertNotIn("pg_dump", events)
        self.assertNotIn("build api", events)

    def test_verified_prebuilt_image_avoids_host_build_and_large_build_headroom(self):
        result = self.run_hook(extra_env={"TEST_PREBUILT": "true", "MANJIAO_MIN_BUILD_FREE_MB": "1048576"})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("REUSING_VERIFIED_RELEASE_IMAGE", result.stdout)
        self.assertNotIn("build api", self.events.read_text())
        self.assertEqual(self.deployed(), self.new)

    def test_corrupt_storage_backup_is_rejected(self):
        result = self.run_helper("backup", extra_env={"TEST_FAIL": "storage"})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.base / "backup/COMPLETE").exists())

    def test_invalid_database_archive_prevents_storage_backup(self):
        result = self.run_helper("backup", extra_env={"TEST_FAIL": "dump_validation"})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.base / "backup/COMPLETE").exists())
        self.assertNotIn("tar -czf - storage", self.events.read_text())

    def test_spa_or_false_readiness_cannot_certify_release(self):
        for body in ("<html>SPA fallback</html>", '{"ok":false}', '"ok":true'):
            result = self.run_helper("ready", extra_env={"TEST_READY_BODY": body})
            self.assertNotEqual(result.returncode, 0, body)

    def test_success_deletes_obsolete_code_and_preserves_customer_state(self):
        result = self.run_hook()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.deployed(), self.new)
        self.assertEqual((self.app / "version.txt").read_text(), "new")
        self.assertFalse((self.app / "obsolete.txt").exists())
        self.assertEqual((self.app / "storage/customer.txt").read_text(), "persistent media")
        self.assertIn("PRESERVE_TEST_VALUE", (self.app / ".env.production").read_text())
        backup = next((self.base / "backups").iterdir())
        self.assertTrue((backup / "COMPLETE").is_file())
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / "source.tgz").stat().st_mode & 0o777, 0o600)

    def test_missing_or_wrong_ready_revision_cannot_confirm_new_image(self):
        for body in ('{"ok":true}', '{"ok":true,"revision":"old-container"}'):
            result = self.run_helper("ready", extra_env={"TEST_READY_BODY": body, "MANJIAO_RELEASE": self.new})
            self.assertNotEqual(result.returncode, 0, body)
        result = self.run_helper("ready", extra_env={"TEST_READY_BODY": json.dumps({"ok": True, "revision": self.new}), "MANJIAO_RELEASE": self.new})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_failed_rebuild_restores_source_without_schema_downgrade(self):
        result = self.run_hook(extra_env={"TEST_FAIL": "rebuild"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("previous source readiness verified", result.stderr)
        self.assertEqual(self.deployed(), self.old)
        self.assertEqual((self.app / "version.txt").read_text(), "old")
        self.assertTrue((self.app / "obsolete.txt").exists())
        self.assertNotIn("db:push:deploy", self.events.read_text())

    def test_failed_rollback_is_not_reported_as_recovered(self):
        result = self.run_hook(extra_env={"TEST_FAIL": "recovery"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RECOVERY_FAILED", result.stderr)
        self.assertNotIn("previous source readiness verified", result.stderr)
        self.assertEqual(self.deployed(), self.old)

    def test_rejected_schema_change_rolls_back_without_reapplying_schema(self):
        result = self.run_hook(extra_env={"TEST_FAIL": "schema"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("previous source readiness verified", result.stderr)
        self.assertEqual(self.events.read_text().count("db:push:deploy"), 1)
        self.assertEqual((self.app / "version.txt").read_text(), "old")
        self.assertEqual(self.deployed(), self.old)

    def test_redis_configuration_failure_does_not_replace_redis_or_sync_schema(self):
        result = self.run_hook(extra_env={"TEST_FAIL": "redis_config"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Redis refused persistence setting", result.stdout)
        self.assertNotIn("--no-deps redis", self.events.read_text())
        self.assertNotIn("db:push:deploy", self.events.read_text())
        self.assertEqual(self.deployed(), self.old)

    def test_incomplete_redis_aof_rewrite_prevents_container_replacement(self):
        result = self.run_hook(extra_env={"TEST_FAIL": "redis_rewrite"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Redis AOF did not finish", result.stdout)
        self.assertNotIn("--no-deps redis", self.events.read_text())
        self.assertNotIn("db:push:deploy", self.events.read_text())
        self.assertEqual(self.deployed(), self.old)

    def test_redis_is_persisted_before_replacement_and_schema(self):
        result = self.run_hook()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        events = self.events.read_text()
        positions = [events.index(part) for part in ("pg_dump", "build api", "CONFIG SET appendonly yes", "INFO persistence", "--no-deps redis", "db:push:deploy")]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(events.count("INFO persistence"), 2)

    def test_same_commit_can_retry_after_failure(self):
        self.assertNotEqual(self.run_hook(extra_env={"TEST_FAIL": "backup"}).returncode, 0)
        ref = "refs/heads/deploy-requests/retry-test"
        self.git("update-ref", ref, self.new)
        result = self.run_hook(ref=ref)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.deployed(), self.new)
        self.assertEqual(self.git("for-each-ref", "--format=%(refname)", ref), "")

    def test_foreign_commit_request_cannot_deploy(self):
        self.git("update-ref", "refs/heads/main", self.old)
        result = self.run_hook(ref="refs/heads/deploy-requests/stale")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing stale deployment", result.stderr)
        self.assertEqual((self.app / "version.txt").read_text(), "old")

    def test_held_deployment_lock_prevents_any_application_mutation(self):
        lock = self.repo / ".git/manjiao-deploy.lock"
        held = self.base / "held"
        process = subprocess.Popen(["bash", "-c", 'exec 8>"$1"; flock 8; touch "$2"; sleep 10', "lock", str(lock), str(held)], env=self.env)
        try:
            import time
            deadline = time.monotonic() + 3
            while not held.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(held.exists())
            result = self.run_hook(extra_env={"MANJIAO_DEPLOY_LOCK_TIMEOUT": "0"})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("holds the lock", result.stderr)
            self.assertEqual((self.app / "version.txt").read_text(), "old")
            self.assertFalse(self.events.exists())
        finally:
            process.terminate()
            process.wait(timeout=3)

    def test_hook_install_is_atomic_and_rejects_invalid_replacements(self):
        bare = self.base / "bare.git"
        self.git("init", "--bare", "--initial-branch=main", str(bare))
        old_hook = bare / "hooks/post-receive"
        old_hook.write_text("#!/bin/sh\necho old-hook\n")
        env = self.env | {"MANJIAO_REPO_DIR": str(bare)}
        installer = ROOT / "deploy/install_git_hook.sh"
        result = subprocess.run(["bash", str(installer), str(HOOK)], env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(old_hook.read_text(), HOOK.read_text())
        self.assertEqual(old_hook.stat().st_mode & 0o777, 0o700)
        backups = list((bare / "hooks-backups").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertIn("old-hook", backups[0].read_text())
        bad_hook = self.base / "invalid-hook"
        bad_hook.write_text("#!/bin/bash\nif\n")
        result = subprocess.run(["bash", str(installer), str(bad_hook)], env=env, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(old_hook.read_text(), HOOK.read_text())


class DeploymentContractTests(unittest.TestCase):
    def test_disk_guard_uses_unprivileged_available_space_and_deduplicates_mounts(self):
        with tempfile.TemporaryDirectory() as folder:
            # Root-reserved space must not be counted as available to deployment.
            stat = SimpleNamespace(f_bavail=100, f_bfree=200, f_frsize=MIB)
            with patch("release_preflight.os.statvfs", return_value=stat):
                checks = check_space([folder, str(Path(folder) / "not-created")], 90 * MIB, 20 * MIB)
            self.assertEqual(len(checks), 1)
            self.assertFalse(checks[0]["ok"])
            self.assertEqual(checks[0]["availableMiB"], 100)
            self.assertEqual(checks[0]["requiredMiB"], 110)

    def test_backup_capacity_estimate_ignores_partial_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            partial = Path(folder) / "partial"
            partial.mkdir()
            (partial / "source.tgz.partial").write_bytes(b"x")
            self.assertEqual(latest_backup_size(folder), 512 * MIB)
            complete = Path(folder) / "complete"
            complete.mkdir()
            for name in ("source.tgz", "storage.tar.gz", "aigc_drama.dump"):
                (complete / name).write_bytes(b"data")
            (complete / "COMPLETE").touch()
            self.assertEqual(latest_backup_size(folder), 128 * MIB)

    def test_restarts_do_not_apply_schema_and_schema_sync_rejects_data_loss(self):
        package = json.loads((ROOT / "apps/api/package.json").read_text())
        self.assertNotIn("--accept-data-loss", package["scripts"]["db:push:deploy"])
        compose = (ROOT / "docker-compose.prod.yml").read_text()
        self.assertNotIn("db:push", compose)
        self.assertIn('command: ["node", "apps/api/dist/server.js"]', compose)
        self.assertIn("APP_REVISION:", compose)


if __name__ == "__main__":
    unittest.main()
