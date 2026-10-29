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

import { sha256Hex } from "./sha256";

/**
 * The per-user `settings` JSON of the Wallet-API (`GET/PATCH /v1/users/{id}`), as the Android app reads and writes it
 * (webuddy-android ee053dc156: `WalletResponse.kt`, `PresencePrivacy.kt`, `WalletService.updateSettings`).
 *
 * Two keys are used:
 *  - `designation`: a consultant's self-chosen title ("Cardiologist"), shown as the badge under their name;
 *  - `presencePrivacy`: the WhatsApp-style "Last seen and online" choice, honoured by chat partners' apps.
 *
 * The server REPLACES the whole object on PATCH, so writers merge (see `mergeSettings`) and keep unknown keys.
 * Everything here must stay byte-compatible with Android: both apps read each other's values.
 */

/** Shown under a consultant's name when they have not set a designation. */
export const DEFAULT_CONSULTANT_DESIGNATION = "Consultant";
/** Longest designation a consultant can set; keeps the badge under their name on one line. */
export const MAX_DESIGNATION_LENGTH = 40;

export const SETTINGS_DESIGNATION_KEY = "designation";
export const SETTINGS_PRESENCE_PRIVACY_KEY = "presencePrivacy";

export type WalletSettings = Record<string, unknown>;

/** The settings object of a wallet row, or `null` when absent / not an object. */
export function settingsObject(settings: unknown): WalletSettings | null {
    return settings !== null && typeof settings === "object" && !Array.isArray(settings)
        ? (settings as WalletSettings)
        : null;
}

