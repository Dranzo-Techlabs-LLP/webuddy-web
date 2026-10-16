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
import SettingsSubsection from "../../../components/views/settings/shared/SettingsSubsection";
import { qrStrings } from "../../strings/qr";
import { isQrEnabled } from "../../qr/links";
import { openMyQrCodeDialog } from "./dialogs";

/**
 * Settings -> Account: the "My QR code" row (Android: first row of the Account section, spec 04 §2.10). Renders
 * nothing unless Clariva QR is enabled, so stock Element Web is unchanged without configuration.
 */
export function MyQrSettingsRow(): JSX.Element | null {
    if (!isQrEnabled()) return null;
    return (
        <SettingsSubsection data-testid="clariva-my-qr-row">
            <AccessibleButton
                kind="primary_outline"
                className="mx_ClarivaSettings_myQr"
                onClick={openMyQrCodeDialog}
                data-testid="clariva-my-qr-open"
            >
                <QrCodeIcon aria-hidden="true" className="mx_ClarivaStartChat_actionIcon" />
                {qrStrings.myQrCode}
            </AccessibleButton>
        </SettingsSubsection>
    );
}
