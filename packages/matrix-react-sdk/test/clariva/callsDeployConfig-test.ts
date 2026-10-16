/*
Copyright 2026 The Clariva Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Pins the deployment-side half of the "calls do not ring / have one-way media on web" fix, which no component test
 * sees: the shipped configs, the webpack copy flag that keeps Element Call byte-identical to the Android build, the
 * nginx cache map and the documented CSP hash. Plain file checks, no React.
 */

const REPO = path.resolve(__dirname, "../../../..");
const read = (file: string): string => fs.readFileSync(path.join(REPO, file), "utf8");

/**
 * What is wrong with the `element_call` block of a shipped config, or `null`. The block itself is allowed: DEPLOY.md
 * recommends serving Element Call from a dedicated origin in production, which is configured as `element_call.url`.
 * When there is a URL it must parse, and in the production config it must be https (a call page over plain http cannot
 * get a camera or microphone, and would be mixed content inside the https web app).
 */
function elementCallProblem(config: any, requireHttps: boolean): string | null {
    const url = config.element_call?.url;
    if (url === undefined) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return "element_call.url is not a URL";
    }
    return requireHttps && parsed.protocol !== "https:" ? "element_call.url is not https" : null;
}

describe("shipped configs enable calls", () => {
    describe.each([
        ["config.clariva.json", true],
        ["config.clariva.local.json", false],
    ])("%s", (file, production) => {
        const text = read(file);
        const config = JSON.parse(text);

        it("sets clariva.features.calls to true (it was false, which is why nothing rang on web)", () => {
            expect(config.clariva.features.calls).toBe(true);
        });

        it("does not carry feature_group_calls: applyClarivaCallsDefaults() sets it at runtime", () => {
            expect(config.features ?? {}).not.toHaveProperty("feature_group_calls");
            expect(text).not.toMatch(/feature_group_calls/);
        });

        it(`may carry an element_call.url (a dedicated Element Call origin)${production ? ", and then it is https" : ""}`, () => {
            expect(elementCallProblem(config, production)).toBeNull();
        });
    });

    describe("the element_call rule", () => {
        it("accepts no element_call block, a block without a url, and a dedicated https origin", () => {
            expect(elementCallProblem({}, true)).toBeNull();
            expect(elementCallProblem({ element_call: { brand: "Clariva Call" } }, true)).toBeNull();
            expect(elementCallProblem({ element_call: { url: "https://call.clarivahub.com" } }, true)).toBeNull();
        });

        it("rejects a plain-http production URL, but lets the local config use one", () => {
            const config = { element_call: { url: "http://call.clarivahub.com" } };
            expect(elementCallProblem(config, true)).toBe("element_call.url is not https");
            expect(elementCallProblem({ element_call: { url: "http://localhost:8090" } }, false)).toBeNull();
        });

        it("rejects a url that is not a URL at all", () => {
            expect(elementCallProblem({ element_call: { url: "call.clarivahub.com" } }, true)).toBe(
                "element_call.url is not a URL",
            );
            expect(elementCallProblem({ element_call: { url: "call.clarivahub.com" } }, false)).toBe(
                "element_call.url is not a URL",
            );
        });
    });
});

describe("webpack copies the bundled Element Call untouched", () => {
    const webpack = read("webpack.config.js");

    /** The `{ ... }` object literal that contains `needle` (balanced braces, string-unaware but good enough here). */
    function objectContaining(source: string, needle: string): string {
        const at = source.indexOf(needle);
        expect(at).toBeGreaterThan(-1);
        let start = at;
        for (let depth = 0; start >= 0; start--) {
            if (source[start] === "}") depth++;
            if (source[start] === "{" && depth-- === 0) break;
        }
        let end = start;
        for (let depth = 0; end < source.length; end++) {
            if (source[end] === "{") depth++;
            if (source[end] === "}" && --depth === 0) break;
        }
        return source.slice(start, end + 1);
    }

    it("has exactly one element-call copy pattern", () => {
        expect(webpack.match(/from:\s*"element-call\/\*\*"/g)).toHaveLength(1);
    });

    it("marks it info.minimized so terser-webpack-plugin and css-minimizer-webpack-plugin skip it", () => {
        const pattern = objectContaining(webpack, 'from: "element-call/**"');
        expect(pattern).toMatch(/info:\s*\{\s*minimized:\s*true\s*\}/);
        // still copies from res/ and still tolerates a missing build
        expect(pattern).toMatch(/context:\s*path\.resolve\(__dirname,\s*"res"\)/);
        expect(pattern).toMatch(/noErrorOnMissing:\s*true/);
    });

    it("the installed minimizers really honour info.minimized (the premise of the flag)", () => {
        const terser = fs.readFileSync(
            require.resolve("terser-webpack-plugin/dist/index.js", { paths: [REPO] }),
            "utf8",
        );
        const css = fs.readFileSync(
            require.resolve("css-minimizer-webpack-plugin/dist/index.js", { paths: [REPO] }),
            "utf8",
        );
        expect(terser).toMatch(/info\.minimized/);
        expect(css).toMatch(/info\.minimized/);
    });
});

