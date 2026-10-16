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

import { getClarivaConfig, isClarivaEnabled } from "../config";
import { allowedUserLinkHosts, buildUserLink, parseUserQrPayload } from "./payload";

/** "My QR code" / "Scan QR code" / Clariva share links are on (Clariva configured and `features.qr` not disabled). */
export function isQrEnabled(): boolean {
    return isClarivaEnabled() && getClarivaConfig().features.qr;
}

/**
 * The Clariva link of a user (`<user_link_base><encoded mxid>`) used by My QR code, "Share link", the profile "Share"
 * and the Start chat footer, or null when Clariva QR is off (callers then keep Element's matrix.to permalink).
 */
export function getUserShareLink(matrixUserId: string): string | null {
    return isQrEnabled() ? buildUserLink(matrixUserId, getClarivaConfig().user_link_base) : null;
}

/** Parse scanner text with this deployment's hosts (the `user_link_base` host and the host serving the web app). */
export function parseScannedUserQr(text: string): string | null {
    const webHost = typeof window !== "undefined" ? window.location?.hostname : undefined;
    const hosts = allowedUserLinkHosts(getClarivaConfig().user_link_base, webHost || undefined);
    return parseUserQrPayload(text, { allowedHosts: hosts });
}

/**
 * What the Start chat search should look up for what the user typed or pasted: a pasted Clariva user link, matrix.to
 * permalink or `matrix:` URI is resolved to the Matrix id it points at (so "paste the link someone sent me" finds
 * that user); everything else is searched as typed.
 */
export function searchQueryFor(term: string): string {
    return parseScannedUserQr(term.trim()) ?? term;
}
