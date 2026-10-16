#!/usr/bin/env node
// Serve a built Clariva Web (./webapp) for LOCAL use against the REAL Clariva backend, without needing CORS on the Wallet-API.
//
//   node scripts/clariva/serve.mjs [--port 8090] [--root webapp] [--config config.clariva.json]
//                                  [--api https://wallet.dranzo.com] [--no-google]
//
// What it does
//   * serves the static build (hash-routed SPA) on http://localhost:<port>, bound to 127.0.0.1 only;
//   * answers /config.json with the Clariva config but with `clariva.api_base_url` rewritten to the same-origin path
//     `/clariva-api`, and relays `/clariva-api/*` to the real Wallet-API server-side. The browser therefore never makes a
//     cross-origin call to the Wallet-API, so no CORS change is needed there (the same idea as clarivahub.com/api/*.php);
//   * redirects `/u/<mxid>` (QR deep links) to `/#/user/<mxid>`.
// The Matrix homeserver is called directly by the browser (Synapse already sends CORS headers).
//
// Google sign-in is shown whenever config.clariva.google_client_id is set (pass --no-google to hide it). Google only serves
// its button to origins listed under *Authorized JavaScript origins* of that OAuth Web client, so http://localhost:<port>
// (and http://localhost) must be added there once; otherwise the button stays blank. Email/username + password always works.
// Not for production: use nginx (nginx/conf.d/default.conf has a /clariva-api/ proxy template) or enable CORS_ORIGINS on the API.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

const port = Number(opt("--port", 8090));
const root = path.resolve(repo, opt("--root", "webapp"));
const configPath = path.resolve(repo, opt("--config", "config.clariva.json"));
const apiTarget = new URL(opt("--api", "https://wallet.dranzo.com"));
// Google sign-in is ON whenever the config carries a client id (an Android account created with Google has no password,
// so this is its only way in). `--no-google` switches it off, e.g. to keep the console free of GIS origin warnings.
const enableGoogle = !args.includes("--no-google");

if (!fs.existsSync(path.join(root, "index.html"))) {
    console.error(`No index.html in ${root}. Build first (yarn build:genfiles && yarn build:bundle) or pass --root.`);
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.clariva = {
    ...config.clariva,
    api_base_url: "/clariva-api",
    user_link_base: `http://localhost:${port}/u/`,
    features: { ...config.clariva?.features, google_sign_in: enableGoogle && !!config.clariva?.google_client_id },
};
const configBody = JSON.stringify(config, null, 2);

const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff",
    ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
    ".webmanifest": "application/manifest+json",
};

const HOP_BY_HOP = new Set(["host", "connection", "origin", "referer", "cookie", "content-length", "accept-encoding", "x-forwarded-for"]);

function proxyToApi(req, res, url) {
    const upstreamPath = url.pathname.replace(/^\/clariva-api/, "") + url.search;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers.host = apiTarget.host;
    const upstream = https.request(
        { hostname: apiTarget.hostname, port: apiTarget.port || 443, path: upstreamPath, method: req.method, headers },
        (up) => {
            const out = { ...up.headers };
            delete out["access-control-allow-origin"]; // same-origin: not needed
            res.writeHead(up.statusCode ?? 502, out);
            up.pipe(res);
        },
    );
    upstream.on("error", (e) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ statusCode: 502, message: `Cannot reach ${apiTarget.host}: ${e.message}` }));
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error("upstream timeout")));
    req.pipe(upstream);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname.startsWith("/clariva-api/")) return proxyToApi(req, res, url);

    if (/^\/config(\.[A-Za-z0-9.-]+)?\.json$/.test(url.pathname)) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(configBody);
    }
    // No /version on purpose: Element auto-reloads whenever it differs from the baked-in version, so a 404 (a harmless
    // "Failed to poll for update" console line) is the right answer for a static local build.
    if (url.pathname.startsWith("/u/") && url.pathname.length > 3) {
        res.writeHead(302, { Location: `/#/user/${url.pathname.slice(3)}` });
        return res.end();
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) {
        res.writeHead(403);
        return res.end("forbidden");
    }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
            res.writeHead(404);
            return res.end("not found");
        }
        const noCache = /(index\.html|\/version|config.*\.json)$/.test(rel) || rel === "/";
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": st.size,
            "Cache-Control": noCache ? "no-cache" : "public, max-age=3600",
        });
        fs.createReadStream(file).pipe(res);
    });
});

server.listen(port, "127.0.0.1", () => {
    console.log(`Clariva Web  : http://localhost:${port}`);
    console.log(`Homeserver   : ${config.default_server_config?.["m.homeserver"]?.base_url}  (called directly by the browser)`);
    console.log(`Wallet-API   : ${apiTarget.origin}  (relayed through /clariva-api, same-origin)`);
    console.log(`Google login : ${config.clariva.features.google_sign_in ? "on (needs the origin allow-listed in Google Cloud)" : "off"}`);
});
