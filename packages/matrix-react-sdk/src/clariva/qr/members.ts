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

import { DirectoryMember, type Member } from "../../utils/direct-messages";
import { type SearchRow } from "./userSearch";

/*
 * NOTE: no `class X extends DirectoryMember` here. `utils/direct-messages` takes part in an import cycle with the
 * dialogs, and a module-level `extends` of a not-yet-initialised class would crash at load time. `DirectoryMember` is
 * only used inside functions below, which is always safe.
 */

/** A Matrix id the user typed whose profile could not be found (Android shows it with a warning, but allows it). */
type UnresolvedMarker = { readonly unresolved: true };

export function isUnresolvedMember(member: Member): boolean {
    return (member as Partial<UnresolvedMarker>).unresolved === true;
}

/** Search row -> the `Member` the invite dialog works with. */
export function memberFromRow(row: SearchRow): Member {
    const member = new DirectoryMember({
        user_id: row.userId, // eslint-disable-line camelcase
        display_name: row.displayName, // eslint-disable-line camelcase
        avatar_url: row.avatarUrl, // eslint-disable-line camelcase
    });
    return row.unresolved ? Object.assign(member, { unresolved: true as const }) : member;
}
