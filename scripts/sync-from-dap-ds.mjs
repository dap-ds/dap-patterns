// Local convenience: refresh data/tokens.json from a checkout of dap-ds/dap-ds next to this repo.
// (figma-keys.json is NOT synced from there: regenerate it from the published Figma file, see README.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(root, process.argv[2] || "../dap-ds/packages/tokens/tokens-src/tokens.json");
if (!fs.existsSync(src)) { console.error(`✗ not found: ${src}`); process.exit(1); }
const dst = path.join(root, "data/tokens.json");
const same = fs.existsSync(dst) && fs.readFileSync(dst, "utf8") === fs.readFileSync(src, "utf8");
if (same) console.log("✓ data/tokens.json already up to date");
else { fs.copyFileSync(src, dst); console.log("✓ data/tokens.json updated from " + src + " (run `npm run validate`, then commit on a branch)"); }
