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

import DecoratedRoomAvatar from "../../../components/views/avatars/DecoratedRoomAvatar";
import { useRoomName } from "../../../hooks/useRoomName";
import { homeStrings as S } from "../../strings/home";
import { ClarivaRoomTileRate } from "../chat/RoomTileRate";
import { openChat, useRecentChats } from "./recentChats";

/** The size of a rail avatar in px (CSS lays the item out around it). */
export const RAIL_AVATAR_SIZE = "56px";

function RailItem({ room }: { room: Room }): JSX.Element {
    const name = useRoomName(room);
    return (
        <li className="mx_ClarivaRail_cell">
            <button
                type="button"
                className="mx_ClarivaRail_item"
                onClick={() => openChat(room.roomId)}
                data-testid="clariva-home-chat"
            >
                {/* decorative: the unread badge and the presence dot are announced by the chat list row, not here */}
                <span className="mx_ClarivaRail_avatar" aria-hidden="true">
                    <DecoratedRoomAvatar
                        room={room}
                        size={RAIL_AVATAR_SIZE}
                        displayBadge={true}
                        tooltipProps={{ tabIndex: -1 }}
                    />
                </span>
                <span className="mx_ClarivaRail_name" dir="auto">
                    {name}
                </span>
                <span className="mx_ClarivaRail_rate">
                    <ClarivaRoomTileRate room={room} />
                </span>
            </button>
        </li>
    );
}

/**
 * "Recent chats": the user's latest one-to-one chats (at most eight) as an avatar, the name and, for a consultant, the
 * amber rate tag. A row you scroll sideways (scroll-snap, soft fades at both ends); a click opens the chat exactly like
 * the Chats list does. Renders nothing while there are no chats (the Start a chat tile is right below).
 */
export function ConsultantsRail(): JSX.Element | null {
    const rooms = useRecentChats();
    if (rooms.length === 0) return null;
    return (
        <section className="mx_ClarivaRail" aria-labelledby="mx_ClarivaRail_heading" data-testid="clariva-home-rail">
            <h2 className="mx_ClarivaHome_heading" id="mx_ClarivaRail_heading">
                {S.recentChats}
            </h2>
            <ul className="mx_ClarivaRail_list" aria-label={S.recentChatsList}>
                {rooms.map((room) => (
                    <RailItem key={room.roomId} room={room} />
                ))}
            </ul>
        </section>
    );
}

export default ConsultantsRail;
