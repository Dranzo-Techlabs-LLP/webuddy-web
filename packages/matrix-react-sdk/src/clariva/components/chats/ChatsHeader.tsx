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

import React, { useRef } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { Icon as HomeIcon } from "@vector-im/compound-design-tokens/icons/home.svg";

import UserMenu from "../../../components/structures/UserMenu";
import { ChevronFace, ContextMenuButton, useContextMenu } from "../../../components/structures/ContextMenu";
import IconizedContextMenu, {
    IconizedContextMenuOptionList,
    IconizedContextMenuRadio,
} from "../../../components/views/context_menus/IconizedContextMenu";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import SpaceStore from "../../../stores/spaces/SpaceStore";
import {
    getMetaSpaceName,
    MetaSpace,
    type SpaceKey,
    UPDATE_SELECTED_SPACE,
    UPDATE_TOP_LEVEL_SPACES,
} from "../../../stores/spaces";
import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";
import { useIsPhone } from "../shell/useMediaQuery";
import { ClarivaCoinChip } from "./CoinChip";
import { useListCollapse } from "./useListCollapse";

const getTopLevelSpaces = (): Room[] => SpaceStore.instance.spacePanelSpaces;
const getActiveSpace = (): SpaceKey => SpaceStore.instance.activeSpace;

/**
 * Phone only (the space rail is hidden there): a menu to switch between Chats (home) and the account's spaces. Renders
 * nothing for an account without spaces, which is the normal Clariva case.
 */
function SpaceSwitcher(): JSX.Element | null {
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu<HTMLElement>();
    const spaces = useEventEmitterState(SpaceStore.instance, UPDATE_TOP_LEVEL_SPACES, getTopLevelSpaces);
    const activeSpace = useEventEmitterState(SpaceStore.instance, UPDATE_SELECTED_SPACE, getActiveSpace);
    if (spaces.length === 0 && activeSpace === MetaSpace.Home) return null;

    let menu: JSX.Element | undefined;
    if (menuDisplayed && handle.current) {
        const rect = handle.current.getBoundingClientRect();
        const choose = (key: SpaceKey): void => {
            SpaceStore.instance.setActiveSpace(key);
            closeMenu();
        };
        menu = (
            <IconizedContextMenu
                left={rect.left}
                top={rect.bottom + 8}
                chevronFace={ChevronFace.None}
                onFinished={closeMenu}
                compact
            >
                <IconizedContextMenuOptionList first>
                    <IconizedContextMenuRadio
                        label={S.title}
                        active={activeSpace === MetaSpace.Home}
                        onClick={() => choose(MetaSpace.Home)}
                    />
                    {spaces.map((space) => (
                        <IconizedContextMenuRadio
                            key={space.roomId}
                            label={space.name}
                            active={activeSpace === space.roomId}
                            onClick={() => choose(space.roomId)}
                        />
                    ))}
                </IconizedContextMenuOptionList>
            </IconizedContextMenu>
        );
    }

    const activeLabel =
        activeSpace === MetaSpace.Home
            ? S.title
            : (SpaceStore.instance.activeSpaceRoom?.name ?? getMetaSpaceName(activeSpace as MetaSpace));
    return (
        <>
            <ContextMenuButton
                ref={handle}
                className="mx_ClarivaChatsHeader_spaces"
                onClick={openMenu}
                isExpanded={menuDisplayed}
                label={`${S.spaces}: ${activeLabel}`}
                title={S.spaces}
            >
                <HomeIcon width="24px" height="24px" aria-hidden="true" />
            </ContextMenuButton>
            {menu}
        </>
    );
}

/**
 * Top bar of the Chats list: the account menu on the left (phones; on larger screens the space rail already has it), the
 * compact "Chats" title that fades in once the list has scrolled past the large Fraunces title (decorative: the real
 * heading is the large one), and the coin chip on the right. Replaces the stock chip placement at the top of the left
 * panel.
 */
export function ClarivaChatsHeader(): JSX.Element | null {
    const isPhone = useIsPhone();
    const enabled = isClarivaEnabled();
    const ref = useRef<HTMLDivElement>(null);
    useListCollapse(ref, enabled);
    if (!enabled) return null;

    return (
        <div ref={ref} className="mx_ClarivaChatsHeader" data-testid="clariva-chats-header">
            <div className="mx_ClarivaChatsHeader_start">
                {isPhone && (
                    <>
                        <UserMenu isPanelCollapsed={false} />
                        <SpaceSwitcher />
                    </>
                )}
                <span className="mx_ClarivaChatsHeader_title" aria-hidden="true">
                    {S.title}
                </span>
            </div>
            <ClarivaCoinChip />
        </div>
    );
}

export default ClarivaChatsHeader;
