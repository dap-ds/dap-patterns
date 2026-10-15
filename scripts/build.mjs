// Validates every patterns/<id>.json bundle and generates the static site (dist/) that GitHub Pages serves:
//   dist/registry.json                      generated catalogue (the Figma plugin reads this)
//   dist/patterns/<id>/pattern.json         the pattern tree of each bundle
//   dist/previews/<id>.png                  card preview shown in the plugin (copied from previews/, optional per pattern)
//   dist/data/{figma-keys,tokens}.json, dist/schema/*.json, dist/index.html
// `--check` validates only (used by `npm run validate`).
//
// Checks: JSON Schema (bundle + generated registry), id == filename, category exists, every token reference
// exists in tokens.json AND has a Figma key in the right slot kind, instance components + swap targets exist
// in figma-keys.json, modes have an anchor, no repeat on the root. `uses` and `treeHash` are derived here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { expandTree } from "../shared/expand.mjs";
import { hashTree } from "../shared/hash.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const dist = path.join(root, "dist");

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const config = read(path.join(root, "registry.config.json"));
const keys = read(path.resolve(root, config.tokens.figmaKeys));
const tokens = read(path.resolve(root, config.tokens.source));

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false }); // format keywords are documentation only
ajv.addSchema(read(path.join(root, "schema/pattern.schema.json")));
const validateBundle = ajv.compile(read(path.join(root, "schema/bundle.schema.json")));
const validateRegistry = ajv.compile(read(path.join(root, "schema/registry.schema.json")));
const fmt = (v) => (v.errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");

// token.json leaves as dotted paths (set names are collection/mode, not part of the path)
const tokenPaths = new Set();
const walkTokens = (n, p) => {
  if (n && typeof n === "object") {
    if ("$value" in n) return void tokenPaths.add(p.join("."));
    for (const [k, v] of Object.entries(n)) if (!k.startsWith("$")) walkTokens(v, [...p, k]);
  }
};
for (const set of tokens.$metadata.tokenSetOrder) walkTokens(tokens[set], []);

const kindOf = (figmaName) => {
  if (figmaName in keys.textStyles) return "textStyles";
  if (figmaName in keys.effectStyles) return "effectStyles";
  return Object.keys(keys.variables).find((c) => figmaName in keys.variables[c]) ?? null;
};
// Which Figma collection / style a token slot must resolve to
const slotKind = (key, parentKey) => {
  if (["fill", "stroke", "color"].includes(key)) return "color-semantic";
  if (["strokeWidth", "radius", "minWidth", "maxWidth", "width", "height", "gap", "padding"].includes(key) || parentKey === "padding") return "size";
  if (key === "textStyle") return "textStyles";
  if (key === "effect") return "effectStyles";
  return null;
};

const patternsDir = path.join(root, "patterns");
const previewsDir = path.join(root, "previews");
// PNG size from the IHDR chunk (width/height are big-endian uint32 at byte 16/20)
const pngSize = (f) => { const b = fs.readFileSync(f); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const files = fs.readdirSync(patternsDir).filter((f) => f.endsWith(".json")).sort();
const items = [];
const trees = {};
for (const file of files) {
  const id = file.slice(0, -5);
  const where = `patterns/${file}`;
  const bundle = read(path.join(patternsDir, file));
  if (!validateBundle(bundle)) { fail(where, fmt(validateBundle)); continue; }
  const { pattern: tree, item } = bundle;
  if (tree.id !== id || item.id !== id) fail(where, `file name, item.id ("${item.id}") and pattern.id ("${tree.id}") must all be "${id}"`);
  if (config.categories && !config.categories.some((c) => c.id === item.category)) fail(where, `unknown category "${item.category}"`);
  if (tree.root.repeat !== undefined) fail(where, "root.repeat: the root frame cannot be repeated");
  for (const c of Object.keys(tree.modes ?? {})) {
    if (!keys.collectionAnchors?.[c] && !keys.variables[c]) fail(where, `modes.${c}: no anchor key in figma-keys.json`);
  }

  const used = new Set();
  const scanTokens = (obj, at, parentKey) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "children" || k === "chars") continue;
      if (v && typeof v === "object") { scanTokens(v, `${at}.${k}`, k); continue; }
      if (typeof v !== "string" || !/^\{[^{}]+\}$/.test(v)) continue;
      const p = v.slice(1, -1);
      const figmaName = p.split(".").join("/");
      if (!tokenPaths.has(p)) { fail(`${where} ${at}.${k}`, `token ${v} not in tokens.json`); continue; }
      const kind = kindOf(figmaName);
      if (!kind) { fail(`${where} ${at}.${k}`, `token ${v} has no Figma variable/style key`); continue; }
      const want = slotKind(k, parentKey);
      if (want && kind !== want) fail(`${where} ${at}.${k}`, `token ${v} is ${kind}, slot expects ${want}`);
    }
  };
  const visit = (node, at) => {
    scanTokens(node, at, null);
    if (node.type === "INSTANCE") {
      if (!(node.component in keys.components)) fail(`${where} ${at}`, `component "${node.component}" not in figma-keys.json`);
      used.add(node.component);
      for (const [prop, target] of Object.entries(node.swap ?? {})) {
        if (!(keys.icons && target in keys.icons) && !(target in keys.components)) {
          fail(`${where} ${at}.swap`, `"${prop}" -> "${target}" has no key in figma-keys.json (icons / components); add the icon name to iconNames in scripts/extract-figma-keys.figma.js and re-extract`);
        }
      }
    }
    (node.children ?? []).forEach((c, i) => visit(c, `${at}.children[${i}]`));
  };
  visit(expandTree(tree).root, "root");

  const { pattern: _p, uses: _u, treeHash: _h, ...meta } = item; // generated fields are recomputed
  const previewFile = path.join(previewsDir, `${id}.png`);
  const preview = fs.existsSync(previewFile) ? { src: `previews/${id}.png`, ...pngSize(previewFile) } : meta.preview;
  items.push({ ...meta, ...(preview ? { preview } : {}), pattern: `patterns/${id}/pattern.json`, uses: [...used].sort(), treeHash: hashTree(tree) });
  trees[id] = tree;
}

