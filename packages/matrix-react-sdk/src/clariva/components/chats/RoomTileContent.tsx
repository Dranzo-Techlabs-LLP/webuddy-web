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

import React, { type ReactNode } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import DecoratedRoomAvatar from "../../../components/views/avatars/DecoratedRoomAvatar";
import { DefaultTagID, type TagID } from "../../../stores/room-list/models";
import { ClarivaRefundPill } from "../refund/ClarivaRefundPill";
import { ClarivaRoomTileRate } from "../chat/RoomTileRate";
import { ClarivaRoomTileTime } from "./RoomTileTime";

/** The avatar of a chat row, in px (the presence ring and the row geometry in _chats.pcss are built around it). */
export const ROOM_TILE_AVATAR_SIZE = "52px";

interface Props {
    room: Room;
    tag: TagID;
    /** Roving-tabindex state of the row (the presence/globe badge on the avatar is focusable for its tooltip). */
    isActive: boolean;
    /** Title, already carrying the stock "unread" modifier class. */
    title: ReactNode;
    /** Message preview (`RoomTileSubtitle`), `null` when there is none. */
    subtitle: ReactNode;
    /** Unread count / dot badge (hidden while the row's menu buttons are shown on hover). */
    badge: ReactNode;
    /** The "..." and bell buttons (hidden until hover / focus). */
    menus: ReactNode;
    unread: boolean;
}

/**
 * The inside of a chat row in Clariva's Chats list (Android `RoomSummaryRow`): avatar, then a two-line body -
 * name (+ the consultant's quiet "N credits" tag and the red Refund pill) and the last-activity time, message preview
 * and unread badge. Rendered by `RoomTile` instead of the stock title container when Clariva is configured; layout is CSS
 * grid in res/css/clariva/_chats.pcss.
 *
 * The avatar sits in `.mx_ClarivaRoomTile_avatar`: CSS draws the PRESENCE RING around it when the stock avatar reports the
 * peer online (`.mx_DecoratedRoomAvatar_icon_online`, which comes from the user's presence as the stock avatar already
 * tracks it: no extra listener and no polling here).
 */
export function ClarivaRoomTileContent({
    room,
    tag,
    isActive,
    title,
    subtitle,
    badge,
    menus,
    unread,
}: Props): JSX.Element {
    return (
        <>
            <span className="mx_ClarivaRoomTile_avatar">
                <DecoratedRoomAvatar
                    room={room}
                    size={ROOM_TILE_AVATAR_SIZE}
                    displayBadge={false}
                    tooltipProps={{ tabIndex: isActive ? 0 : -1 }}
                />
            </span>
            <div className="mx_ClarivaRoomTile_body">
                <div className="mx_ClarivaRoomTile_nameRow">
                    {title}
                    <ClarivaRoomTileRate room={room} />
                    <ClarivaRefundPill room={room} />
                </div>
                <div className="mx_ClarivaRoomTile_meta">
                    {tag !== DefaultTagID.Invite && <ClarivaRoomTileTime room={room} unread={unread} />}
                </div>
                <div className="mx_ClarivaRoomTile_previewRow">{subtitle}</div>
                <div className="mx_ClarivaRoomTile_indicators">
                    {badge}
                    {menus}
                </div>
            </div>
        </>
    );
}

export default ClarivaRoomTileContent;
