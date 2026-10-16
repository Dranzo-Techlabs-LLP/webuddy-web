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

import { ClarivaRoleBadge } from "./RoleBadge";
import { useClarivaPeerInfo } from "./useClarivaPeerInfo";
import { presenceLabel, usePeerPresence } from "./presence";

/**
 * The second line of the room header (a 1:1 chat only): the "Consultant" role badge, then the peer's presence when the
 * homeserver shares it. Renders nothing at all when neither is known, so a plain chat keeps a one-line header. The
 * header is floating glass (DESIGN-SYSTEM.md rule 7): everything here carries `--cg-text` only.
 */
export function ClarivaRoomHeaderSubtitle({ room }: { room: Room }): JSX.Element | null {
    const peer = useClarivaPeerInfo(room);
    const presence = usePeerPresence(room);
    const isConsultant = peer.isConsultant === true;
    if (!isConsultant && !presence) return null;
    return (
        <div className="mx_ClarivaRoomHeader_sub" data-testid="clariva-header-sub">
            {isConsultant && <ClarivaRoleBadge />}
            {presence && (
                <span className="mx_ClarivaRoomHeader_presence" data-presence={presence.state}>
                    {presenceLabel(presence, Date.now())}
                </span>
            )}
        </div>
    );
}
