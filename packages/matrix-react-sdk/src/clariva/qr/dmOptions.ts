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
 * Android `createDM` parameters that Element Web does not already apply (spec 04 §3.16 / §5.7).
 *
 * Android: `name=null, isEncrypted=true, isDirect=true, visibility=Private, preset=trusted_private_chat, invite=[user]`
 * plus `power_level_content_override.events = {"m.call.member": 0, "org.matrix.msc3401.call.member": 0}` so that both
 * parties can publish call membership. Element Web's `createRoom({dmUserId})` already produces `is_direct`,
 * `private`, `trusted_private_chat` and the `invite`; the two differences handled by Clariva are
 *  - the power-level override below, and
 *  - encryption is unconditional for 1:1 chats (see `determineCreateRoomEncryptionOption`).
 *
 * NOTE: Synapse applies `power_level_content_override` with a SHALLOW `dict.update`, i.e. an `events` map REPLACES the
 * room preset's whole default `events` map (m.room.name 50, m.room.power_levels 100, ...). Android accepts that
 * because both DM members get power level 100 in a `trusted_private_chat`; the web keeps Element's explicit defaults
 * in the override as well, which is equivalent for 2 members at PL 100 and does not weaken a room if a third member is
 * ever added.
 *
 * Creating a DM never debits anything (spec 04 §3.16): billing is deferred to the first message / answered call, so
 * there is intentionally no wallet call in this path.
 */

/** Event types every member of a Clariva DM may publish (membership state events of MatrixRTC calls). */
export const CLARIVA_DM_CALL_MEMBER_EVENT_TYPES: readonly string[] = [
    "m.call.member",
    "org.matrix.msc3401.call.member",
];

export interface PowerLevelsOverride {
    events?: Record<string, number>;
    [key: string]: unknown;
}

/**
 * Add the call-membership overrides to a `power_level_content_override`, keeping whatever the caller already set
 * (e.g. Element's group-call defaults) and the given default event levels.
 */
export function withClarivaDmPowerLevels<T extends PowerLevelsOverride>(
    existing: T | undefined,
    defaultEventLevels: Record<string, number> = {},
): T & { events: Record<string, number> } {
    const events: Record<string, number> = { ...defaultEventLevels, ...existing?.events };
    for (const type of CLARIVA_DM_CALL_MEMBER_EVENT_TYPES) events[type] = 0;
    return { ...(existing as T), events };
}
