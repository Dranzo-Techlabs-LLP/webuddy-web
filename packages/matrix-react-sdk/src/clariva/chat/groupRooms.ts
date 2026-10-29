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

import { UIComponent } from "../../settings/UIFeature";
import { getClarivaConfig, isClarivaEnabled } from "../config";

/**
 * Group rooms and spaces are not part of Clariva yet (Android `ClarivaConfig.GROUP_ROOMS_ENABLED = false`). True while
 * Clariva is configured and `features.group_rooms` is off: the "Rooms" chip, "New room", "Join room by address", the
 * room directory and space creation are hidden. 1:1 chats are unaffected, and group rooms a user is already in keep
 * appearing in the chat list. Stock Element Web (no Clariva configuration) is never affected.
 */
export function clarivaHidesGroupRooms(): boolean {
    return isClarivaEnabled() && !getClarivaConfig().features.group_rooms;
}

/**
 * The stock UI switches that only exist for group rooms and spaces. "Create rooms" is NOT one of them: Element Web
 * gates "Start chat" with it too, so the "New room" entries are hidden one by one instead.
 */
const GROUP_ROOM_COMPONENTS: ReadonlySet<UIComponent> = new Set([UIComponent.ExploreRooms, UIComponent.CreateSpaces]);

/** Hook for `shouldShowComponent`: hide the room directory and space creation while group rooms are off. */
export function clarivaHidesComponent(component: UIComponent): boolean {
    return GROUP_ROOM_COMPONENTS.has(component) && clarivaHidesGroupRooms();
}

/**
 * Backstop for the DM creation paths: while group rooms are off a NEW chat has exactly one target (Android's Start
 * chat is single-selection), because a multi-person "DM" is a group room. Throws instead of creating anything; the
 * Start chat dialog only ever hands over one target, so this is never reached from the UI.
 */
export function refuseGroupDm(targetIds: readonly string[]): void {
    if (targetIds.length > 1 && clarivaHidesGroupRooms()) {
        throw new Error("Clariva: group chats are not available (features.group_rooms is off)");
    }
}