const registry = {
  $schema: "./schema/registry.schema.json",
  schema: 1,
  name: config.name,
  ...(config.homepage ? { homepage: config.homepage } : {}),
  ...(config.repository ? { repository: config.repository } : {}),
  generatedAt: new Date().toISOString().slice(0, 10),
  tokens: config.tokens,
  categories: config.categories,
  items,
};
if (!validateRegistry(registry)) fail("generated registry", fmt(validateRegistry));

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join("\n"));
  process.exit(1);
}

if (!check) {
  fs.rmSync(dist, { recursive: true, force: true });
  const put = (rel, data) => { const f = path.join(dist, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n"); };
  put("registry.json", registry);
  for (const [id, tree] of Object.entries(trees)) put(`patterns/${id}/pattern.json`, { $schema: "../../schema/pattern.schema.json", ...tree });
  fs.cpSync(path.resolve(root, config.tokens.figmaKeys), path.join(dist, config.tokens.figmaKeys));
  fs.cpSync(path.resolve(root, config.tokens.source), path.join(dist, config.tokens.source));
  fs.cpSync(path.join(root, "schema"), path.join(dist, "schema"), { recursive: true });
  if (fs.existsSync(previewsDir)) fs.cpSync(previewsDir, path.join(dist, "previews"), { recursive: true });
  put(".nojekyll", "");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  put("index.html", `<!doctype html><meta charset="utf-8"><title>${esc(config.name)}</title><h1>${esc(config.name)}</h1><p>Machine-readable catalogue for the DÁP Figma plugin: <a href="registry.json">registry.json</a></p><ul>${items.map((i) => `<li><b>${esc(i.title)}</b> <code>${esc(i.id)}</code> v${esc(i.version)} (${esc(i.status)})</li>`).join("")}</ul>`);
}
console.log(`✓ ${check ? "valid" : "built"}: ${items.length} pattern(s), ${tokenPaths.size} token paths, ${Object.keys(keys.components).length} components, ${Object.keys(keys.icons ?? {}).length} icons${check ? "" : " -> dist/"}`);