/** The designation stored in `settings`, or `null` if none / blank / not a string (Android `designation()`). */
export function designationOf(settings: unknown): string | null {
    const value = settingsObject(settings)?.[SETTINGS_DESIGNATION_KEY];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** The trimmed designation to save, `null` to remove it; throws for one longer than `MAX_DESIGNATION_LENGTH`. */
export function normalizeDesignation(designation: string | null | undefined): string | null {
    const value = designation?.trim() ?? "";
    if (value.length === 0) return null;
    if (value.length > MAX_DESIGNATION_LENGTH) {
        throw new Error(`Designation must be at most ${MAX_DESIGNATION_LENGTH} characters`);
    }
    return value;
}

/**
 * `settings` with only `key` changed (`value === null` removes it), all other keys kept. The Wallet-API replaces the
 * whole object, so this is what gets PATCHed (Android `updateSettings`).
 */
export function mergeSettings(current: unknown, key: string, value: unknown | null): WalletSettings {
    const merged: WalletSettings = {};
    const existing = settingsObject(current);
    if (existing) {
        for (const [k, v] of Object.entries(existing)) {
            if (k !== key) merged[k] = v;
        }
    }
    if (value !== null && value !== undefined) merged[key] = value;
    return merged;
}

// ─────────────────────────────── "Last seen and online" ───────────────────────────────

/** "Who can see my last seen" (WhatsApp's options). The string values are the stored keys. */
export enum LastSeenAudience {
    Everyone = "everyone",
    MyContacts = "contacts",
    MyContactsExcept = "contacts_except",
    Nobody = "nobody",
}

/** "Who can see when I'm online". */
export enum OnlineAudience {
    Everyone = "everyone",
    SameAsLastSeen = "same_as_last_seen",
}

/**
 * A user's "Last seen and online" choice. A "contact" is someone the user has a DM with that both of them have joined
 * (an unanswered chat request does not count). Excluded contacts are stored as `exceptToken`s rather than user IDs, so
 * the public settings record does not list who was excluded.
 */
export interface PresencePrivacy {
    lastSeen: LastSeenAudience;
    online: OnlineAudience;
    /** Only meaningful with `MyContactsExcept`. */
    lastSeenExcept: ReadonlySet<string>;
}

export const DEFAULT_PRESENCE_PRIVACY: PresencePrivacy = Object.freeze({
    lastSeen: LastSeenAudience.Everyone,
    online: OnlineAudience.Everyone,
    lastSeenExcept: new Set<string>(),
});

const KEY_LAST_SEEN = "lastSeen";
const KEY_ONLINE = "online";
const KEY_EXCEPT = "lastSeenExcept";

/**
 * Stable, non-reversible stand-in for "`ownerId` excludes `viewerId`". Salted with the owner so the same viewer gets a
 * different token in every user's list. Identical to Android: the first 16 bytes of
 * SHA-256("clariva-last-seen|<owner>|<viewer>"), lower-case hex.
 */
export function exceptToken(ownerId: string, viewerId: string): string {
    return sha256Hex(`clariva-last-seen|${ownerId}|${viewerId}`).slice(0, 32);
}

/** Whether `ownerId` (whose choice `privacy` is) shows their last seen to `viewerId`. */
export function sharesLastSeenWith(
    privacy: PresencePrivacy,
    ownerId: string,
    viewerId: string,
    isContact: boolean,
): boolean {
    switch (privacy.lastSeen) {
        case LastSeenAudience.Everyone:
            return true;
        case LastSeenAudience.MyContacts:
            return isContact;
        case LastSeenAudience.MyContactsExcept:
            return isContact && !privacy.lastSeenExcept.has(exceptToken(ownerId, viewerId));
        case LastSeenAudience.Nobody:
            return false;
    }
}

/** Whether `ownerId` shows "online" to `viewerId`. An online audience always includes the last-seen audience. */
export function sharesOnlineWith(
    privacy: PresencePrivacy,
    ownerId: string,
    viewerId: string,
    isContact: boolean,
): boolean {
    return privacy.online === OnlineAudience.Everyone || sharesLastSeenWith(privacy, ownerId, viewerId, isContact);
}

/** False when nobody at all may see this user's presence, so it need not be published. */
export function sharesWithAnyone(privacy: PresencePrivacy): boolean {
    return privacy.online === OnlineAudience.Everyone || privacy.lastSeen !== LastSeenAudience.Nobody;
}

/** Parses a stored value; anything missing or unrecognised falls back to "Everyone" (Android `fromJson`). */
export function presencePrivacyOf(settings: unknown): PresencePrivacy {
    const obj = settingsObject(settingsObject(settings)?.[SETTINGS_PRESENCE_PRIVACY_KEY]);
    if (!obj) return DEFAULT_PRESENCE_PRIVACY;
    const lastSeenKey = obj[KEY_LAST_SEEN];
    const onlineKey = obj[KEY_ONLINE];
    const lastSeen =
        (Object.values(LastSeenAudience) as string[]).includes(lastSeenKey as string)
            ? (lastSeenKey as LastSeenAudience)
            : LastSeenAudience.Everyone;
    const online =
        (Object.values(OnlineAudience) as string[]).includes(onlineKey as string)
            ? (onlineKey as OnlineAudience)
            : OnlineAudience.Everyone;
    const rawExcept = obj[KEY_EXCEPT];
    const lastSeenExcept = new Set<string>(
        Array.isArray(rawExcept) ? rawExcept.filter((t): t is string => typeof t === "string") : [],
    );
    return { lastSeen, online, lastSeenExcept };
}

/** The JSON stored under `presencePrivacy` (Android `toJson`: the except list only with "My contacts except"). */
export function presencePrivacyToJson(privacy: PresencePrivacy): WalletSettings {
    const json: WalletSettings = { [KEY_LAST_SEEN]: privacy.lastSeen, [KEY_ONLINE]: privacy.online };
    if (privacy.lastSeen === LastSeenAudience.MyContactsExcept && privacy.lastSeenExcept.size > 0) {
        json[KEY_EXCEPT] = [...privacy.lastSeenExcept].sort();
    }
    return json;
}

export function samePresencePrivacy(a: PresencePrivacy, b: PresencePrivacy): boolean {
    if (a.lastSeen !== b.lastSeen || a.online !== b.online) return false;
    if (a.lastSeenExcept.size !== b.lastSeenExcept.size) return false;
    for (const token of a.lastSeenExcept) if (!b.lastSeenExcept.has(token)) return false;
    return true;
}
