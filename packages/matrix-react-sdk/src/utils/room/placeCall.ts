/*
Copyright 2023 The Matrix.org Foundation C.I.C.

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

import { CallType } from "matrix-js-sdk/src/webrtc/call";
import { Room } from "matrix-js-sdk/src/matrix";

import LegacyCallHandler from "../../LegacyCallHandler";
import { PlatformCallType } from "../../hooks/room/useRoomCall";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import { Action } from "../../dispatcher/actions";
import { isClarivaDmCall } from "../../clariva/calls/elementCallWidget"; // CLARIVA: calls
import { ClarivaCalls } from "../../clariva/calls/runtime"; // CLARIVA: calls

/**
 * Helper to place a call in a room that works with all the legacy modes
 * @param room the room to place the call in
 * @param callType the type of call
 * @param platformCallType the platform to pass the call on
 */
export const placeCall = async (
    room: Room,
    callType: CallType,
    platformCallType: PlatformCallType,
    skipLobby: boolean,
): Promise<void> => {
    if (platformCallType == PlatformCallType.LegacyCall || platformCallType == PlatformCallType.JitsiCall) {
        await LegacyCallHandler.instance.placeCall(room.roomId, callType);
    } else if (platformCallType == PlatformCallType.ElementCall) {
        // CLARIVA: every 1:1 entry point goes through the same function as the header's phone button (call-type record,
        // billing watcher, intent), spec 04 §7.1-A. Groups keep Element's flow.
        if (isClarivaDmCall(room)) {
            await ClarivaCalls.startCall(room, callType === CallType.Voice);
            return;
        }
        defaultDispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            view_call: true,
            skipLobby,
            metricsTrigger: undefined,
        });
    }
};
