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
import { Icon as PlusIcon } from "@vector-im/compound-design-tokens/icons/plus.svg";

import { shouldShowComponent } from "../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../settings/UIFeature";
import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";
import { startChat } from "./ChatsEmptyState";

/**
 * Android's green round "+" (start a chat) at the bottom-right of the Chats list. Phones only: CSS hides it from 769px
 * up, where the list header and the People section keep their own "+" buttons.
 */
export function ClarivaChatsFab(): JSX.Element | null {
    if (!isClarivaEnabled() || !shouldShowComponent(UIComponent.CreateRooms)) return null;
    return (
        <button
            type="button"
            className="mx_ClarivaChatsFab"
            onClick={startChat}
            aria-label={S.startChat}
            title={S.startChat}
            data-testid="clariva-chats-fab"
        >
            <PlusIcon width="28px" height="28px" aria-hidden="true" />
        </button>
    );
}

export default ClarivaChatsFab;
