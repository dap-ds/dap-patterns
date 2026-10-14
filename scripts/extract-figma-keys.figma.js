// Figma-side extractor for figma-keys.json. Runs INSIDE Figma (Plugin API), not in Node.
//
// How to run (read-only, works with view access on the published DS file):
//   Figma MCP `use_figma`  fileKey=<public DS file>, code=<this file>   (preferred)
//   or Desktop Bridge `figma_execute` in a file where the bridge runs (needs a longer timeout: ~20 s)
// Then feed the returned JSON to the CLI:   node scripts/figma-keys.mjs save <output.json>
//
// Keys are per published file: always run it on the PUBLISHED library file, never on a local copy.
// Set returnData=false for a cheap dry run (counts + checksums only) to compare with the saved file.
//
// NOTE: iterates pages with setCurrentPageAsync (needed to load component nodes) and restores the
// original page afterwards. It does not change any content.

const CONFIG = {
  fileKey: "sYvTjQPUTPXGB9NV4xtinU", // published Design system 1.5
  libraryKey: "lk-96be62982b06856f2940f04a1e382ef1f517f62a305678cedd92e46fbc7ef70decb240af11909ecb380932b709128a8dc836795c76d3fad46b9e2307bd2db9d1", // from get_libraries; optional
  returnData: true,
  // patterns bind semantic tokens, never primitives
  variableCollections: ["color-semantic", "size", "typography-foundations", "typography-theme"],
  // one variable key per mode-bearing collection: resolves the collection + its modes
  anchorCollections: ["color-theme", "color-semantic", "typography-theme"],
  // page sections are "❖ NAME" divider pages
  includeSections: ["COMPONENTS", "PATTERNS", "VISUALS"],
  excludePages: ["Flags", "Icons", "Illustration"],
  skipNames: "^([_.]|DEPRECATED)", // internals and deprecated components
  // Instance-swap targets (the Icons page has ~2900 components, so only the ones patterns use are listed).
  // A pattern that swaps to an icon missing here fails `npm run validate`: add the name, re-run with only:["icons"].
  iconPage: "Icons",
  iconNames: [
    "icon-upload-2-line", "icon-search-line", "icon-download-line", "icon-arrow-left-line", "icon-arrow-right-line",
    "icon-arrow-down-s-line", "icon-arrow-up-s-line", "icon-close-line", "icon-check-line", "icon-information-line",
    "icon-error-warning-fill", "icon-notification-3-line", "icon-menu-fill", "icon-add-line", "icon-delete-bin-line",
    "icon-external-link-line", "icon-file-text-line", "icon-attachment-line",
  ],
  // null = everything. ["icons"] = only the icons group (cheap; merge it with `figma-keys.mjs save --merge`).
  only: null,
};
const want = (g) => !CONFIG.only || CONFIG.only.includes(g);

// ---- checksum: FNV-1a over sorted "name:key" pairs; identical implementation lives in figma-keys.mjs
const fnv = (s) => { let a = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193) >>> 0; } return a.toString(16); };
const sum = (o) => { const e = Object.entries(o).sort((x, y) => (x[0] < y[0] ? -1 : 1)); return { n: e.length, h: fnv(e.map(([k, v]) => k + ":" + v).join("|")) }; };

const warnings = [];
const skip = new RegExp(CONFIG.skipNames);

// ---- variables
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const allVars = await figma.variables.getLocalVariablesAsync();
const byCollection = (name) => {
  const c = collections.find((x) => x.name === name);
  return c ? allVars.filter((v) => v.variableCollectionId === c.id) : null;
};
const variables = {};
for (const name of want("variables") ? CONFIG.variableCollections : []) {
  const vs = byCollection(name);
  if (!vs) { warnings.push(`variable collection "${name}" not found`); continue; }
  variables[name] = Object.fromEntries(vs.map((v) => [v.name, v.key]));
}
const collectionAnchors = {};
for (const name of want("variables") ? CONFIG.anchorCollections : []) {
  const vs = byCollection(name);
  if (!vs || !vs.length) { warnings.push(`anchor collection "${name}" not found`); continue; }
  const first = vs.slice().sort((a, b) => (a.name < b.name ? -1 : 1))[0]; // deterministic
  collectionAnchors[name] = first.key;
}

// ---- styles
const textStyles = want("styles") ? Object.fromEntries((await figma.getLocalTextStylesAsync()).map((s) => [s.name, s.key])) : {};
const effectStyles = want("styles") ? Object.fromEntries((await figma.getLocalEffectStylesAsync()).map((s) => [s.name, s.key])) : {};

// ---- components (component sets + standalone components, public ones only)
const components = {};
const pageOfName = {};
const original = figma.currentPage;
let section = null;
for (const page of want("components") ? figma.root.children : []) {
  const label = page.name.trim();
  if (label.startsWith("❖")) { section = label.replace("❖", "").trim().toUpperCase(); continue; }
  if (!label || /^-+$/.test(label)) continue; // divider pages
  if (!CONFIG.includeSections.includes(section) || CONFIG.excludePages.includes(label)) continue;
  await figma.setCurrentPageAsync(page);
  for (const n of page.findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] })) {
    if (n.type === "COMPONENT" && n.parent && n.parent.type === "COMPONENT_SET") continue; // variant
    if (skip.test(n.name)) continue;
    if (components[n.name] && components[n.name] !== n.key) {
      warnings.push(`duplicate component name "${n.name}" on pages "${pageOfName[n.name]}" and "${label}" (kept the first)`);
      continue;
    }
    components[n.name] = n.key;
    pageOfName[n.name] = label;
  }
}

// ---- icons (instance-swap targets), by name
const icons = {};
if (want("icons") && CONFIG.iconNames.length) {
  const page = figma.root.children.find((p) => p.name.trim() === CONFIG.iconPage);
  if (!page) warnings.push(`icon page "${CONFIG.iconPage}" not found`);
  else {
    await figma.setCurrentPageAsync(page);
    const names = new Set(CONFIG.iconNames);
    for (const n of page.findAllWithCriteria({ types: ["COMPONENT"] })) if (names.has(n.name) && !icons[n.name]) icons[n.name] = n.key;
    for (const name of names) if (!icons[name]) warnings.push(`icon "${name}" not found on page "${CONFIG.iconPage}"`);
  }
}
await figma.setCurrentPageAsync(original);

// groups that were not extracted (only:[...]) are left out of the output entirely
const checksums = {};
const file = { schema: 1, fileKey: CONFIG.fileKey, ...(CONFIG.libraryKey ? { libraryKey: CONFIG.libraryKey } : {}), generatedAt: new Date().toISOString().slice(0, 10) };
if (want("variables")) {
  file.collectionAnchors = collectionAnchors; file.variables = variables;
  checksums.variables = Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, sum(v)]));
  checksums.collectionAnchors = sum(collectionAnchors);
}
if (want("styles")) { file.textStyles = textStyles; file.effectStyles = effectStyles; checksums.textStyles = sum(textStyles); checksums.effectStyles = sum(effectStyles); }
if (want("components")) { file.components = components; checksums.components = sum(components); }
if (want("icons")) { file.icons = icons; checksums.icons = sum(icons); }

return CONFIG.returnData ? { file, checksums, warnings } : { checksums, warnings };
