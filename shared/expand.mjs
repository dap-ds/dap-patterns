// Expands `repeat` in a pattern tree into plain sibling nodes. Shared by the Figma plugin (Builder) and
// scripts/validate.mjs so both always see the same expanded tree. Pure JS: no Figma / Node APIs.
//
//   repeat: 3                          -> 3 identical copies, named "<name> 1..3"
//   repeat: [{properties:{...}}, {...}] -> one copy per entry, entry fields merged over the template
// Merged object fields: variant, properties, textOverrides, swap. Everything else in an entry replaces
// the template value (name, chars, visible). `children` are never repeated per entry.
const MERGE = ["variant", "properties", "textOverrides", "swap"];
const clone = (v) => JSON.parse(JSON.stringify(v));

function instantiate(template, entry, index) {
  const { repeat: _r, ...base } = template;
  const out = clone(base);
  if (entry) {
    for (const [k, v] of Object.entries(entry)) out[k] = MERGE.includes(k) ? { ...(out[k] || {}), ...v } : v;
  }
  if (!(entry && entry.name) && base.name) out.name = `${base.name} ${index + 1}`;
  return out;
}

function expandChildren(list) {
  const out = [];
  for (const raw of list) {
    const node = raw.children ? { ...raw, children: expandChildren(raw.children) } : raw;
    if (node.repeat === undefined) {
      out.push(node);
      continue;
    }
    const entries = typeof node.repeat === "number" ? Array.from({ length: node.repeat }, () => null) : node.repeat;
    entries.forEach((e, i) => out.push(instantiate(node, e, i)));
  }
  return out;
}

/** Returns a deep copy of the tree without any `repeat` (the input is not modified). */
export function expandTree(tree) {
  const t = clone(tree);
  t.root = { ...t.root, children: expandChildren(t.root.children) };
  return t;
}
