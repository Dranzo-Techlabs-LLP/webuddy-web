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
import { Icon as ArrowLeftIcon } from "@vector-im/compound-design-tokens/icons/arrow-left.svg";

import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";

/** Back to the Chats list (`#/home`). On a phone the list and the chat are separate screens. */
export function goToChatList(): void {
    dis.dispatch({ action: Action.ViewHomePage });
}

/**
 * The 44px Back arrow at the start of a chat header. Only visible on a phone (CSS: `_responsive.pcss`); desktop and
 * tablet keep the list next to the chat, so there it is `display: none` (and out of the tab order).
 */
export function ClarivaBackButton(): JSX.Element | null {
    if (!isClarivaEnabled()) return null;
    return (
        <button
            type="button"
            className="mx_ClarivaBackButton"
            onClick={goToChatList}
            aria-label={S.backToChats}
            title={S.backToChats}
            data-testid="clariva-back"
        >
            <ArrowLeftIcon className="mx_ClarivaBackButton_icon" aria-hidden="true" />
        </button>
    );
}

/**
 * Fallback bar for phone panes that have no room header of their own to carry the Back arrow (a user page, a room
 * that is still loading, the legacy header). CSS hides it whenever the pane contains `.mx_RoomHeader`.
 */
export function ClarivaDetailBar(): JSX.Element | null {
    if (!isClarivaEnabled()) return null;
    return (
        <div className="mx_ClarivaDetailBar">
            <ClarivaBackButton />
            <span className="mx_ClarivaDetailBar_label">{S.title}</span>
        </div>
    );
}
