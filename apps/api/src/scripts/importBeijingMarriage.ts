import { resolve } from "node:path";
import { importBeijingMarriage } from "../importers/beijingMarriage.js";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const manifestPath = resolve(argument("--manifest") ?? "../web/public/samples/beijing-marriage/manifest.json");
const userEmail = argument("--user-email") ?? process.env.MANJU_IMPORT_USER_EMAIL;
if (!userEmail && !process.argv.includes("--dry-run")) throw new Error("必须通过 --user-email 或 MANJU_IMPORT_USER_EMAIL 指定项目归属账号");

const report = await importBeijingMarriage({ manifestPath, userEmail: userEmail ?? "dry-run@example.com", dryRun: process.argv.includes("--dry-run") });
console.log(JSON.stringify(report));
