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

import React, { useEffect, useState } from "react";

import dis from "../../../dispatcher/dispatcher";
import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import { ClarivaBackupProgress } from "../../session/backupProgress";
import { authStrings } from "../../strings/auth";

interface Props {
    onFinished: (success: boolean) => void;
}

/**
 * Sign-out confirmation with Android's copy (spec 01 §2.7). Element's "set up key backup" / "you'll lose your
 * encrypted messages" variants are replaced: key storage is managed by the server-derived passphrase, so the only
 * warning that stays is "your keys are still being backed up" (offering "Sign out anyway").
 */
export const ClarivaLogoutDialog: React.FC<Props> = ({ onFinished }) => {
    const progress = ClarivaBackupProgress.instance;
    const [uploading, setUploading] = useState(progress.isUploading);

    useEffect(() => {
        const update = (): void => setUploading(progress.isUploading);
        progress.on(ClarivaBackupProgress.UPDATE, update);
        update();
        return () => {
            progress.off(ClarivaBackupProgress.UPDATE, update);
        };
    }, [progress]);

    const confirm = (): void => {
        dis.dispatch({ action: "logout" });
        onFinished(true);
    };

    return (
        <BaseDialog
            className="mx_ClarivaDialog mx_ClarivaLogoutDialog"
            title={uploading ? authStrings.signOutKeysUploadingTitle : authStrings.signOutTitle}
            contentId="mx_ClarivaLogout_content"
            onFinished={() => onFinished(false)}
            hasCancel
        >
            <div className="mx_Dialog_content mx_ClarivaDialog_content" id="mx_ClarivaLogout_content">
                <p data-testid="clariva-signout-text">
                    {uploading ? authStrings.signOutKeysUploadingSubtitle : authStrings.signOutSubtitle}
                </p>
            </div>
            <DialogButtons
                primaryButton={uploading ? authStrings.signOutAnyway : authStrings.signOut}
                primaryButtonClass="danger"
                onPrimaryButtonClick={confirm}
                cancelButton={authStrings.cancel}
                onCancel={() => onFinished(false)}
                focus
            />
        </BaseDialog>
    );
};

export default ClarivaLogoutDialog;
