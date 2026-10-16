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

import { roomStrings } from "../../strings/room";

/**
 * The small "New" label on the unread divider (the read marker of the timeline: a teal hairline, `_chatroom.pcss`). It is
 * decorative: the line is what marks the place, and a word that appears inside the timeline's live region would be read
 * out every time the marker moves, so it is hidden from assistive tech.
 */
export function ClarivaUnreadLabel(): JSX.Element {
    return (
        <span className="mx_ClarivaUnreadLabel" aria-hidden="true" data-testid="clariva-unread-label">
            {roomStrings.unreadDivider}
        </span>
    );
}
