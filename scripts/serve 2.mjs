// Dev-only static server for the built site (dist/), same layout as GitHub Pages, with CORS for the Figma plugin.
//   npm run build && npm run serve      ->  http://localhost:8787/registry.json
// In the plugin: Settings -> Registry URL, or build the plugin with its devAllowedDomains (http://localhost:8787).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT || 8787);
const TYPES = { ".json": "application/json", ".html": "text/html", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };

http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(dist, rel);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`pattern dev server: http://localhost:${port}/registry.json  (serving ${dist})`));
