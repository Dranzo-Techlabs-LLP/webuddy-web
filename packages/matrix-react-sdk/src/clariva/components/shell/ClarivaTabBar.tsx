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

import React, { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { Icon as ChatIcon } from "@vector-im/compound-design-tokens/icons/chat.svg";
import { Icon as ChatSolidIcon } from "@vector-im/compound-design-tokens/icons/chat-solid.svg";
import { Icon as ProfileIcon } from "@vector-im/compound-design-tokens/icons/user-profile.svg";
import { Icon as ProfileSolidIcon } from "@vector-im/compound-design-tokens/icons/user-profile-solid.svg";

import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import Modal, { ModalManagerEvent } from "../../../Modal";
import NotificationBadge from "../../../components/views/rooms/NotificationBadge";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import {
    RoomNotificationStateStore,
    UPDATE_STATUS_INDICATOR,
} from "../../../stores/notifications/RoomNotificationStateStore";
import { isClarivaEnabled } from "../../config";
import { chatsStrings as S } from "../../strings/chats";
import { WalletIcon } from "../wallet/icons";
import { openWalletSettings } from "../wallet/openSettings";

export type TabId = "chats" | "wallet" | "me";

/** Left to right (the indicator and the arrow keys follow this order). */
export const TAB_ORDER: readonly TabId[] = ["chats", "wallet", "me"];

/** After this long without a dialog appearing, a tab that did not open anything hands the indicator back to Chats. */
const REVERT_AFTER_MS = 600;

/** The keyboard-open heuristic: the visual viewport is this much shorter than the layout viewport (px). */
const KEYBOARD_HEIGHT_THRESHOLD = 120;

/** The tab a roving-focus key moves to (`null` when the key is not one of ours). Pure, so it is unit-testable. */
export function tabAfterKey(current: TabId, key: string, rtl = false): TabId | null {
    const index = TAB_ORDER.indexOf(current);
    const last = TAB_ORDER.length - 1;
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    if (key === forward) return TAB_ORDER[index === last ? 0 : index + 1];
    if (key === backward) return TAB_ORDER[index === 0 ? last : index - 1];
    if (key === "Home") return TAB_ORDER[0];
    if (key === "End") return TAB_ORDER[last];
    return null;
}

/** "Chats, 3 unread" (and just "Chats" when nothing is unread). */
export function chatsTabLabel(unread: number): string {
    return unread > 0 ? `${S.tabChats}, ${S.tabUnread(unread)}` : S.tabChats;
}

function isTextField(element: Element | null): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable) return true;
    if (element instanceof HTMLTextAreaElement) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return !["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"].includes(
        element.type,
    );
}

/**
 * True while the on-screen keyboard is (probably) up: the visual viewport is much shorter than the layout viewport (not
 * while the user pinch-zooms, which also shrinks it), or a text field has focus (the keyboard is about to open).
 */
export function useKeyboardOpen(): boolean {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const viewport = window.visualViewport;
        const sync = (): void => {
            const shrunk =
                !!viewport &&
                viewport.scale <= 1.01 &&
                window.innerHeight - viewport.height > KEYBOARD_HEIGHT_THRESHOLD;
            setOpen(shrunk || isTextField(document.activeElement));
        };
        sync();
        viewport?.addEventListener("resize", sync);
        document.addEventListener("focusin", sync);
        document.addEventListener("focusout", sync);
        return () => {
            viewport?.removeEventListener("resize", sync);
            document.removeEventListener("focusin", sync);
            document.removeEventListener("focusout", sync);
        };
    }, []);
    return open;
}

const getUnreadCount = (): number => RoomNotificationStateStore.instance.globalState.count;

function openUserSettings(): void {
    dis.dispatch({ action: Action.ViewUserSettings });
}

/**
 * The floating glass tab bar of the phone's Chats screen: Chats / Wallet / Me. Chats is where you are; Wallet and Me open
 * the existing Wallet tab and user settings, and the active indicator follows the press (a spring, transform only), then
 * slides back to Chats once the dialog closes. Thick glass (it floats over the scrolling list, DESIGN-SYSTEM section 3,
 * rule 7) carrying `--cg-text` only. CSS shows it on phones, on the list screen, and nowhere else (it lives inside the list
 * column, which a phone hides while a chat is open); it also steps aside while the on-screen keyboard is up.
 *
 * Semantics: `role="tablist"` with three `role="tab"` buttons, `aria-selected` on the current one and a roving tabindex.
 * Arrow keys / Home / End move focus; Enter and Space activate (the tabs open dialogs, so focus moving never fires them).
 */
