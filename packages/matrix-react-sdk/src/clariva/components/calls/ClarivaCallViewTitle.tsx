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

import React, { useCallback } from "react";
import { type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { Icon as VideoCallSolidIcon } from "@vector-im/compound-design-tokens/icons/video-call-solid.svg";
import { Icon as VoiceCallIcon } from "@vector-im/compound-design-tokens/icons/voice-call.svg";

import RoomAvatar from "../../../components/views/avatars/RoomAvatar";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useTypedEventEmitterState } from "../../../hooks/useEventEmitter";
import { useClarivaCallDmPeerId } from "../../chat";
import { callsStrings } from "../../strings/calls";
import { useRoomCallState } from "../../calls/hooks";

interface Props {
    room: Room;
}

/**
 * The title strip above the Element Call frame of a 1:1 chat: the peer's avatar and name, and what kind of call it is
 * ("Voice call" / "Video call", when the live memberships say). Only for a chat Clariva places calls in (nothing
 * for a group or a video room: Element's own call view is untouched there).
 *
 * It reads existing state only (the room name, the live call memberships). There is NO duration on purpose: the host
 * has no ticking call clock to read and this strip must not add a timer of its own.
 *
 * Mount it as the first child of `.mx_CallView` (CallView.tsx, `JoinCallView`), guarded by `isClarivaEnabled()`:
 * the strip is a flex row ABOVE the widget (never over it: nothing blurred may overlap the call video), and the widget
 * frame (res/css/clariva/_calls.pcss) is laid out under it.
 */
export function ClarivaCallViewTitle({ room }: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const peerId = useClarivaCallDmPeerId(room);
    const call = useRoomCallState(room, client.getSafeUserId(), peerId);
    const name = useTypedEventEmitterState(
        room,
        RoomEvent.Name,
        useCallback(() => room.name, [room]),
    );
    if (peerId === null) return null;

    const MediaIcon = call.media === "video" ? VideoCallSolidIcon : VoiceCallIcon;
    const mediaLabel =
        call.media === "video" ? callsStrings.videoCall : call.media === "voice" ? callsStrings.voiceCall : null;

    return (
        <div className="mx_ClarivaCallViewTitle" data-testid="clariva-call-title">
            <RoomAvatar room={room} size="28px" />
            <span className="mx_ClarivaCallViewTitle_name">{name}</span>
            {mediaLabel && (
                <span className="mx_ClarivaCallViewTitle_media" data-call-media={call.media}>
                    <MediaIcon width="16px" height="16px" aria-hidden="true" />
                    {mediaLabel}
                </span>
            )}
        </div>
    );
}
