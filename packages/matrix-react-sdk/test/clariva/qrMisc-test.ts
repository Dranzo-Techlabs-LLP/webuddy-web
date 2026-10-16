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

import jsQR from "jsqr";

import SdkConfig from "../../src/SdkConfig";
import { buildUserLink, parseUserQrPayload, allowedUserLinkHosts } from "../../src/clariva/qr/payload";
import { encodeQr, QR_QUIET_ZONE_MODULES, qrSvgDataUri, rasterizeQr, renderQrSvg } from "../../src/clariva/qr/qrMatrix";
import { shareText } from "../../src/clariva/qr/share";
import { getUserShareLink, isQrEnabled, parseScannedUserQr, searchQueryFor } from "../../src/clariva/qr/links";
import { isUnresolvedMember, memberFromRow } from "../../src/clariva/qr/members";
import { DirectoryMember } from "../../src/utils/direct-messages";
import { createQrDecoder } from "../../src/clariva/qr/decoders";
import { configureClariva } from "./helpers";

const BASE = "https://clarivahub.com/u/";

describe("QR image (spec 04 §2.10.1)", () => {
    it.each([
        "@jane:clarivahub.com",
        "@mohamed.shimil4:clarivahub.com",
        "@legacy-3f2a9c1e-77d1-4e0a-9d2e-0c1f5b8a6d11:clarivahub.com",
        "@o'brien(1)+x=y/z:clarivahub.com:8448",
    ])("the code for %s decodes back to exactly the payload", (id) => {
        const payload = buildUserLink(id, BASE);
        const { data, width, height } = rasterizeQr(encodeQr(payload), 6);
        const decoded = jsQR(data, width, height);
        expect(decoded?.data).toBe(payload);
        // ...and what a scanner does with it
        expect(parseUserQrPayload(decoded!.data, { allowedHosts: allowedUserLinkHosts(BASE) })).toBe(id);
    });

    it("uses error-correction level L and a 4-module quiet zone, black on white", () => {
        const matrix = encodeQr(buildUserLink("@jane:clarivahub.com", BASE));
        const svg = renderQrSvg(matrix);
        const total = matrix.size + 2 * QR_QUIET_ZONE_MODULES;
        expect(QR_QUIET_ZONE_MODULES).toBe(4);
        expect(svg).toContain(`viewBox="0 0 ${total} ${total}"`);
        expect(svg).toContain('fill="#ffffff"');
        expect(svg).toContain('fill="#000000"');
        // the top-left finder pattern starts exactly after the quiet zone
        expect(svg).toContain(`M${QR_QUIET_ZONE_MODULES} ${QR_QUIET_ZONE_MODULES}h7`);
        // no markup injection channel: the SVG only contains our own elements
        expect(svg).not.toMatch(/<script|onload|href=/i);

        // level L keeps the symbol small: a ~50 byte payload fits version 3 or 4 (29 or 33 modules)
        expect(matrix.size).toBeLessThanOrEqual(33);
    });

    it("renders a data: URI that an <img> can show", () => {
        const uri = qrSvgDataUri(buildUserLink("@jane:clarivahub.com", BASE));
        expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
        expect(decodeURIComponent(uri.split(",").slice(1).join(","))).toMatch(/^<svg /);
    });

    it("throws for data that does not fit in a QR code (the dialog then shows 'QR code is not available.')", () => {
        expect(() => encodeQr("x".repeat(4000))).toThrow();
    });
});

describe("shareText (Android 'Share link')", () => {
    const LINK = "https://clarivahub.com/u/%40jane%3Aclarivahub.com";

    it("uses the Web Share API with the chooser title 'Share' and the link as text", async () => {
        const share = jest.fn().mockResolvedValue(undefined);
        const copy = jest.fn();
        expect(await shareText(LINK, "Share", { share, copy })).toBe("shared");
        expect(share).toHaveBeenCalledWith({ title: "Share", text: LINK });
        expect(copy).not.toHaveBeenCalled();
    });

    it("treats a dismissed share sheet as cancelled (no clipboard write, no toast)", async () => {
        const share = jest.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
        const copy = jest.fn();
        expect(await shareText(LINK, "Share", { share, copy })).toBe("cancelled");
        expect(copy).not.toHaveBeenCalled();
    });

    it("falls back to the clipboard without Web Share, or when sharing fails", async () => {
        const copy = jest.fn().mockResolvedValue(true);
        expect(await shareText(LINK, "Share", { copy })).toBe("copied");
        expect(copy).toHaveBeenCalledWith(LINK);

        const share = jest.fn().mockRejectedValue(new Error("NotAllowedError"));
        expect(await shareText(LINK, "Share", { share, copy })).toBe("copied");
    });

    it("reports a failure when nothing worked", async () => {
        expect(await shareText(LINK, "Share", { copy: async () => false })).toBe("failed");
        expect(
            await shareText(LINK, "Share", {
                copy: async () => {
                    throw new Error("denied");
                },
            }),
        ).toBe("failed");
    });
});

