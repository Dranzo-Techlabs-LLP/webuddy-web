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

import { chatsStrings as S } from "../../strings/chats";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function format(locale: string | undefined, options: Intl.DateTimeFormatOptions, date: Date): string {
    try {
        return new Intl.DateTimeFormat(locale, options).format(date);
    } catch {
        return date.toLocaleDateString(); // unknown locale tag
    }
}

/**
 * The timestamp at the top-right of a chat row, Android style: the time today, "Yesterday", the weekday within the last
 * week, then "May 6" (and the year once it is not this year). "" when there is nothing sensible to show (no events yet,
 * or the room has no timeline and the room-list sorter returned MAX_SAFE_INTEGER).
 */
export function formatChatTimestamp(ts: number, now: Date = new Date(), locale?: string): string {
    if (!Number.isFinite(ts) || ts <= 0 || ts > now.getTime() + DAY_MS) return "";
    const date = new Date(ts);
    const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
    if (days <= 0) return format(locale, { hour: "numeric", minute: "2-digit" }, date);
    if (days === 1) return S.yesterday;
    if (days < 7) return format(locale, { weekday: "short" }, date);
    if (date.getFullYear() === now.getFullYear()) return format(locale, { month: "short", day: "numeric" }, date);
    return format(locale, { year: "numeric", month: "short", day: "numeric" }, date);
}
