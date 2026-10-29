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

import React from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import RoomAvatar from "../../../components/views/avatars/RoomAvatar";
import { type IOOBData } from "../../../stores/ThreepidInviteStore";
import { useDmPeerStatus } from "../../presence/useDmPeerStatus";
import { profileStrings } from "../../strings/profile";

interface Props {
    room: Room;
    oobData?: IOOBData;
    /** CSS size of the avatar, e.g. `40px` (header) or `72px` (intro card). */
    size: string;
    onClick?: () => void;
}

/**
 * The room avatar inside a presence ring: the ring is teal while the other party of a 1:1 chat shows as "online" in the
 * header (same source and the same "Last seen and online" rules, see `useDmPeerStatus`), and there is simply no ring
 * otherwise. The state is also available to assistive tech as visually hidden text (the ring is not the only carrier
 * of it).
 */
export function ClarivaRoomAvatar({ room, oobData, size, onClick }: Props): JSX.Element {
    const state = useDmPeerStatus(room).online ? "online" : null;
    return (
        <span
            className="mx_ClarivaRoomAvatar"
            data-presence={state ?? "none"}
            data-testid="clariva-room-avatar"
            style={{ "--cg-avatar-size": size } as React.CSSProperties}
        >
            <RoomAvatar room={room} size={size} oobData={oobData} onClick={onClick} />
            {state === "online" && <span className="mx_ClarivaRoomAvatar_sr">{profileStrings.presenceOnline}</span>}
        </span>
    );
}
