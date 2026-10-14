#!/usr/bin/env node
// figma-keys.json tooling.
//   node scripts/figma-keys.mjs snippet           print the path of the Figma-side extractor
//   node scripts/figma-keys.mjs save <out.json|-> take the extractor output, verify checksums, write figma-keys.json
//   node scripts/figma-keys.mjs verify            check the saved file + drift against token.json
//   node scripts/figma-keys.mjs stamp             embed checksums in the current file (trusts its content)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const registry = readJson(path.join(root, "registry.config.json"));
const keysPath = path.resolve(root, registry.tokens.figmaKeys);
const tokensPath = path.resolve(root, registry.tokens.source);

// ---- checksum: must match extract-figma-keys.figma.js
const fnv = (s) => { let a = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193) >>> 0; } return a.toString(16); };
const sum = (o) => { const e = Object.entries(o).sort((x, y) => (x[0] < y[0] ? -1 : 1)); return { n: e.length, h: fnv(e.map(([k, v]) => k + ":" + v).join("|")) }; };
// only groups that are present are summed (the extractor can return a partial file, e.g. icons only)
const checksumsOf = (f) => {
  const c = {};
  if (f.variables) c.variables = Object.fromEntries(Object.entries(f.variables).map(([k, v]) => [k, sum(v)]));
  if (f.collectionAnchors) c.collectionAnchors = sum(f.collectionAnchors);
  for (const g of ["textStyles", "effectStyles", "components", "icons"]) if (f[g]) c[g] = sum(f[g]);
  return c;
};