describe("nginx cache map for Element Call", () => {
    const conf = read("nginx/conf.d/default.conf");
    const map = /map \$uri \$clariva_cache_control \{([\s\S]*?)\n\}/.exec(conf)?.[1] ?? "";
    // nginx evaluates the regex entries in order and the first match wins
    const entries = [...map.matchAll(/^\s*~(\S+)\s+"([^"]*)";/gm)].map(([, re, value]) => ({
        re: new RegExp(re),
        value,
    }));
    const cacheControl = (uri: string): string => entries.find(({ re }) => re.test(uri))?.value ?? "";

    it("parses the map", () => {
        expect(entries.length).toBeGreaterThan(5);
    });

    it("revalidates Element Call's entry point and config, however it is reached", () => {
        expect(cacheControl("/element-call/index.html")).toBe("no-cache");
        expect(cacheControl("/element-call/config.json")).toBe("no-cache");
    });

    it("keeps the content-hashed Element Call assets immutable and the web app's own rules", () => {
        expect(cacheControl("/element-call/assets/index-BAfhaCa-.js")).toBe("public, max-age=31536000, immutable");
        expect(cacheControl("/index.html")).toBe("no-cache");
        expect(cacheControl("/config.json")).toBe("no-cache");
        expect(cacheControl("/bundles/abc123/bundle.js")).toBe("public, max-age=31536000, immutable");
    });

    it("tells the operator a dedicated Element Call origin must not inherit the framing headers", () => {
        expect(conf).toMatch(/OWN server block/);
        expect(conf).toMatch(/frame-ancestors https:\/\/<web origin>/);
    });
});

describe("Element Call's inline script and the CSP hash in the docs", () => {
    const html = read("res/element-call/index.html");
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const hashes = inline.map((text) => `sha256-${crypto.createHash("sha256").update(text, "utf8").digest("base64")}`);

    it("has exactly the one inline script the docs talk about", () => {
        expect(inline).toEqual(["window.global = window;"]);
    });

    it.each(["docs/clariva/DEPLOY.md", "docs/clariva/IMPLEMENTATION-NOTES.md"])(
        "%s documents the current hash of that script",
        (file) => {
            const doc = read(file);
            for (const hash of hashes) expect(doc).toContain(`'${hash}`);
        },
    );
});

describe("local stack: /element-call/config.json is not the production file", () => {
    const script = path.join(REPO, "tools/local-stack/tools/element-call-config.mjs");
    const bundledPath = path.join(REPO, "res/element-call/config.json");
    const bundled = JSON.parse(fs.readFileSync(bundledPath, "utf8"));
    let local: any;

    beforeAll(() => {
        // the module's own self-check mode: prints what the server would answer for the given bundled file
        local = JSON.parse(execFileSync(process.execPath, [script, bundledPath], { encoding: "utf8" }));
    });

    it("the bundled file names production (which is why it must not be served on the local stack)", () => {
        expect(bundled.livekit.livekit_service_url).toBe("https://matrix-rtc.clarivahub.com/livekit/jwt");
        expect(bundled.default_server_config["m.homeserver"].base_url).toBe("https://matrix.clarivahub.com");
    });

    it("points the homeserver at the mock and LiveKit at a dead loopback address", () => {
        expect(local.default_server_config).toEqual({
            "m.homeserver": { base_url: "http://localhost:8008", server_name: "localhost" },
        });
        expect(local.livekit.livekit_service_url).toBe("http://127.0.0.1:9/livekit/jwt");
    });

    it("keeps the rest of the bundled config (MatrixRTC timings, device-session member events, no app prompt)", () => {
        expect(local.matrix_rtc_session).toEqual(bundled.matrix_rtc_session);
        expect(local.features.feature_use_device_session_member_events).toBe(true);
        expect(local.app_prompt).toBe(false);
        expect(Object.keys(local).sort()).toEqual(Object.keys(bundled).sort());
        expect(JSON.stringify(local)).not.toMatch(/clarivahub\.com/);
    });

    it("serve-webapp.mjs routes /element-call/config.json through it, before the static lookup", () => {
        const server = fs.readFileSync(path.join(REPO, "tools/local-stack/tools/serve-webapp.mjs"), "utf8");
        expect(server).toContain("import { localElementCallConfig } from './element-call-config.mjs';");
        expect(server).toContain("rel === '/element-call/config.json'");
        // the static lookup (and its generic trailing-slash handling) comes after it
        expect(server.indexOf("rel === '/element-call/config.json'")).toBeLessThan(server.indexOf("fs.stat(file"));
    });
});
