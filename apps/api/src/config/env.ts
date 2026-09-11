import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

function findWorkspaceRoot(start = process.cwd()) {
  let current = resolve(start);
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start, "../..");
}

const workspaceRoot = findWorkspaceRoot();
const isProduction = process.env.NODE_ENV === "production";
const envFiles = isProduction
  ? [resolve(workspaceRoot, ".env.production"), resolve(process.cwd(), ".env.production")]
  : [
      resolve(workspaceRoot, ".env"),
      resolve(process.cwd(), ".env"),
      resolve(workspaceRoot, ".env.local"),
      resolve(process.cwd(), ".env.local")
    ];

// Isolated integration tests must never inherit developer provider keys or a remote DB.
for (const envFile of process.env.AIFILM_LOAD_ENV_FILES === "false" ? [] : envFiles) {
  if (existsSync(envFile)) dotenv.config({ path: envFile, override: !isProduction, quiet: true });
}