export function ClarivaTabBar(): JSX.Element | null {
    const enabled = isClarivaEnabled();
    const [current, setCurrent] = useState<TabId>("chats");
    const [focusable, setFocusable] = useState<TabId>("chats");
    const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
    const revertTimer = useRef<number>();
    const unread = useEventEmitterState(RoomNotificationStateStore.instance, UPDATE_STATUS_INDICATOR, getUnreadCount);
    const keyboardOpen = useKeyboardOpen();

    // The indicator goes back to Chats when the dialog the tab opened is closed again.
    useEffect(() => {
        if (!enabled) return;
        const onClosed = (): void => {
            if (!Modal.hasDialogs()) setCurrent("chats");
        };
        Modal.on(ModalManagerEvent.Closed, onClosed);
        return () => {
            Modal.off(ModalManagerEvent.Closed, onClosed);
            window.clearTimeout(revertTimer.current);
        };
    }, [enabled]);

    const activate = useCallback((id: TabId): void => {
        window.clearTimeout(revertTimer.current);
        setCurrent(id);
        setFocusable(id);
        if (id === "chats") return;
        if (id === "wallet") openWalletSettings();
        else openUserSettings();
        revertTimer.current = window.setTimeout(() => {
            if (!Modal.hasDialogs()) setCurrent("chats");
        }, REVERT_AFTER_MS);
    }, []);

    const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>): void => {
        const rtl = getComputedStyle(ev.currentTarget).direction === "rtl";
        const next = tabAfterKey(focusable, ev.key, rtl);
        if (!next) return;
        ev.preventDefault();
        setFocusable(next);
        refs.current[next]?.focus();
    };

    if (!enabled) return null;

    const tabs: ReadonlyArray<{ id: TabId; name: string; label: string; icon: JSX.Element }> = [
        {
            id: "chats",
            name: chatsTabLabel(unread),
            label: S.tabChats,
            icon:
                current === "chats" ? (
                    <ChatSolidIcon className="mx_ClarivaTabBar_icon" aria-hidden="true" />
                ) : (
                    <ChatIcon className="mx_ClarivaTabBar_icon" aria-hidden="true" />
                ),
        },
        {
            id: "wallet",
            name: S.tabWallet,
            label: S.tabWallet,
            icon: <WalletIcon className="mx_ClarivaTabBar_icon" aria-hidden="true" />,
        },
        {
            id: "me",
            name: S.tabMe,
            label: S.tabMe,
            icon:
                current === "me" ? (
                    <ProfileSolidIcon className="mx_ClarivaTabBar_icon" aria-hidden="true" />
                ) : (
                    <ProfileIcon className="mx_ClarivaTabBar_icon" aria-hidden="true" />
                ),
        },
    ];

    return (
        <div
            className={classNames("mx_ClarivaTabBar", { mx_ClarivaTabBar_hidden: keyboardOpen })}
            role="tablist"
            aria-label={S.tabBarLabel}
            onKeyDown={onKeyDown}
            data-testid="clariva-tab-bar"
            data-active={current}
        >
            <span
                className="mx_ClarivaTabBar_indicator"
                aria-hidden="true"
                style={{ transform: `translate3d(${TAB_ORDER.indexOf(current) * 100}%, 0, 0)` }}
            />
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    ref={(el) => (refs.current[tab.id] = el)}
                    type="button"
                    role="tab"
                    id={`clariva-tab-${tab.id}`}
                    className="mx_ClarivaTabBar_tab"
                    aria-selected={current === tab.id}
                    aria-label={tab.name}
                    tabIndex={focusable === tab.id ? 0 : -1}
                    onClick={() => activate(tab.id)}
                    onFocus={() => setFocusable(tab.id)}
                    data-testid={`clariva-tab-${tab.id}`}
                >
                    <span className="mx_ClarivaTabBar_glyph">
                        {tab.icon}
                        {tab.id === "chats" && (
                            <span className="mx_ClarivaTabBar_badge" aria-hidden="true">
                                <NotificationBadge
                                    notification={RoomNotificationStateStore.instance.globalState}
                                    hideIfDot
                                />
                            </span>
                        )}
                    </span>
                    <span className="mx_ClarivaTabBar_label" aria-hidden="true">
                        {tab.label}
                    </span>
                </button>
            ))}
        </div>
    );
}

export default ClarivaTabBar;
