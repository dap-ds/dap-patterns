// PR gate: when a pattern's TREE changed compared with <baseRef>, its item.version must be higher.
// Metadata-only changes (title, tags, description) need no bump. New patterns are fine.
//   node scripts/check-bump.mjs origin/main
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashTree } from "../shared/hash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseRef = process.argv[2] || "origin/main";
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const errors = [];
const dir = path.join(root, "patterns");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const now = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  let base;
  try { base = JSON.parse(git("show", `${baseRef}:patterns/${file}`)); } catch { console.log(`  ${file}: new pattern`); continue; }
  const treeChanged = hashTree(base.pattern) !== hashTree(now.pattern);
  const c = cmp(now.item.version, base.item.version);
  if (c < 0) errors.push(`${file}: version went DOWN (${base.item.version} -> ${now.item.version})`);
  else if (treeChanged && c === 0) errors.push(`${file}: the pattern tree changed but the version is still ${now.item.version}; bump "item.version" (semver)`);
  else console.log(`  ${file}: ${treeChanged ? `tree changed, ${base.item.version} -> ${now.item.version}` : "unchanged tree"}`);
}
if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join("\n")); process.exit(1); }
console.log(`✓ versions ok against ${baseRef}`);
