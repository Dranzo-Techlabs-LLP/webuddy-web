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

import { formatTime } from "../../DateUtils";
import { getUserLanguage } from "../../languageHandler";
import { type PresencePrivacy, sharesLastSeenWith, sharesOnlineWith } from "../profile/settings";
import { profileStrings as S } from "../strings/profile";

/** A user's Matrix presence as the homeserver reports it (Android `UserPresence`). */
export interface UserPresence {
    isOnline: boolean;
    /** Wall-clock time (ms) of the user's last activity, `null` when the server does not say. */
    lastActiveTs: number | null;
}

/** The body of `GET /_matrix/client/v3/presence/{userId}/status` (only what is read). */
export interface PresenceStatusBody {
    presence?: string;
    last_active_ago?: number; // eslint-disable-line camelcase
}

/** `UserPresence` from a presence response that arrived at `receivedAt` (Android `MatrixPresenceService.getPresence`). */
export function userPresenceOf(body: PresenceStatusBody | null | undefined, receivedAt: number): UserPresence {
    const ago = body?.last_active_ago;
    return {
        isOnline: body?.presence === "online",
        lastActiveTs: typeof ago === "number" && Number.isFinite(ago) ? receivedAt - ago : null,
    };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;

function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Whole calendar days from `from` to `to` in the local time zone; never negative (clock skew). */
export function calendarDaysBetween(from: number, to: number): number {
    // rounded rather than truncated: a day is 23 or 25 hours across a DST change
    const days = Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
    return Math.max(0, days);
}

export interface LastSeenFormat {
    /** The user's "Show timestamps in 12 hour format" setting. */
    showTwelveHour?: boolean;
    /** BCP 47 locale; the app language by default. */
    locale?: string;
}

/**
 * Short enough for the line under the name next to the call / refund buttons (Android `formatLastSeen`):
 * "last seen today at 10:30", "last seen yesterday at ...", "last seen Thu at ..." within the past week, and
 * "last seen 23/10/26, 10:30" (the locale's date order) before that. `null` when the time is unknown.
 */
export function formatLastSeen(lastActiveTs: number | null, now: number, format: LastSeenFormat = {}): string | null {
    if (lastActiveTs === null) return null;
    const locale = format.locale ?? getUserLanguage();
    const date = new Date(lastActiveTs);
    const time = formatTime(date, format.showTwelveHour ?? false, locale);
    const days = calendarDaysBetween(lastActiveTs, now);
    if (days === 0) return S.lastSeenToday(time);
    if (days === 1) return S.lastSeenYesterday(time);
    if (days < DAYS_IN_WEEK) {
        return S.lastSeenWeekday(new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date), time);
    }
    const day = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
    return S.lastSeenDate(day, time);
}

export interface VisiblePresenceInput {
    presence: UserPresence;
    myId: string;
    peerId: string;
    /** Both people have joined the DM (an unanswered chat request does not make a contact). */
    isContact: boolean;
    /** My own choice (the default "Everyone" while it is not loaded yet, like Android). */
    myPrivacy: PresencePrivacy;
    /** The partner's choice; `undefined` = not known yet, and their presence stays hidden (fail closed). */
    peerPrivacy: PresencePrivacy | undefined;
    now: number;
    format?: LastSeenFormat;
}

/**
 * The label for the partner's presence, or `null` when either person's choice hides it (Android
 * `visiblePresenceLabel`). Presence honours BOTH choices, the WhatsApp way: the partner's status shows only if they
 * share it with me AND I share the same kind of status (last seen / online) with them. "online" is never downgraded
 * to "last seen just now": if online is hidden, so is last seen, because an online audience always includes the
 * last-seen audience.
 */
export function visiblePresenceLabel(input: VisiblePresenceInput): string | null {
    const { presence, myId, peerId, isContact, myPrivacy, peerPrivacy } = input;
    if (!peerPrivacy) return null;
    if (presence.isOnline) {
        const canSeeOnline =
            sharesOnlineWith(peerPrivacy, peerId, myId, isContact) &&
            sharesOnlineWith(myPrivacy, myId, peerId, isContact);
        return canSeeOnline ? S.presenceOnline : null;
    }
    const canSeeLastSeen =
        sharesLastSeenWith(peerPrivacy, peerId, myId, isContact) &&
        sharesLastSeenWith(myPrivacy, myId, peerId, isContact);
    return canSeeLastSeen ? formatLastSeen(presence.lastActiveTs, input.now, input.format) : null;
}
