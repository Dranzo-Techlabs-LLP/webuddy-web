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
import QrCodeIcon from "@vector-im/compound-design-tokens/assets/web/icons/qr-code";

import AccessibleButton from "../../../components/views/elements/AccessibleButton";
import { qrStrings } from "../../strings/qr";
import { isQrEnabled } from "../../qr/links";
import { openMyQrCodeDialog, openScanQrCodeDialog } from "./dialogs";

interface Props {
    /** Close the Start chat dialog before another one opens on top of the page. */
    onClose(): void;
}

/**
 * The Clariva entries of the Start chat dialog: "Scan QR code" (Android adds it to the Start chat list, spec 04
 * §2.8) and a shortcut to "My QR code". Renders nothing unless Clariva QR is enabled.
 */
export function StartChatQrActions({ onClose }: Props): JSX.Element | null {
    if (!isQrEnabled()) return null;
    return (
        <div className="mx_ClarivaStartChat_actions" data-testid="clariva-start-chat-actions">
            <AccessibleButton
                kind="secondary"
                className="mx_ClarivaStartChat_action"
                onClick={() => {
                    onClose();
                    void openScanQrCodeDialog();
                }}
                data-testid="clariva-scan-qr-entry"
            >
                <QrCodeIcon aria-hidden="true" className="mx_ClarivaStartChat_actionIcon" />
                {qrStrings.scanQrCode}
            </AccessibleButton>
            <AccessibleButton
                kind="secondary"
                className="mx_ClarivaStartChat_action"
                onClick={() => {
                    onClose();
                    openMyQrCodeDialog();
                }}
                data-testid="clariva-my-qr-entry"
            >
                <QrCodeIcon aria-hidden="true" className="mx_ClarivaStartChat_actionIcon" />
                {qrStrings.myQrCode}
            </AccessibleButton>
        </div>
    );
}
