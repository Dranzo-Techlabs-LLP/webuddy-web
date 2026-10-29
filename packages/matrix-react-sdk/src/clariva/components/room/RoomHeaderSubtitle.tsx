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

import { useDmPeerStatus } from "../../presence/useDmPeerStatus";
import { ClarivaRoleBadge } from "./RoleBadge";

/**
 * What the room header shows next to and under the name of a 1:1 chat (Android `MessagesViewTopBar`): the partner's
 * designation badge when they are a consultant, and their WhatsApp-style presence ("online", "last seen today at
 * 10:30") when both people's "Last seen and online" choices allow it. CSS (`_chatroom.pcss`) puts the badge on the
 * name's line (the name gives way first) and the presence on its own line, so a long "last seen yesterday at ..." gets
 * the full width. Renders nothing at all when neither is known, so a plain chat keeps a one-line header. The header
 * is floating glass (DESIGN-SYSTEM.md rule 7): everything here carries `--cg-text`; "online" adds a teal dot.
 */
export function ClarivaRoomHeaderSubtitle({ room }: { room: Room }): JSX.Element | null {
    const status = useDmPeerStatus(room);
    if (!status.badge && !status.presence) return null;
    return (
        <div className="mx_ClarivaRoomHeader_sub" data-testid="clariva-header-sub">
            {status.badge && <ClarivaRoleBadge text={status.badge} />}
            {status.presence && (
                <span
                    className="mx_ClarivaRoomHeader_presence"
                    data-presence={status.online ? "online" : "last-seen"}
                    data-testid="clariva-header-presence"
                >
                    {status.presence}
                </span>
            )}
        </div>
    );
}
