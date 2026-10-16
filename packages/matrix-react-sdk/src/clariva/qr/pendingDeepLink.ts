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
 * A user deep link (`/u/<mxid>`) that was opened while the visitor was signed out must survive the Clariva
 * sign-in (Android drops it, spec 04 §3.17 / 7.1-H; the web must not).
 *
 * Element already remembers the "screen after login" in `sessionStorage["mx_screen_after_login"]` (shell
 * `routing.ts`), but a reload onto the login screen (e.g. a redirect-based sign-in, or the user pressing F5 on the
 * sign-in form) overwrites it. This module keeps a separate, expiring record that the shell consults when it has to
 * pick the screen to show after login (`getInitialScreenAfterLogin`), and that is cleared as soon as the user
 * profile is actually shown (`onNewScreen("user/...")`).
 *
 * Public API for other workstreams (e.g. AUTH): `stashPendingDeepLink`, `peekPendingDeepLink`,
 * `clearPendingDeepLink`, `pendingDeepLinkScreen`. Every storage access is wrapped in try/catch (private windows,
 * blocked storage) and the module has NO imports, so the shell may load it before the SDK.
 */

/** sessionStorage key. Tab-scoped on purpose: a link must never leak into another tab or a later browser session. */
export const PENDING_DEEP_LINK_KEY = "mx_clariva_pending_user_link";

/** A link that was never delivered is dropped after this long (a stale link must not hijack a later sign-in). */
export const PENDING_DEEP_LINK_TTL_MS = 30 * 60 * 1000;

interface StoredLink {
    userId: string;
    storedAt: number;
}

function storage(): Storage | null {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch {
        return null;
    }
}

/** Remember that `userId`'s profile should be shown once the user is signed in. */
export function stashPendingDeepLink(userId: string, now: number = Date.now()): void {
    try {
        const record: StoredLink = { userId, storedAt: now };
        storage()?.setItem(PENDING_DEEP_LINK_KEY, JSON.stringify(record));
    } catch {
        // ignore: the stock `mx_screen_after_login` mechanism is still in place
    }
}

/** The pending user id, or null (none stored, expired, corrupt or storage unavailable). Expired records are removed. */
export function peekPendingDeepLink(now: number = Date.now()): string | null {
    const store = storage();
    if (!store) return null;
    try {
        const raw = store.getItem(PENDING_DEEP_LINK_KEY);
        if (!raw) return null;
        const record = JSON.parse(raw) as Partial<StoredLink> | null;
        if (
            !record ||
            typeof record.userId !== "string" ||
            typeof record.storedAt !== "number" ||
            now - record.storedAt > PENDING_DEEP_LINK_TTL_MS ||
            now < record.storedAt - 60_000 // clock moved backwards by more than a minute: do not trust it
        ) {
            store.removeItem(PENDING_DEEP_LINK_KEY);
            return null;
        }
        return record.userId;
    } catch {
        try {
            store.removeItem(PENDING_DEEP_LINK_KEY);
        } catch {
            // ignore
        }
        return null;
    }
}

/** Forget the pending link (it was delivered, or the user went elsewhere on purpose). */
export function clearPendingDeepLink(): void {
    try {
        storage()?.removeItem(PENDING_DEEP_LINK_KEY);
    } catch {
        // ignore
    }
}

/** Element screen name for a user profile: `user/<mxid>` (the fragment route is `#/user/<mxid>`). */
export function userScreen(userId: string): string {
    return "user/" + userId;
}

/** The pending link as an Element "screen after login" (`{screen, params}`), or undefined. Does NOT clear it. */
export function pendingDeepLinkScreen(now?: number): { screen: string; params: Record<string, never> } | undefined {
    const userId = peekPendingDeepLink(now);
    return userId ? { screen: userScreen(userId), params: {} } : undefined;
}

/** Screens of the sign-in / sign-up flow: a reload onto one of these must not discard a pending deep link. */
const AUTH_SCREENS = new Set(["", "welcome", "login", "register", "mobile_register", "forgot_password", "soft_logout"]);

/**
 * Choose the "screen after login" the shell hands to `MatrixChat`: Element's own stored screen, unless that is
 * missing or merely a sign-in screen (the page was reloaded during sign-in, which overwrote it) and a user deep link
 * is still pending - then the deep link wins. A newer real destination (room, another user, ...) always wins.
 */
export function withPendingDeepLink<T extends { screen: string }>(
    stored: T | undefined,
    now?: number,
): T | { screen: string; params: Record<string, never> } | undefined {
    if (stored && !AUTH_SCREENS.has(stored.screen)) return stored;
    return pendingDeepLinkScreen(now) ?? stored;
}

/**
 * Call with every screen the app navigates to (shell `onNewScreen`): once the profile of the pending user is on
 * screen the link has been delivered. Any other screen that is not part of the sign-in flow does NOT clear it, so
 * that e.g. the "welcome"/"login" navigation during sign-in keeps it alive.
 */
export function noteScreenShown(screen: string): void {
    if (screen.startsWith("user/")) clearPendingDeepLink();
}
