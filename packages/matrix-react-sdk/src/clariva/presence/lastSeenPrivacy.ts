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

import { exceptToken, LastSeenAudience, type OnlineAudience, type PresencePrivacy } from "../profile/settings";

/**
 * The decisions of the "Last seen and online" page (Android `LastSeenPrivacyPresenter.handleEvent`), kept pure so the
 * component only wires them to the WalletStore.
 */

/**
 * The choice to save after picking a "Who can see my last seen" option, or `null` when there is nothing to save: the
 * option is already selected, or it is "My contacts except..." (which opens the contact picker instead). Any other
 * option drops the exclusion list.
 */
export function withLastSeenAudience(privacy: PresencePrivacy, audience: LastSeenAudience): PresencePrivacy | null {
    if (audience === LastSeenAudience.MyContactsExcept || audience === privacy.lastSeen) return null;
    return { ...privacy, lastSeen: audience, lastSeenExcept: new Set() };
}

/** The choice to save after picking a "Who can see when I'm online" option, `null` when it is already selected. */
export function withOnlineAudience(privacy: PresencePrivacy, audience: OnlineAudience): PresencePrivacy | null {
    return audience === privacy.online ? null : { ...privacy, online: audience };
}

/** Which of `contactIds` are excluded from seeing my last seen today (the picker's starting selection). */
export function excludedContactIds(privacy: PresencePrivacy, myId: string, contactIds: readonly string[]): Set<string> {
    return new Set(contactIds.filter((id) => privacy.lastSeenExcept.has(exceptToken(myId, id))));
}

/**
 * The choice to save when the picker is done: "My contacts except..." with the people ticked in it. Exclusions of
 * people missing from the list (e.g. a chat not loaded yet) are kept.
 */
export function withExceptions(
    privacy: PresencePrivacy,
    myId: string,
    listedContactIds: readonly string[],
    excludedIds: Iterable<string>,
): PresencePrivacy {
    const listed = new Set(listedContactIds.map((id) => exceptToken(myId, id)));
    const current = privacy.lastSeen === LastSeenAudience.MyContactsExcept ? privacy.lastSeenExcept : new Set<string>();
    const tokens = new Set([...current].filter((token) => !listed.has(token)));
    for (const id of excludedIds) tokens.add(exceptToken(myId, id));
    return { ...privacy, lastSeen: LastSeenAudience.MyContactsExcept, lastSeenExcept: tokens };
}
