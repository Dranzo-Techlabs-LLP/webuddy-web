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

import React, { useState } from "react";
import classNames from "classnames";
import { type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { useTypedEventEmitter } from "../../../hooks/useEventEmitter";
import { getCurrentLanguage } from "../../../languageHandler";
import { RecentAlgorithm } from "../../../stores/room-list/algorithms/tag-sorting/RecentAlgorithm";
import { formatChatTimestamp } from "./chatTime";

// Created on first use, not at import time: this module sits in an import cycle with the room list (RoomTile -> here
// -> RecentAlgorithm -> Unread -> ... -> RoomTile), so the class is not defined yet while the cycle is still loading.
let recentAlgorithm: RecentAlgorithm | undefined;

/** The last-activity timestamp the room list sorts by (0 when unknown); shared with the Home dashboard rail. */
export function getLastActivityTs(room: Room): number {
    try {
        recentAlgorithm ??= new RecentAlgorithm();
        return recentAlgorithm.getLastTs(room, room.myUserId);
    } catch {
        return 0;
    }
}

interface Props {
    room: Room;
    /** The chat has something new: the time takes the accent colour (Android `unreadIndicator`). */
    unread?: boolean;
}

/** The last-activity time at the top-right of a chat row (the same timestamp the "recent" sorter orders the list by). */
export function ClarivaRoomTileTime({ room, unread }: Props): JSX.Element | null {
    const [ts, setTs] = useState(() => getLastActivityTs(room));
    useTypedEventEmitter(room, RoomEvent.Timeline, () => setTs(getLastActivityTs(room)));

    const text = formatChatTimestamp(ts, new Date(), getCurrentLanguage());
    if (!text) return null;
    return (
        <time
            className={classNames("mx_ClarivaRoomTile_time", { mx_ClarivaRoomTile_time_unread: unread })}
            dateTime={new Date(ts).toISOString()}
            title={new Date(ts).toLocaleString()}
        >
            {text}
        </time>
    );
}

export default ClarivaRoomTileTime;
