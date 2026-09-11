# Production deployment upgrade

This change preserves the existing `/opt/manjiao` Compose project and its
PostgreSQL, Redis, storage and web volumes. It does not baseline or reset the
production database. Do not use `docker compose down -v`, `prisma migrate reset`
or `--accept-data-loss` during this upgrade.

## First upgrade from the previous Git hook

1. Finish code review, local tests and the production image build. Merge the exact
   release into GitHub main. Confirm sufficient disk space for the source/data
   backup plus both old and new images. Keep at least one known-good image.
2. On the server, install `rsync`, `python3` and `util-linux` if missing. Verify
   `docker compose`, `git`, `curl`, `tar`, `sha256sum`, `mktemp` and `flock` work.
   The deployment user needs write access to the existing app, bare repository,
   `/opt/manjiao-backups` and `/opt/manjiao-deploy-logs`.
   A read-only check on 2026-09-12 found rsync, python3, flock, Docker, Git, curl,
   tar and sha256sum already installed, but the old hook still active. Skip the
   package-install command below when prerequisites are already present. This
   observation does not certify that the new release or hook is installed.
3. With no old deployment running, back up the existing bare repository's
   `hooks/post-receive`. Upload the reviewed `deploy/server_git_post_receive.sh`
   to a private temporary path, normalize CRLF, run `bash -n`, install it with
   mode 700 using an atomic rename into `hooks/post-receive`. **Do this before
   pushing the new release.** A file committed under `deploy/` does not replace
   an installed Git hook automatically. The new hook reads its helper from the
   target commit and retains the existing application until backup succeeds.
   The exact one-time commands from Windows PowerShell are:

   ```powershell
   ssh manjiao 'sudo apt-get update && sudo apt-get install -y rsync python3 util-linux'
   ssh manjiao 'sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" /opt/manjiao-backups /opt/manjiao-deploy-logs'
   if ($LASTEXITCODE -ne 0) { throw 'Could not prepare private deployment directories' }
   $hookStage = (& ssh manjiao 'mktemp -d /tmp/manjiao-hook.XXXXXXXX').Trim()
   if ($LASTEXITCODE -ne 0 -or $hookStage -notmatch '^/tmp/manjiao-hook\.[A-Za-z0-9]+$') { throw 'Could not create a private staging directory' }
   scp deploy/server_git_post_receive.sh deploy/install_git_hook.sh "manjiao:${hookStage}/"
   if ($LASTEXITCODE -ne 0) { throw 'Hook upload failed' }
   ssh manjiao "tr -d '\r' < '$hookStage/install_git_hook.sh' > '$hookStage/install.sh' && bash '$hookStage/install.sh' '$hookStage/server_git_post_receive.sh'"
   if ($LASTEXITCODE -ne 0) { throw 'Hook installation failed; do not deploy' }
   ```

   The installer archives the previous hook and atomically replaces it after
   syntax/prerequisite checks. It installs no application release. Stop any
   previous-generation deployment before installing: the old hook had no lock.
4. Use `pnpm deploy:server --check`, then `pnpm deploy:server`. A new Git commit
   builds a commit-tagged application image with FFmpeg and Chinese fonts. The
   release enables AOF on the existing live Redis instance and waits for its
   rewrite and writes to report healthy before replacing the Redis container
   with the same `redis_data` volume. This preserves queued writes that were
   not yet in an RDB snapshot. Failure stops before Redis replacement or schema
   sync. Never replace the old Redis container first merely to enable AOF.
   The database sync runs once as a release step without accepting data loss. If it
   rejects a schema change, stop and review the SQL on a restored test database.
5. Confirm the public `/ready` JSON is successful, its `revision` matches the
   GitHub commit, the `deployed` Git ref matches, and authenticated project,
   media preview, generation and export checks succeed. `/health` alone is not
   release acceptance.

## Failed releases and retry

Read `/opt/manjiao-deploy-logs`. A failed backup stops before app changes. A
failed build, schema sync, readiness check or web publication attempts source
rollback and verifies readiness before reporting recovery. `RECOVERY_FAILED`
requires operator attention and must not be called a successful rollback.

After the failure is repaired, run `pnpm deploy:server --retry` from the same
GitHub main commit. It pushes a unique `deploy-requests` ref so Git can trigger
the hook again even when server main already equals HEAD. The server only
accepts retry requests for its current main and serializes releases with flock.
The server main ref records accepted source; the deployed ref records a release
whose readiness check passed.

Source rollback does not undo database or customer-media writes. Before any
database recovery, restore the dump into an isolated database and verify it,
preserve the current production database, stop writes and make an explicit
recovery decision. Existing migrations have no full baseline; switching to
`prisma migrate deploy` requires a separate reviewed baselining exercise.

## Operating the new containers

Ordinary `docker compose restart api` runs the already-built image without
installing packages or changing schema. Before any manual `compose up`, export
the confirmed image revision:

```sh
export MANJIAO_RELEASE="$(git --git-dir=/opt/git/aigc-short-drama-factory.git rev-parse refs/heads/deployed)"
cd /opt/manjiao
docker compose -f docker-compose.prod.yml ps
```

Manual source rollback must set `MANJIAO_RELEASE` to the revision whose backup
is being restored, not the failed revision. Images are tagged by commit so an
available previous image can be reused without rebuilding. The first rollback
to legacy Compose overrides the API command to avoid its destructive schema
startup. Legacy dependency checks do not certify worker readiness.

Redis now uses AOF with a one-second fsync policy and no key eviction. This
reduces queue-loss exposure but is not a replacement for recovery testing.
The production Compose default `TRUST_PROXY=2` reflects Caddy → Nginx → API.
The API exposes no host port and Nginx binds to host loopback. Reassess trusted
proxy hops whenever changing this routing topology; setting an incorrect hop
count can group users under a proxy address or trust forged forwarding headers.
Private media is served through API authorization; Nginx no longer bypasses it.
Log rotation bounds container log size. Backup retention and off-host copies
remain operational tasks; do not remove the only known-good recovery point.

## Verification commands

```sh
python3 -m unittest discover -s deploy -p test_deployment.py -v
bash -n deploy/manjiao_remote.sh deploy/server_git_post_receive.sh deploy/backup_server_state.sh
sh -n deploy/ffmpeg_smoke.sh
pwsh -File deploy/test_redis_persistence.ps1
docker build -f deploy/Dockerfile -t manjiao-deployment-verify .
```

Fault tests run against temporary local Git repositories, real rsync/flock and
simulated Docker/HTTP. They prove deployment control flow and source integrity,
not a real database restore or a live supplier generation. The image build
includes an actual FFmpeg encoding smoke test. Perform full application and
database restore checks separately before commercial acceptance.

The Redis smoke test separately creates network-isolated containers and a new
temporary named volume, migrates unsnapshotted queue values to AOF, restarts
against that volume and checks queue order plus in-flight state. It cleans up
only its generated test resources; it never connects to production Redis.

Record the release using [the acceptance checklist](../docs/operations/release-acceptance.md),
including actual media, credits, Admin operations and an isolated restore. No
live supplier call or real database restore is implied by the fault tests.