describe("links (config gating)", () => {
    afterEach(() => SdkConfig.reset());

    it("builds the Clariva link from user_link_base when Clariva QR is on", () => {
        configureClariva({ user_link_base: "https://clarivahub.com/u/" });
        expect(isQrEnabled()).toBe(true);
        expect(getUserShareLink("@jane:clarivahub.com")).toBe("https://clarivahub.com/u/%40jane%3Aclarivahub.com");
    });

    it("defaults to https://clarivahub.com/u/", () => {
        configureClariva();
        expect(getUserShareLink("@jane:clarivahub.com")).toBe("https://clarivahub.com/u/%40jane%3Aclarivahub.com");
    });

    it("honours another base (e.g. the web origin)", () => {
        configureClariva({ user_link_base: "https://app.example.org/u" });
        expect(getUserShareLink("@jane:clarivahub.com")).toBe("https://app.example.org/u/%40jane%3Aclarivahub.com");
    });

    it("returns null (callers keep Element's matrix.to permalink) without Clariva or with features.qr=false", () => {
        SdkConfig.reset();
        expect(isQrEnabled()).toBe(false);
        expect(getUserShareLink("@jane:clarivahub.com")).toBeNull();
        configureClariva({ features: { qr: false } });
        expect(isQrEnabled()).toBe(false);
        expect(getUserShareLink("@jane:clarivahub.com")).toBeNull();
    });

    it("parseScannedUserQr accepts the configured host and the host serving the app, nothing else", () => {
        configureClariva({ user_link_base: "https://clarivahub.com/u/" });
        expect(parseScannedUserQr("https://clarivahub.com/u/%40jane%3Aclarivahub.com")).toBe("@jane:clarivahub.com");
        // jsdom serves the tests from http://localhost
        expect(parseScannedUserQr("http://localhost/u/%40jane%3Aclarivahub.com")).toBe("@jane:clarivahub.com");
        expect(parseScannedUserQr("https://clarivahub.com.evil.net/u/%40jane%3Aclarivahub.com")).toBeNull();
        expect(parseScannedUserQr("https://evil.net/u/%40jane%3Aclarivahub.com")).toBeNull();
    });
});

describe("searchQueryFor (pasting a shared link into Start chat)", () => {
    beforeEach(() => configureClariva({ user_link_base: "https://clarivahub.com/u/" }));
    afterEach(() => SdkConfig.reset());

    it("resolves a pasted Clariva user link, matrix.to permalink or matrix: URI to the Matrix id", () => {
        expect(searchQueryFor(" https://clarivahub.com/u/%40jane%3Aclarivahub.com\n")).toBe("@jane:clarivahub.com");
        expect(searchQueryFor("https://matrix.to/#/@jane:clarivahub.com")).toBe("@jane:clarivahub.com");
        expect(searchQueryFor("matrix:u/jane:clarivahub.com")).toBe("@jane:clarivahub.com");
        expect(searchQueryFor("  @jane:clarivahub.com ")).toBe("@jane:clarivahub.com");
    });

    it("leaves everything else exactly as typed", () => {
        expect(searchQueryFor("jane")).toBe("jane");
        expect(searchQueryFor("  jane smith ")).toBe("  jane smith ");
        expect(searchQueryFor("@jane")).toBe("@jane");
        expect(searchQueryFor("https://evil.net/u/%40jane%3Aclarivahub.com")).toBe(
            "https://evil.net/u/%40jane%3Aclarivahub.com",
        );
    });
});

describe("search members", () => {
    it("flags the unresolved explicit-id row and nothing else", () => {
        const unresolved = memberFromRow({ userId: "@ghost:clarivahub.com", unresolved: true });
        expect(unresolved).toBeInstanceOf(DirectoryMember);
        expect(isUnresolvedMember(unresolved)).toBe(true);
        expect(unresolved.name).toBe("@ghost:clarivahub.com");

        const resolved = memberFromRow({ userId: "@jane:clarivahub.com", displayName: "Jane", avatarUrl: "mxc://a/b" });
        expect(isUnresolvedMember(resolved)).toBe(false);
        expect(resolved.name).toBe("Jane");
        expect(resolved.getMxcAvatarUrl()).toBe("mxc://a/b");
    });
});

describe("decoder selection", () => {
    afterEach(() => {
        delete (globalThis as any).BarcodeDetector;
    });

    it("falls back to the bundled jsQR when the browser has no BarcodeDetector", async () => {
        const decoder = await createQrDecoder();
        expect(decoder).not.toBeNull();
        // no frame yet (0x0 source): nothing to decode, no error
        expect(await decoder!.decode({ videoWidth: 0, videoHeight: 0 })).toBeNull();
    });

    it("prefers a BarcodeDetector that supports QR codes", async () => {
        const detect = jest.fn().mockResolvedValue([{ rawValue: "@jane:clarivahub.com" }]);
        (globalThis as any).BarcodeDetector = class {
            public static getSupportedFormats = async (): Promise<string[]> => ["qr_code", "ean_13"];
            public detect = detect;
        };
        const decoder = await createQrDecoder();
        const source = {};
        expect(await decoder!.decode(source)).toBe("@jane:clarivahub.com");
        expect(detect).toHaveBeenCalledWith(source);
    });

    it("ignores a BarcodeDetector without QR support", async () => {
        const detect = jest.fn();
        (globalThis as any).BarcodeDetector = class {
            public static getSupportedFormats = async (): Promise<string[]> => ["ean_13"];
            public detect = detect;
        };
        const decoder = await createQrDecoder();
        expect(await decoder!.decode({ videoWidth: 0, videoHeight: 0 })).toBeNull();
        expect(detect).not.toHaveBeenCalled();
    });
});
