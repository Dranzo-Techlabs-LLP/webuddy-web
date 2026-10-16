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

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import { authStrings } from "../../strings/auth";

interface Props {
    onFinished: () => void;
}

/**
 * "You’re signed out" (spec 01 §2.5): shown when the server invalidated the Matrix token (hard or soft logout; soft
 * logout is treated like a hard one because Element's soft-logout screen asks for a Matrix password nobody has).
 * The first Android reason ("changed your password on another session") cannot happen for Clariva and is dropped.
 * The app is already on the Clariva landing page behind this dialog.
 */
export const ClarivaSignedOutDialog: React.FC<Props> = ({ onFinished }) => (
    <BaseDialog
        className="mx_ClarivaDialog mx_ClarivaSignedOutDialog"
        title={authStrings.signedOutTitle}
        contentId="mx_ClarivaSignedOut_content"
        onFinished={onFinished}
        hasCancel
    >
        <div className="mx_Dialog_content mx_ClarivaDialog_content" id="mx_ClarivaSignedOut_content">
            <p>{authStrings.signedOutSubtitle}</p>
            <ul className="mx_ClarivaSignedOut_reasons">
                <li>{authStrings.signedOutReasonDeleted}</li>
                <li>{authStrings.signedOutReasonAdmin}</li>
            </ul>
        </div>
        <DialogButtons
            primaryButton={authStrings.signInAgain}
            onPrimaryButtonClick={onFinished}
            hasCancel={false}
            focus
        />
    </BaseDialog>
);
