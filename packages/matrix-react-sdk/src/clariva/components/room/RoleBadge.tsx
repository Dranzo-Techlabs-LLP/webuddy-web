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

import { DEFAULT_CONSULTANT_DESIGNATION } from "../../profile/settings";
import { useDesignationBadge } from "../../presence/designation";

/**
 * A consultant's designation tag (Android `DesignationBadge`): "Consultant" by default, or the title they chose
 * ("Cardiologist"). Teal wash + a small verified glyph; one line, a long title ends in "..." (the full text is its
 * tooltip). The colours and the width cap per context live in `_chatroom.pcss` / `_chats.pcss`.
 */
export function ClarivaRoleBadge({ text = DEFAULT_CONSULTANT_DESIGNATION }: { text?: string }): JSX.Element {
    return (
        <span className="mx_ClarivaRoleBadge" data-testid="clariva-role-badge" title={text}>
            <svg
                className="mx_ClarivaRoleBadge_icon"
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
            >
                <path d="M8 1.8 13.2 3.6v4.1c0 3-2.1 5.4-5.2 6.5-3.1-1.1-5.2-3.5-5.2-6.5V3.6L8 1.8Z" />
                <path d="m5.7 8 1.7 1.7 3.1-3.4" />
            </svg>
            <span className="mx_ClarivaRoleBadge_text">{text}</span>
        </span>
    );
}

/**
 * The designation badge of any user (the profile in the right panel, Android `UserProfileView`): shown for a
 * consultant only, nothing for a client, while unknown or when Clariva is off.
 */
export function ClarivaUserDesignationBadge({ userId }: { userId: string }): JSX.Element | null {
    const badge = useDesignationBadge(userId);
    if (!badge) return null;
    return (
        <span className="mx_ClarivaUserInfo_designation" data-testid="clariva-user-designation">
            <ClarivaRoleBadge text={badge} />
        </span>
    );
}
