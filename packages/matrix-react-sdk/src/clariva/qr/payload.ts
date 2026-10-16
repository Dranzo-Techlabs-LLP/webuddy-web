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

/**
 * Clariva user QR payloads and deep links (spec 04 §3.17). PURE: no SDK, config or DOM imports, so it can also be
 * used by the shell before the app loads and by unit tests.
 *
 * Payload (what "My QR code" encodes and "Share link" shares):
 *     <user_link_base> + encodeURIComponent(matrixUserId)      e.g. https://clarivahub.com/u/%40jane%3Aclarivahub.com
 * `encodeURIComponent` is byte-identical to Android's `Uri.encode` for Matrix ids (both keep A-Za-z0-9 -_.!~*'()).
 *
 * Parsing mirrors Android's `ScanUserQrCodePresenter` / `IntentResolver` (host check, first path segment `u`, second
 * segment = percent-decoded id starting with "@" and containing ":"), with these web hardening differences:
 *  - the HOST is compared exactly (parsed `hostname`, case-insensitive) against an allow-list, so look-alikes such as
 *    `clarivahub.com.evil.net` or `evilclarivahub.com` or `clarivahub.com@evil.net` are rejected;
 *  - only http(s) URLs are considered; the id must be a well formed Matrix user id without control/bidi characters;
 *  - the extracted value is only ever used to open a profile, never to navigate to the scanned URL.
 * Bare Matrix ids and the common permalink forms (matrix.to, matrix:u/..., Element `#/user/..`) are accepted as
 * Android does through its permalink parser.
 */

const MAX_PAYLOAD_LENGTH = 2048;

/** `MatrixPatterns.isUserId` (Android): `^@\S*?:[A-Za-z0-9.-]+(:[0-9]{2,5})?$`, length <= 255. */
const USER_ID_PATTERN = /^@\S*?:[A-Za-z0-9.-]+(:[0-9]{2,5})?$/;

/**
 * What a scanned id must look like: a localpart WITHOUT a colon (Android's pattern lets the localpart swallow colons, so
 * "@jane:server:tld" would pass), then the server name with an optional numeric port.
 */
const SCANNABLE_ID_PATTERN = /^@[^\s:]+:[A-Za-z0-9.-]+(:[0-9]{2,5})?$/;

/** Control characters, zero-width and bidi override characters that could be used to spoof an id on screen. */
// eslint-disable-next-line no-control-regex
const SPOOFING_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/;

/** Element-family web clients whose `#/user/<id>` links the scanner understands (Android: DefaultMatrixToConverter). */
const ELEMENT_HOSTS = ["app.element.io", "develop.element.io", "staging.element.io"];

/** Android `MatrixPatterns.isUserId`. */
export function isMatrixUserId(candidate: string): boolean {
    return candidate.length <= 255 && USER_ID_PATTERN.test(candidate);
}

/**
 * A user id that is safe to open a profile for: Android's pattern, plus a non-empty colon-free localpart, a real server
 * name, and nothing that can spoof the UI (control / zero-width / bidi characters).
 */
export function isScannableUserId(candidate: string): boolean {
    return isMatrixUserId(candidate) && SCANNABLE_ID_PATTERN.test(candidate) && !SPOOFING_CHARS.test(candidate);
}

/** Normalise a configured `user_link_base` so that it ends with exactly one "/". */
export function normalizeUserLinkBase(base: string): string {
    const trimmed = base.trim();
    return trimmed.endsWith("/") ? trimmed : trimmed + "/";
}

/** The payload / share link for a Matrix user id. */
export function buildUserLink(matrixUserId: string, userLinkBase: string): string {
    return normalizeUserLinkBase(userLinkBase) + encodeURIComponent(matrixUserId);
}

/** Host names (lower-case, no port) of a URL, or null when it is not a parseable absolute URL. */
export function hostnameOf(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase() || null;
    } catch {
        return null;
    }
}

/**
 * Hosts that may carry a Clariva user link: the configured `user_link_base` host plus the host the web app itself is
 * served from (a user link generated for the web origin must work too). Exact names, lower-cased.
 */
