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

import React, { useState } from "react";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import { authStrings } from "../../strings/auth";

interface Props {
    /** The verified Google address, when the server told us (shown in the subtitle). */
    email?: string;
    /** The flow started from the SIGN-IN screen (not "Create account"). */
    fromSignIn?: boolean;
    /** The server's answer: `false` means no Clariva account exists for this Google account yet. */
    isExisting?: boolean;
    /** `(confirmed, isConsultant)`; `(false)` when cancelled. */
    onFinished: (confirmed: boolean, isConsultant?: boolean) => void;
}

/**
 * "Are you a consultant?" (spec 01 §2.4): raised only when the server answered `needsRole`. "No" is preselected.
 * It is NOT dismissible by an outside click or Escape (the Google sheet already ran): open it with
 * `onBeforeClose: async (reason) => reason !== "backgroundClick"` and it has no close button; only Cancel abandons.
 *
 * Started from the sign-in screen with an address that has no account (`isExisting === false`), it first says that
 * continuing creates one, so "Sign in with Google" never quietly registers somebody. In that case nothing is focused
 * on "Continue" (a stray Enter must not create an account: focus lands on the preselected "No"), and the address is
 * named once, in the notice, not again in the subtitle.
 */
export const ClarivaGoogleRoleDialog: React.FC<Props> = ({ email, fromSignIn, isExisting, onFinished }) => {
    const [isConsultant, setIsConsultant] = useState(false);
    // "Sign in with Google" with an address that has no account would otherwise silently become sign-up
    const creatingFromSignIn = !!fromSignIn && isExisting === false;

    return (
        <BaseDialog
            className="mx_ClarivaDialog mx_ClarivaRoleDialog"
            title={authStrings.googleRoleTitle}
            contentId="mx_ClarivaRole_content"
            onFinished={() => {}}
            hasCancel={false}
        >
            <div className="mx_Dialog_content mx_ClarivaDialog_content" id="mx_ClarivaRole_content">
                {creatingFromSignIn && (
                    <p className="mx_ClarivaAuth_dialogNotice" data-testid="clariva-role-no-account">
                        {authStrings.googleNoAccountNotice(email)}
                    </p>
                )}
                <p>
                    {email && !creatingFromSignIn
                        ? authStrings.googleRoleSubtitleWithEmail(email)
                        : authStrings.googleRoleSubtitle}
                </p>
                <div role="radiogroup" aria-label={authStrings.googleRoleTitle} className="mx_ClarivaAuth_radioGroup">
                    <label className="mx_ClarivaAuth_radio">
                        <input
                            type="radio"
                            name="clariva-role"
                            checked={!isConsultant}
                            onChange={() => setIsConsultant(false)}
                            data-testid="clariva-role-no"
                        />
                        <span>
                            <span className="mx_ClarivaAuth_radioTitle">{authStrings.googleRoleNo}</span>
                            <span className="mx_ClarivaAuth_radioHint">{authStrings.googleRoleNoHint}</span>
                        </span>
                    </label>
                    <label className="mx_ClarivaAuth_radio">
                        <input
                            type="radio"
                            name="clariva-role"
                            checked={isConsultant}
                            onChange={() => setIsConsultant(true)}
                            data-testid="clariva-role-yes"
                        />
                        <span>
                            <span className="mx_ClarivaAuth_radioTitle">{authStrings.googleRoleYes}</span>
                            <span className="mx_ClarivaAuth_radioHint">{authStrings.googleRoleYesHint}</span>
                        </span>
                    </label>
                </div>
            </div>
            <DialogButtons
                primaryButton={authStrings.googleRoleConfirm}
                onPrimaryButtonClick={() => onFinished(true, isConsultant)}
                cancelButton={authStrings.cancel}
                onCancel={() => onFinished(false)}
                focus={!creatingFromSignIn}
            />
        </BaseDialog>
    );
};
