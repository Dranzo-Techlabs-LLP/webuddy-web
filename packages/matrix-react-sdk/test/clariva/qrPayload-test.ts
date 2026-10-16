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

import {
    allowedUserLinkHosts,
    buildUserLink,
    decodedPathSegments,
    isMatrixUserId,
    isScannableUserId,
    normalizeUserLinkBase,
    parseUserQrPayload,
    userIdFromUserLinkPath,
} from "../../src/clariva/qr/payload";

const BASE = "https://clarivahub.com/u/";
const HOSTS = allowedUserLinkHosts(BASE);
const parse = (text: string): string | null => parseUserQrPayload(text, { allowedHosts: HOSTS });

describe("Clariva QR payload (spec 04 §3.17)", () => {
    describe("buildUserLink", () => {
        it("matches the Android payload: base + percent-encoded Matrix id", () => {
            expect(buildUserLink("@jane:clarivahub.com", BASE)).toBe(
                "https://clarivahub.com/u/%40jane%3Aclarivahub.com",
            );
        });

        it("adds the missing trailing slash of a configured base", () => {
            expect(normalizeUserLinkBase(" https://clarivahub.com/u ")).toBe("https://clarivahub.com/u/");
            expect(buildUserLink("@a:b.c", "https://app.example.org/u")).toBe("https://app.example.org/u/%40a%3Ab.c");
        });

        it("encodes like Android's Uri.encode (which keeps A-Za-z0-9 -_.!~*'())", () => {
            const link = buildUserLink("@a!b~c*d'e(f)g.h-i_j:clarivahub.com", BASE);
            expect(link).toBe("https://clarivahub.com/u/%40a!b~c*d'e(f)g.h-i_j%3Aclarivahub.com");
        });
    });

    describe("round trip build -> parse", () => {
        it.each([
            "@jane:clarivahub.com",
            "@mohamed.shimil4:clarivahub.com",
            "@legacy-3f2a9c1e-77d1-4e0a-9d2e-0c1f5b8a6d11:clarivahub.com",
            "@a+b=c/d:clarivahub.com",
            "@x:example.org:8448",
            "@Upper.Case:Example.ORG",
            "@o'brien(1):clarivahub.com",
        ])("%s", (id) => {
            expect(parse(buildUserLink(id, BASE))).toBe(id);
        });
    });

    describe("accepts", () => {
        const link = "https://clarivahub.com/u/%40jane%3Aclarivahub.com";

        it("the canonical link, with surrounding whitespace and a trailing newline", () => {
            expect(parse(`  ${link}\n`)).toBe("@jane:clarivahub.com");
        });

        it("a case-insensitive host (Android compares ignoring case)", () => {
            expect(parse("HTTPS://ClarivaHub.COM/u/%40jane%3Aclarivahub.com")).toBe("@jane:clarivahub.com");
        });

        it("any port and http (Android checks neither); the extracted value is only used to open a profile", () => {
            expect(parse("http://clarivahub.com:8080/u/%40jane%3Aclarivahub.com")).toBe("@jane:clarivahub.com");
        });

        it("ignores query and fragment", () => {
            expect(parse(`${link}?utm=qr#top`)).toBe("@jane:clarivahub.com");
        });

        it("an unencoded id in the path", () => {
            expect(parse("https://clarivahub.com/u/@jane:clarivahub.com")).toBe("@jane:clarivahub.com");
        });

        it("further path segments after the id", () => {
            expect(parse(`${link}/extra`)).toBe("@jane:clarivahub.com");
        });

        it("the host the web app is served from, in addition to user_link_base", () => {
            const hosts = allowedUserLinkHosts(BASE, "App.Clarivahub.com");
            expect(hosts).toEqual(["clarivahub.com", "app.clarivahub.com"]);
            expect(
                parseUserQrPayload("https://app.clarivahub.com/u/%40jane%3Aclarivahub.com", { allowedHosts: hosts }),
            ).toBe("@jane:clarivahub.com");
            expect(
                parseUserQrPayload("https://app.clarivahub.com/#/user/%40jane%3Aclarivahub.com", {
                    allowedHosts: hosts,
                }),
            ).toBe("@jane:clarivahub.com");
        });

        it("a bare Matrix id", () => {
            expect(parse("@jane:clarivahub.com")).toBe("@jane:clarivahub.com");
            expect(parse("  @jane:clarivahub.com \n")).toBe("@jane:clarivahub.com");
        });

        it.each([
            ["matrix.to", "https://matrix.to/#/@jane:clarivahub.com"],
            ["matrix.to (encoded)", "https://matrix.to/#/%40jane%3Aclarivahub.com"],
            ["matrix.to with via", "https://matrix.to/#/@jane:clarivahub.com?via=clarivahub.com"],
            ["element", "https://app.element.io/#/user/@jane:clarivahub.com"],
            ["matrix: URI", "matrix:u/jane:clarivahub.com"],
            ["matrix: URI with action", "matrix:u/jane:clarivahub.com?action=chat"],
        ])("the %s form", (_name, text) => {
            expect(parse(text)).toBe("@jane:clarivahub.com");
        });
    });

    describe('rejects ("Not a valid user QR code.")', () => {
        const id = "%40jane%3Aclarivahub.com";

        it.each([
            ["a look-alike sub-domain", `https://clarivahub.com.evil.net/u/${id}`],
            ["a look-alike prefix", `https://evilclarivahub.com/u/${id}`],
            ["credentials that hide the real host", `https://clarivahub.com@evil.net/u/${id}`],
            ["credentials on the real host", `https://user:pw@clarivahub.com/u/${id}`],
            ["the real host in the path of another host", `https://evil.net/https://clarivahub.com/u/${id}`],
            ["www. (Android does not accept it either)", `https://www.clarivahub.com/u/${id}`],
            ["a trailing-dot host", `https://clarivahub.com./u/${id}`],
            ["an IDN look-alike host", `https://clarivаhub.com/u/${id}`],
            ["a different first segment", `https://clarivahub.com/x/${id}`],
            ["an upper-case first segment (Android compares exactly)", `https://clarivahub.com/U/${id}`],
            ["no id", "https://clarivahub.com/u/"],
            ["only /u", "https://clarivahub.com/u"],
            ["an id without @", "https://clarivahub.com/u/jane%3Aclarivahub.com"],
            ["an id without a server", "https://clarivahub.com/u/%40jane"],
            ["an empty localpart", "https://clarivahub.com/u/%40%3Aclarivahub.com"],
            ["a double-encoded id", "https://clarivahub.com/u/%2540jane%253Aclarivahub.com"],
            ["malformed percent-encoding", "https://clarivahub.com/u/%E0%A4%A"],
            ["a room id", "https://clarivahub.com/u/%21room%3Aclarivahub.com"],
            ["javascript:", "javascript:alert(1)"],
            ["data:", "data:text/html,<script>alert(1)</script>"],
            ["ftp:", `ftp://clarivahub.com/u/${id}`],
            ["a matrix.to room link", "https://matrix.to/#/!room:clarivahub.com"],
            ["a matrix.to alias link", "https://matrix.to/#/%23alias:clarivahub.com"],
            ["a look-alike matrix.to host", "https://matrix.to.evil.net/#/@jane:clarivahub.com"],
            ["a look-alike element host", "https://app.element.io.evil.net/#/user/@jane:clarivahub.com"],
            ["a matrix: room URI", "matrix:r/room:clarivahub.com"],
            ["a localpart without a server", "@jane"],
            ["an id without the leading @", "jane:clarivahub.com"],
            ["plain text", "hello world"],
            ["an empty payload", ""],
            ["whitespace only", "   \n"],
        ])("%s", (_name, text) => {
            expect(parse(text)).toBeNull();
        });

        it("ids that could spoof the UI (control, zero-width and bidi override characters)", () => {
            expect(parse("@ja‮ne:clarivahub.com")).toBeNull();
            expect(parse("@ja​ne:clarivahub.com")).toBeNull();
            expect(parse("@ja\u0000ne:clarivahub.com")).toBeNull();
            expect(parse("https://clarivahub.com/u/%40ja%E2%80%AEne%3Aclarivahub.com")).toBeNull();
            expect(isScannableUserId("@ja﻿ne:clarivahub.com")).toBe(false);
        });

        it("non-string and oversized input", () => {
            expect(parse(undefined as unknown as string)).toBeNull();
            expect(parse(null as unknown as string)).toBeNull();
            expect(parse(`https://clarivahub.com/u/%40${"a".repeat(300)}%3Aclarivahub.com`)).toBeNull();
            expect(parse("https://clarivahub.com/u/" + "x".repeat(5000))).toBeNull();
        });

        it("a Clariva link on a host that was not configured (no allow-list => only bare ids and permalinks)", () => {
            expect(parseUserQrPayload(`https://clarivahub.com/u/${id}`)).toBeNull();
            expect(parseUserQrPayload("@jane:clarivahub.com")).toBe("@jane:clarivahub.com");
        });
    });

    describe("helpers", () => {
        it("isMatrixUserId is Android's MatrixPatterns.isUserId", () => {
            expect(isMatrixUserId("@jane:clarivahub.com")).toBe(true);
            expect(isMatrixUserId("@jane:clarivahub.com:8448")).toBe(true);
            expect(isMatrixUserId("@:clarivahub.com")).toBe(true); // Android allows an empty localpart...
            expect(isScannableUserId("@:clarivahub.com")).toBe(false); // ...but a scan must not
            expect(isMatrixUserId("@jane")).toBe(false);
            expect(isMatrixUserId("@jane:")).toBe(false);
            expect(isMatrixUserId("@jane:bad_domain")).toBe(false);
            expect(isMatrixUserId("@jane doe:server.tld")).toBe(false);
            // Android's lazy `\S*?` lets the localpart swallow colons...
            expect(isMatrixUserId("@jane:server:tld")).toBe(true);
            // ...which a scan must not accept
            expect(isScannableUserId("@jane:server:tld")).toBe(false);
            expect(isScannableUserId("@jane:clarivahub.com:8448")).toBe(true);
            expect(isMatrixUserId("@" + "a".repeat(260) + ":x.org")).toBe(false);
        });

        it("decodedPathSegments drops empty segments and decodes each one", () => {
            expect(decodedPathSegments("//u//%40a%3Ab/")).toEqual(["u", "@a:b"]);
            expect(decodedPathSegments("/u/%E0%A4%A")).toBeNull();
        });

        it("userIdFromUserLinkPath applies the /u/<id> rule only", () => {
            expect(userIdFromUserLinkPath("/u/%40a%3Ab.c")).toBe("@a:b.c");
            expect(userIdFromUserLinkPath("/v/%40a%3Ab.c")).toBeNull();
            expect(userIdFromUserLinkPath("/%40a%3Ab.c")).toBeNull();
        });

        it("allowedUserLinkHosts ignores an unparsable base", () => {
            expect(allowedUserLinkHosts("not a url")).toEqual([]);
            expect(allowedUserLinkHosts("not a url", "localhost")).toEqual(["localhost"]);
        });
    });
});