const flatten = (c, prefix = "") => Object.entries(c).flatMap(([k, v]) => (v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
function diffChecksums(a, b) {
  const fa = Object.fromEntries(flatten(a)), fb = Object.fromEntries(flatten(b));
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => fa[k] !== fb[k]).map((k) => `${k}: ${fa[k] ?? "—"} != ${fb[k] ?? "—"}`);
}

function shapeErrors(f) {
  const errs = [];
  for (const g of ["variables", "textStyles", "effectStyles", "components"]) if (!f[g]) errs.push(`missing "${g}"`);
  if (errs.length) return errs;
  const groups = { ...Object.fromEntries(Object.entries(f.variables).map(([k, v]) => [`variables.${k}`, v])), textStyles: f.textStyles, effectStyles: f.effectStyles, components: f.components, collectionAnchors: f.collectionAnchors ?? {}, icons: f.icons ?? {} };
  const all = [];
  for (const [g, o] of Object.entries(groups)) {
    for (const [name, key] of Object.entries(o)) {
      if (!/^[0-9a-f]{40}$/.test(key)) errs.push(`${g}["${name}"] is not a 40-char hex key`);
      if (g !== "collectionAnchors") all.push(key); // anchors intentionally repeat a variable key
    }
  }
  const seen = new Set();
  for (const k of all) { if (seen.has(k)) errs.push(`duplicate key ${k}`); seen.add(k); }
  return errs;
}

// ---- token.json drift: tokens without a Figma key and keys without a token
function drift(f) {
  const tokens = readJson(tokensPath);
  const leaves = (n, p = []) => (n && typeof n === "object" ? ("$value" in n ? [[p, n]] : Object.entries(n).filter(([k]) => !k.startsWith("$")).flatMap(([k, v]) => leaves(v, [...p, k]))) : []);
  const expectedVars = {}; // collection -> Set(name)
  for (const set of tokens.$metadata.tokenSetOrder) {
    if (set === "main") continue;
    const collection = set.split("/")[0];
    if (!f.variables[collection]) continue;
    (expectedVars[collection] ??= new Set());
    for (const [p] of leaves(tokens[set])) expectedVars[collection].add(p.join("/"));
  }
  const expectedText = new Set(), expectedEffect = new Set();
  for (const [p, n] of leaves(tokens.main)) {
    if (n.$type === "typography") expectedText.add(p.join("/"));
    if (n.$type === "boxShadow") expectedEffect.add(p.join("/"));
  }
  const out = [];
  const cmp = (label, have, want) => {
    const missing = [...want].filter((x) => !(x in have)), extra = Object.keys(have).filter((x) => !want.has(x));
    if (missing.length) out.push(`${label}: ${missing.length} token(s) have no Figma key, e.g. ${missing.slice(0, 3).join(", ")}`);
    if (extra.length) out.push(`${label}: ${extra.length} Figma key(s) have no token, e.g. ${extra.slice(0, 3).join(", ")}`);
  };
  for (const [c, have] of Object.entries(f.variables)) cmp(`variables.${c}`, have, expectedVars[c] ?? new Set());
  cmp("textStyles", f.textStyles, expectedText);
  cmp("effectStyles", f.effectStyles, expectedEffect);
  return out;
}

const cmd = process.argv[2];
const die = (m) => { console.error(m); process.exit(1); };

if (cmd === "snippet") {
  console.log(path.join(root, "scripts/extract-figma-keys.figma.js"));
} else if (cmd === "save") {
  const src = process.argv.slice(3).find((a) => !a.startsWith("--"));
  const merge = process.argv.includes("--merge");
  if (!src) die("usage: figma-keys.mjs save <extractor-output.json|-> [--merge]");
  const raw = JSON.parse(fs.readFileSync(src === "-" ? 0 : src, "utf8"));
  const result = raw.result ?? raw; // tolerate tool wrappers
  if (!result.file || !result.checksums) die("input needs { file, checksums } (run the extractor with returnData=true)");
  const prevFile = fs.existsSync(keysPath) ? readJson(keysPath) : null;
  // --merge: a partial extraction (e.g. only:["icons"]) replaces just the groups it contains
  const incoming = result.file;
  const GROUPS = ["variables", "collectionAnchors", "textStyles", "effectStyles", "components", "icons"];
  if (merge) {
    if (!prevFile) die("--merge needs an existing figma-keys.json");
    if (incoming.fileKey !== prevFile.fileKey) die(`fileKey differs (${incoming.fileKey} != ${prevFile.fileKey}); a merge must come from the same library file`);
    result.file = { ...prevFile, ...Object.fromEntries(GROUPS.filter((g) => incoming[g]).map((g) => [g, incoming[g]])) };
    delete result.file.checksums;
  }
  const errs = shapeErrors(result.file);
  const mismatch = diffChecksums(result.checksums, merge ? checksumsOf(incoming) : checksumsOf(result.file));
  if (errs.length || mismatch.length) {
    die(["✗ not saved:", ...errs.map((e) => "  shape: " + e), ...mismatch.map((m) => "  checksum (extractor != file): " + m)].join("\n"));
  }
  if (result.warnings?.length) console.warn("extractor warnings:\n" + result.warnings.map((w) => "  - " + w).join("\n"));
  const prev = prevFile;
  const next = { ...(prev?.$comment ? { $comment: prev.$comment } : {}), ...result.file, checksums: checksumsOf(result.file) };
  fs.writeFileSync(keysPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`✓ saved ${path.relative(process.cwd(), keysPath)}`);
  if (prev) {
    const names = (f) => new Set([...Object.values(f.variables).flatMap((v) => Object.keys(v)), ...Object.keys(f.textStyles), ...Object.keys(f.effectStyles), ...Object.keys(f.components), ...Object.keys(f.icons ?? {})]);
    const a = names(prev), b = names(next);
    const added = [...b].filter((x) => !a.has(x)), removed = [...a].filter((x) => !b.has(x));
    console.log(`  names added: ${added.length}${added.length ? " (" + added.slice(0, 5).join(", ") + ")" : ""}, removed: ${removed.length}${removed.length ? " (" + removed.slice(0, 5).join(", ") + ")" : ""}`);
    if (prev.fileKey !== next.fileKey) console.log(`  ⚠ fileKey changed: ${prev.fileKey} -> ${next.fileKey}`);
  }
  const d = drift(next);
  if (d.length) console.log("drift vs token.json:\n" + d.map((x) => "  - " + x).join("\n"));
} else if (cmd === "stamp") {
  const f = readJson(keysPath);
  const errs = shapeErrors(f);
  if (errs.length) die(errs.join("\n"));
  fs.writeFileSync(keysPath, JSON.stringify({ ...f, checksums: checksumsOf(f) }, null, 2) + "\n");
  console.log("✓ checksums embedded (content trusted as-is; compare with an extractor dry run to prove it)");
} else if (cmd === "verify") {
  const f = readJson(keysPath);
  const errs = shapeErrors(f);
  if (!f.checksums) errs.push("no embedded checksums (run `stamp`, or re-extract and `save`)");
  else errs.push(...diffChecksums(f.checksums, checksumsOf(f)).map((m) => "checksum (embedded != recomputed): " + m));
  const d = drift(f);
  if (errs.length) console.error("✗ " + errs.join("\n✗ "));
  if (d.length) console.warn("drift vs token.json:\n" + d.map((x) => "  - " + x).join("\n"));
  const counts = `${Object.values(f.variables).reduce((a, v) => a + Object.keys(v).length, 0)} variables, ${Object.keys(f.textStyles).length + Object.keys(f.effectStyles).length} styles, ${Object.keys(f.components).length} components, ${Object.keys(f.icons ?? {}).length} icons`;
  if (errs.length) process.exit(1);
  console.log(`✓ figma-keys.json ok: ${counts}${d.length ? " (with drift)" : ", no drift vs token.json"}`);
} else {
  die("usage: figma-keys.mjs snippet | save <out.json|-> | verify | stamp");
}
