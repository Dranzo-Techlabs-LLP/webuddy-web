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

import { DEFAULT_CONSULTANT_DESIGNATION, MAX_DESIGNATION_LENGTH } from "../profile/settings";

/**
 * User-visible English strings of presence ("online" / "last seen ..."), the "Last seen and online" privacy page and the
 * consultant's designation (webuddy-android ee053dc156: DmPeerStatus.kt, LastSeenPrivacyView.kt,
 * PreferencesRootView.kt). The Android copy is kept word for word, lower case "online" / "last seen" included (it is
 * WhatsApp's wording). [WEB] marks copy that only exists on the web.
 */
export const profileStrings = {
    // ── the DM partner's presence (header) ──
    /** Exactly "online": the header colours the line by comparing with it, like Android. */
    presenceOnline: "online",
    lastSeenToday: (time: string): string => `last seen today at ${time}`,
    lastSeenYesterday: (time: string): string => `last seen yesterday at ${time}`,
    /** `day` is the short weekday, e.g. "Thu". */
    lastSeenWeekday: (day: string, time: string): string => `last seen ${day} at ${time}`,
    /** `date` is the short numeric date in the locale's order, e.g. "23/10/26". */
    lastSeenDate: (date: string, time: string): string => `last seen ${date}, ${time}`,

    // ── Settings: "Last seen and online" ──
    lastSeenTitle: "Last seen and online",
    lastSeenWho: "Who can see my last seen",
    onlineWho: "Who can see when I'm online",
    audienceEveryone: "Everyone",
    audienceMyContacts: "My contacts",
    audienceMyContactsExcept: "My contacts except...",
    audienceNobody: "Nobody",
    onlineSameAsLastSeen: "Same as last seen",
    reciprocityNote:
        "If you don't share when you were last seen or online, you won't be able to see when other people were last seen or online.",
    excludedSummary: (count: number): string =>
        count === 0 ? "No contacts excluded" : count === 1 ? "1 contact excluded" : `${count} contacts excluded`,
    saveFailed: "Couldn't save your choice. Please try again.",
    /** [WEB] the "My contacts except..." row's button that reopens the picker. */
    editExceptions: "Edit",

    // ── the contacts picker of "My contacts except..." ──
    exceptTitle: "Hide my last seen from",
    exceptEmpty: "You don't have any chats yet. People you chat with will appear here.",
    exceptHint: "Selected contacts won't see your last seen. Everyone else you chat with will.",
    exceptDone: "Done",
    /** [WEB] */
    exceptCancel: "Cancel",

    // ── Settings: the consultant's designation ──
    designationTitle: "Designation",
    designationHint: `Shown under your name in chats. Leave it empty to show "${DEFAULT_CONSULTANT_DESIGNATION}".`,
    designationPlaceholder: "e.g. Cardiologist",
    designationTooLong: `Use at most ${MAX_DESIGNATION_LENGTH} characters.`,
    designationSave: "Save",
    designationSaveFailed: "Couldn't save your designation. Please try again.",
    /** [WEB] the button that opens the editor. */
    designationEdit: "Edit",
    /** [WEB] */
    designationCancel: "Cancel",
} as const;