export function allowedUserLinkHosts(userLinkBase: string, webAppHostname?: string): string[] {
    const hosts = new Set<string>();
    const baseHost = hostnameOf(userLinkBase);
    if (baseHost) hosts.add(baseHost);
    if (webAppHostname) hosts.add(webAppHostname.toLowerCase());
    return [...hosts];
}

function safeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null; // malformed percent-encoding
    }
}

/**
 * Android's `pathSegments` rule: split a URL path into non-empty, percent-decoded segments.
 * Returns null on malformed percent-encoding.
 */
export function decodedPathSegments(pathname: string): string[] | null {
    const out: string[] = [];
    for (const raw of pathname.split("/")) {
        if (!raw) continue;
        const decoded = safeDecode(raw);
        if (decoded === null) return null;
        out.push(decoded);
    }
    return out;
}

/**
 * `/u/<percent-encoded mxid>[/...]` (path of a Clariva user link, also used by the in-app `/u/<mxid>` deep link).
 * Returns the id or null. Query and fragment must already have been stripped (pass `URL.pathname`).
 */
export function userIdFromUserLinkPath(pathname: string): string | null {
    const segments = decodedPathSegments(pathname);
    if (!segments || segments.length < 2 || segments[0] !== "u") return null;
    const candidate = segments[1];
    return candidate.startsWith("@") && candidate.includes(":") && isScannableUserId(candidate) ? candidate : null;
}

/** `#/@id:server`, `#/user/@id:server` (optionally percent-encoded, optionally followed by `?via=...`). */
function userIdFromHash(hash: string, element: boolean): string | null {
    let fragment = hash.startsWith("#") ? hash.slice(1) : hash;
    const query = fragment.indexOf("?");
    if (query >= 0) fragment = fragment.slice(0, query);
    const decoded = safeDecode(fragment);
    if (decoded === null) return null;
    let rest = decoded.replace(/^\/+/, "");
    if (element) {
        if (!rest.startsWith("user/")) return null;
        rest = rest.slice("user/".length);
    }
    return rest.startsWith("@") && isScannableUserId(rest) ? rest : null;
}

/** `matrix:u/<localpart>:<server>[?action=chat]` (MSC2312 / RFC 3986 `matrix:` URI). */
function userIdFromMatrixUri(text: string): string | null {
    const match = /^matrix:(?:\/\/[^/?#]*\/)?u\/([^?#/]+)/i.exec(text);
    if (!match) return null;
    const decoded = safeDecode(match[1]);
    if (decoded === null) return null;
    const id = "@" + decoded;
    return isScannableUserId(id) ? id : null;
}

export interface ParseUserQrOptions {
    /**
     * Exact host names (lower-case, no port) that may carry `/u/<id>` links, see {@link allowedUserLinkHosts}.
     * Defaults to none: then only bare ids and permalink forms are accepted.
     */
    allowedHosts?: readonly string[];
}

/**
 * Parse whatever a QR code contained into a Matrix user id, or null ("Not a valid user QR code.").
 *  1. a bare Matrix id (`@jane:clarivahub.com`);
 *  2. `matrix:u/jane:clarivahub.com`;
 *  3. `https://<allowed host>/u/<encoded id>` (the Clariva payload) or `https://<allowed host>/#/user/<id>`;
 *  4. `https://matrix.to/#/@jane:clarivahub.com` and `https://app.element.io/#/user/@jane:clarivahub.com`.
 */
export function parseUserQrPayload(text: string, options: ParseUserQrOptions = {}): string | null {
    if (typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_PAYLOAD_LENGTH) return null;

    if (trimmed.startsWith("@")) return isScannableUserId(trimmed) ? trimmed : null;
    if (/^matrix:/i.test(trimmed)) return userIdFromMatrixUri(trimmed);

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // `https://clarivahub.com@evil.net/u/..` has hostname evil.net; embedded credentials are never legitimate here.
    if (url.username || url.password) return null;

    const host = url.hostname.toLowerCase();
    if (!host) return null;

    const allowed = (options.allowedHosts ?? []).map((h) => h.toLowerCase());
    if (allowed.includes(host)) {
        return userIdFromUserLinkPath(url.pathname) ?? userIdFromHash(url.hash, true);
    }
    if (host === "matrix.to") return userIdFromHash(url.hash, false);
    if (ELEMENT_HOSTS.includes(host)) return userIdFromHash(url.hash, true);
    return null;
}
