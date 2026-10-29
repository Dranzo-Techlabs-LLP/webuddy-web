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

import React, { useRef, useState } from "react";

import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import {
    type ConsultantSetupForm,
    EMPTY_CONSULTANT_SETUP,
    isSetupReady,
    resumeSetup,
    withSetupField,
} from "../../session/consultantSetup";
import { authStrings } from "../../strings/auth";
import { applyIfscAutofill, type IfscAutofill } from "../../wallet/bankDetails";
import { ifscBlocksSave, useIfscLookup } from "../../wallet/ifsc";
import { ConsultantSetupFields } from "./ConsultantSetupFields";

interface Props {
    /** The verified Google address, when the server told us (shown in the subtitle). */
    email?: string;
    /** Google's name for the account: the account holder placeholder on the payout step. */
    name?: string;
    /** The flow started from the SIGN-IN screen (not "Create account"). */
    fromSignIn?: boolean;
    /** The server's answer: `false` means no Clariva account exists for this Google account yet. */
    isExisting?: boolean;
    /** Payout values already typed on the e-mail sign-up form (carried over, as on Android). */
    initialSetup?: ConsultantSetupForm;
    /**
     * `(confirmed, isConsultant, payoutSetup)`; `(false)` when cancelled. `payoutSetup` is what the consultant typed
     * on the payout step, or `null` when they chose "Skip for now" (never present for a client).
     */
    onFinished: (confirmed: boolean, isConsultant?: boolean, payoutSetup?: ConsultantSetupForm | null) => void;
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
 *
 * "Yes" + Continue leads to a second step (Android `ClarivaGooglePayoutDialog`): the same optional chat rate and bank
 * account the e-mail sign-up form asks for. The account is created only from there ("Continue" or "Skip for now"), so
 * "Back" (or Escape) to the role question still creates nothing, and keeps "Yes" selected.
 */
export const ClarivaGoogleRoleDialog: React.FC<Props> = ({
    email,
    name,
    fromSignIn,
    isExisting,
    initialSetup,
    onFinished,
}) => {
    const [isConsultant, setIsConsultant] = useState(false);
    const [step, setStep] = useState<"role" | "payout">("role");
    const [setup, setSetup] = useState<ConsultantSetupForm>(initialSetup ?? EMPTY_CONSULTANT_SETUP);
    // What the last IFSC lookup filled in, so a new IFSC can replace it but never a value the user typed.
    const ifscAutofill = useRef<IfscAutofill | null>(null);
    // "Sign in with Google" with an address that has no account would otherwise silently become sign-up
    const creatingFromSignIn = !!fromSignIn && isExisting === false;
    const askingPayouts = step === "payout";

    const ifscStatus = useIfscLookup(askingPayouts ? setup.ifscCode : "", (branch) => {
        const found = { bank: branch.bank, branch: branch.branch };
        const previous = ifscAutofill.current;
        setSetup((s) => applyIfscAutofill(s, found, previous));
        ifscAutofill.current = found;
    });
    // "Continue" is disabled on an invalid setup: what IS typed is never dropped silently.
    const canContinue = isSetupReady(setup, ifscBlocksSave(ifscStatus));

    const confirmRole = (): void => {
        if (!isConsultant) {
            onFinished(true, false);
            return;
        }
        // A "Skip for now" left over from the e-mail form must not hide the fields here.
        setSetup((s) => resumeSetup(s));
        setStep("payout");
    };

    if (askingPayouts) {
        return (
            <BaseDialog
                className="mx_ClarivaDialog mx_ClarivaRoleDialog mx_ClarivaPayoutDialog"
                title={authStrings.setupTitle}
                contentId="mx_ClarivaPayout_content"
                onFinished={() => {}}
                hasCancel={false}
                // Escape is Back (Android: the system back returns to the role question); BaseDialog ignores it
                // without a close button
                onKeyDown={(ev) => {
                    if (getKeyBindingsManager().getAccessibilityAction(ev) !== KeyBindingAction.Escape) return;
                    ev.stopPropagation();
                    ev.preventDefault();
                    setStep("role");
                }}
            >
                <form
                    className="mx_Dialog_content mx_ClarivaDialog_content"
                    id="mx_ClarivaPayout_content"
                    noValidate
                    onSubmit={(ev) => {
                        ev.preventDefault();
                        if (canContinue) onFinished(true, true, setup);
                    }}
                >
                    <div className="mx_ClarivaSetup_header">
                        <span className="mx_ClarivaSetup_optional">{authStrings.setupOptional}</span>
                        <p className="mx_ClarivaSetup_subtitle">
                            {email ? authStrings.googlePayoutSubtitleWithEmail(email) : authStrings.setupSubtitle}
                        </p>
                    </div>
                    <ConsultantSetupFields
                        idPrefix="mx_ClarivaPayout"
                        setup={setup}
                        onChange={(field, value) => setSetup((s) => withSetupField(s, field, value))}
                        ifscStatus={ifscStatus}
                        holderNameHint={name}
                        showHeader={false}
                    />
                    {/* lets Enter in a field submit; the visible buttons are below */}
                    <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
                </form>
                <DialogButtons
                    primaryButton={authStrings.googleRoleConfirm}
                    onPrimaryButtonClick={() => onFinished(true, true, setup)}
                    primaryDisabled={!canContinue}
                    // Skip lives next to Continue; it still creates the account, without the payout details
                    cancelButton={authStrings.setupSkip}
                    onCancel={() => onFinished(true, true, null)}
                    additive={
                        <button
                            type="button"
                            className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                            onClick={() => setStep("role")}
                            data-testid="clariva-google-payout-back"
                        >
                            {authStrings.googlePayoutBack}
                        </button>
                    }
                    focus={false}
                />
            </BaseDialog>
        );
    }

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
                onPrimaryButtonClick={confirmRole}
                cancelButton={authStrings.cancel}
                onCancel={() => onFinished(false)}
                focus={!creatingFromSignIn}
            />
        </BaseDialog>
    );
};
