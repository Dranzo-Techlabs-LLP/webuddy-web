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

import { userIdFromUserLinkPath } from "./payload";
import { stashPendingDeepLink, userScreen } from "./pendingDeepLink";

/**
 * In-app side of the user deep link `https://<web-origin>/u/<percent-encoded mxid>` (spec 04 §3.17 / §6.12).
 *
 * Element Web is a hash-routed SPA, so a path URL has to be turned into the fragment route `#/user/<mxid>` before
 * the app reads its initial screen. The shell calls {@link rewriteUserDeepLink} once at start-up (see
 * `src/vector/index.ts`, marked CLARIVA). The host serving the SPA must return `index.html` (or redirect to
 * `/#/user/<id>`) for `/u/*`, see docs/clariva/IMPLEMENTATION-NOTES.md.
 *
 * PURE and import-light on purpose (this runs before the SDK is loaded). Host names are irrelevant here because the
 * link was delivered to OUR origin; only the path rule of the Clariva payload applies.
 */

export interface UserDeepLink {
    /** The Matrix user id. */
    userId: string;
    /** The location fragment to set, e.g. `#/user/%40jane%3Aclarivahub.com`. */
    hash: string;
}

/** The fragment route for a user profile. The id is percent-encoded; Element decodes it again (`url_utils`). */
export function userDeepLinkHash(userId: string): string {
    return "#/" + userScreen(encodeURIComponent(userId));
}

/** Parse `location.pathname`; returns null unless it is exactly the `/u/<mxid>` shape of the Clariva payload. */
export function parseUserDeepLinkPath(pathname: string): UserDeepLink | null {
    const userId = userIdFromUserLinkPath(pathname);
    return userId ? { userId, hash: userDeepLinkHash(userId) } : null;
}

interface RewriteTarget {
    location: Pick<Location, "pathname" | "search" | "hash">;
    history: Pick<History, "replaceState">;
}

/**
 * If the page was opened as `/u/<mxid>`: remember the link for the sign-in, replace the URL by `/#/user/<mxid>`
 * (no extra history entry, so Back does not return to the path form) and return the parsed link. Otherwise do
 * nothing and return null. Never throws.
 */
export function rewriteUserDeepLink(target: RewriteTarget = window): UserDeepLink | null {
    try {
        const link = parseUserDeepLinkPath(target.location.pathname);
        if (!link) return null;
        stashPendingDeepLink(link.userId);
        target.history.replaceState(null, "", "/" + link.hash);
        return link;
    } catch {
        return null;
    }
}
