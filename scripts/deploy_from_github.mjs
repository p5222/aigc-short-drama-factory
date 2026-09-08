import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Publish the exact GitHub main commit through the existing server Git hook.
// Use `pnpm deploy:server --check` to inspect readiness without deploying.
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const checkOnly = args.length === 1 && args[0] === "--check";
const server = process.env.MANJIAO_GIT_REMOTE || "ssh://manjiao-git/opt/git/aigc-short-drama-factory.git";

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed (exit ${result.status}).`);
  return result.stdout.trim();
}

try {
  if (args.length && !checkOnly) throw new Error("Usage: pnpm deploy:server [--check]");
  if (git("status", "--porcelain", "--untracked-files=no")) {
    throw new Error("Commit or stash tracked changes before deploying. Only committed files are deployed.");
  }
  const head = git("rev-parse", "HEAD");
  git("fetch", "origin", "refs/heads/main");
  const githubMain = git("rev-parse", "FETCH_HEAD");
  if (head !== githubMain) {
    throw new Error("HEAD is not GitHub main. Merge your PR, then switch to main and git pull --ff-only origin main.");
  }
  const refs = git("ls-remote", server, "refs/heads/main", "refs/heads/deployed");
  const serverMain = refs.split("\n").find(line => line.endsWith("\trefs/heads/main"))?.split(/\s+/)[0];
  const deployed = refs.split("\n").find(line => line.endsWith("\trefs/heads/deployed"))?.split(/\s+/)[0];
  if (!serverMain) throw new Error("Server main is missing; check the server Git URL and SSH authorization.");
  console.log(`GitHub main: ${head}\nServer main: ${serverMain}\nDeployed: ${deployed || "unknown"}`);
  if (checkOnly) {
    console.log("CHECK_OK: GitHub commit and server access verified. No deployment performed; builds and health were not checked.");
  } else {
    if (serverMain === head && deployed !== head) {
      throw new Error("Server main already points here but deployment is unconfirmed. A repeated push will not rerun the hook; inspect the deployment log on the server.");
    }
    if (deployed !== head || serverMain !== head) {
      const pnpmCli = process.env.npm_execpath;
      if (!pnpmCli) throw new Error("Run through pnpm deploy:server so the local verification commands can run.");
      for (const command of [
        ["install", "--frozen-lockfile"],
        ["--filter", "@aifilm/api", "db:generate"],
        ["--filter", "@aifilm/shared", "build"],
        ["test"], ["typecheck"], ["build"]
      ]) {
        const result = spawnSync(process.execPath, [pnpmCli, ...command], { stdio: "inherit" });
        if (result.error || result.status !== 0) throw new Error(`Verification failed: pnpm ${command.join(" ")}`);
      }
      if (git("rev-parse", "HEAD") !== head || git("status", "--porcelain", "--untracked-files=no")) {
        throw new Error("Tracked files or HEAD changed during verification; deployment stopped.");
      }
      if (git("ls-remote", "origin", "refs/heads/main").split(/\s+/)[0] !== head) {
        throw new Error("GitHub main changed during verification. Update and retry.");
      }
      // No force: divergent server history is rejected by Git.
      git("push", server, `${head}:refs/heads/main`);
    }
    if (git("ls-remote", server, "refs/heads/deployed").split(/\s+/)[0] !== head) {
      throw new Error("Push completed but the server did not confirm deployment. Inspect /tmp/manjiao_git_deploy_<commit>.log.");
    }
    const response = await fetch("https://manjiao.cloud/health", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Deployment commit confirmed, but public health returned ${response.status}.`);
    console.log(`DEPLOY_OK ${head} https://manjiao.cloud (health ${response.status})`);
  }
} catch (error) {
  console.error(`DEPLOY_STOPPED: ${error.message}`);
  process.exitCode = 1;
}
