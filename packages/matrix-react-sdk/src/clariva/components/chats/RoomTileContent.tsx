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
import { useClarivaDmPeerId } from "../../chat/useChatGate";
import { useCachedDesignationBadge } from "../../presence/designation";
import { ClarivaRoleBadge } from "../room/RoleBadge";
import { ClarivaRoomTileTime } from "./RoomTileTime";

/** The avatar of a chat row, in px (the presence ring and the row geometry in _chats.pcss are built around it). */
export const ROOM_TILE_AVATAR_SIZE = "52px";

/**
 * The DM partner's designation badge beside the name (Android `RoomSummaryRow` + `RoomListRoomSummaryFactory`): their
 * designation when they are a consultant ("Consultant" by default), nothing for a client. Read from the WalletStore
 * cache that the row's rate lookup fills; it appears (or changes) when that lookup or the open chat reloads the peer.
 */
export function ClarivaRoomTileDesignation({ room }: { room: Room }): JSX.Element | null {
    const badge = useCachedDesignationBadge(useClarivaDmPeerId(room, false));
    return badge ? <ClarivaRoleBadge text={badge} /> : null;
}

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
 * name (+ the consultant's designation badge, their quiet "N credits" tag and the red Refund pill; the name gives way
 * first) and the last-activity time, message preview
 * and unread badge. Rendered by `RoomTile` instead of the stock title container when Clariva is configured; layout is CSS
 * grid in res/css/clariva/_chats.pcss.
 *
 * The avatar sits in `.mx_ClarivaRoomTile_avatar`. Like Android's chat list it shows no presence: the stock avatar's
 * presence dot comes straight from /sync and would ignore the partner's "Last seen and online" choice, so CSS hides it
 * (presence is shown, with those rules, in the open chat only).
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
                    <ClarivaRoomTileDesignation room={room} />
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
