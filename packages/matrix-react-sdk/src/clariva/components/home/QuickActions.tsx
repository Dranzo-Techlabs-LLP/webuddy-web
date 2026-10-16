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
import { Icon as NewChatIcon } from "@vector-im/compound-design-tokens/icons/chat-new.svg";
import { Icon as QrCodeIcon } from "@vector-im/compound-design-tokens/icons/qr-code.svg";
import { Icon as CameraIcon } from "@vector-im/compound-design-tokens/icons/take-photo.svg";

import { shouldShowComponent } from "../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../settings/UIFeature";
import { isQrEnabled } from "../../qr/links";
import { chatsStrings } from "../../strings/chats";
import { homeStrings as S } from "../../strings/home";
import { qrStrings } from "../../strings/qr";
import { openMyQrCodeDialog, openScanQrCodeDialog } from "../qr/dialogs";
import { startChat } from "../chats/ChatsEmptyState";

export interface QuickAction {
    id: string;
    label: string;
    icon: JSX.Element;
    onClick: () => void;
}

/**
 * The tiles of the dashboard, in the order people use them: Start a chat, My QR code, Scan QR code. Start a chat is always
 * offered (unless the deployment hides room creation); the two QR tiles follow the deployment's `features.qr` switch, the
 * same one that gates the QR rows of the settings and the Start chat dialog. Every tile runs the existing action.
 */
export function quickActions(qrEnabled: boolean, canStartChat: boolean): QuickAction[] {
    const actions: QuickAction[] = [];
    if (canStartChat) {
        actions.push({
            id: "start-chat",
            label: chatsStrings.startAChat,
            icon: <NewChatIcon aria-hidden="true" />,
            onClick: startChat,
        });
    }
    if (qrEnabled) {
        actions.push(
            {
                id: "my-qr",
                label: qrStrings.myQrCode,
                icon: <QrCodeIcon aria-hidden="true" />,
                onClick: openMyQrCodeDialog,
            },
            {
                id: "scan-qr",
                label: qrStrings.scanQrCode,
                icon: <CameraIcon aria-hidden="true" />,
                onClick: () => void openScanQrCodeDialog(),
            },
        );
    }
    return actions;
}

/** Three quiet glass tiles under the rail: icon above a short label, 44px or more to hit, one tap each. */
export function QuickActions(): JSX.Element | null {
    const actions = quickActions(isQrEnabled(), shouldShowComponent(UIComponent.CreateRooms));
    if (actions.length === 0) return null;
    return (
        <section className="mx_ClarivaQuick" aria-label={S.quickActions} data-testid="clariva-home-quick">
            <ul className="mx_ClarivaQuick_list">
                {actions.map((action) => (
                    <li key={action.id} className="mx_ClarivaQuick_cell">
                        <button
                            type="button"
                            className="mx_ClarivaQuick_tile"
                            onClick={action.onClick}
                            data-testid={`clariva-home-${action.id}`}
                        >
                            <span className="mx_ClarivaQuick_icon">{action.icon}</span>
                            <span className="mx_ClarivaQuick_label">{action.label}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default QuickActions;
