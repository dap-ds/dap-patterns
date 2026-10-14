#!/usr/bin/env node
// Takes an Export bundle ({ pattern, item }) from the Figma plugin into patterns/<id>.json.
//   node scripts/add-pattern.mjs <bundle.json> [--force]
// An existing id must get a HIGHER version when its tree changed (or --force). Runs the validator and rolls
// back on failure. (Contributors without a checkout can instead paste the bundle on github.com, see README.)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashTree } from "../shared/hash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const file = args.find((a) => !a.startsWith("--"));
const die = (m) => { console.error("✗ " + m); process.exit(1); };
if (!file) die("usage: add-pattern.mjs <bundle.json> [--force]");

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const { pattern, item } = raw.result ?? raw;
if (!pattern?.root || !item?.id) die("the file is not an export bundle ({ pattern, item })");
if (pattern.id !== item.id) die(`pattern.id "${pattern.id}" != item.id "${item.id}"`);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.id)) die(`invalid id "${item.id}"`);
if (!/^\d+\.\d+\.\d+$/.test(item.version ?? "")) die(`invalid version "${item.version}"`);

const target = path.join(root, "patterns", `${item.id}.json`);
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
if (previous && !force) {
  const old = JSON.parse(previous);
  const treeChanged = hashTree(old.pattern) !== hashTree(pattern);
  if (cmp(item.version, old.item.version) < 0 || (treeChanged && cmp(item.version, old.item.version) === 0)) {
    die(`"${item.id}" exists at v${old.item.version}; its tree changed, so the new version must be higher (got v${item.version}) or use --force`);
  }
}

// generated fields never belong in the file; keep curated metadata of an existing item the export does not carry
const { pattern: _p, uses: _u, treeHash: _h, ...meta } = item;
const old = previous ? JSON.parse(previous).item : {};
const merged = { ...old, ...meta, tags: meta.tags?.length ? meta.tags : old.tags ?? [], description: meta.description || old.description || "" };
const { $schema: _s, ...tree } = pattern;
fs.writeFileSync(target, JSON.stringify({ $schema: "../schema/bundle.schema.json", pattern: tree, item: merged }, null, 2) + "\n");

try {
  execFileSync(process.execPath, [path.join(root, "scripts/build.mjs"), "--check"], { stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  if (previous === null) fs.rmSync(target, { force: true }); else fs.writeFileSync(target, previous);
  console.error(String(e.stderr || e.stdout || e.message).trim());
  die("validation failed, nothing was written");
}
console.log(`✓ ${previous ? "updated" : "added"} ${item.id} v${item.version} -> patterns/${item.id}.json`);
console.log("  next: review the diff, commit on a feature branch, open a PR");
