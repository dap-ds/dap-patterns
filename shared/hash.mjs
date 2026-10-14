// Pattern tree hash (FNV-1a of the stable-stringified tree, `$schema` ignored). Must stay identical to
// plugin/src/provenance.ts `hashTree` in dap-ds/dap-patterns-figma-plugin: the plugin stores this hash next to
// every inserted frame and compares it with the generated registry.
const fnv = (s) => { let a = 0x811c9dc5 >>> 0; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193) >>> 0; } return a.toString(16); };
const stable = (v) => Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}" : JSON.stringify(v);
export const hashTree = (tree) => { const { $schema, ...rest } = tree; return fnv(stable(rest)); };
