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

import React, { useCallback, useEffect, useRef, useState } from "react";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";

import dis from "../../../dispatcher/dispatcher";
import Modal from "../../../Modal";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import QuestionDialog from "../../../components/views/dialogs/QuestionDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import { clarivaAuth } from "../../session/ClarivaAuthService";
import { canDeactivate } from "../../session/authForm";
import { type GoogleUnavailableReason, isGoogleSignInConfigured } from "../../session/googleIdentity";
import { clearDeliberateSignOut, markDeliberateSignOut, setLandingNotice } from "../../session/signOutState";
import { WalletStore } from "../../stores/WalletStore";
import { formatCredits } from "../../money";
import { authStrings } from "../../strings/auth";
import { PasswordField, SwitchRow } from "./fields";
import { ClarivaGoogleButton } from "./ClarivaGoogleButton";
import { ClarivaGoogleNotice } from "./ClarivaGoogleNotice";

interface Props {
    onFinished: (success?: boolean) => void;
}

const LOOKUP_ATTEMPTS = 3;

/**
 * Deactivate account (spec 01 §2.8, §3.10), replacing Element's UIA-based dialog (it needs the Matrix password,
 * which nobody has). Re-authentication is a password (e-mail accounts) or a fresh Google ID token (Google accounts)
 * posted to `POST /v1/auth/deactivate`; on success the local session is dropped without waiting on the dead token.
 */
export const ClarivaDeactivateDialog: React.FC<Props> = ({ onFinished }) => {
    const [isGoogleAccount, setIsGoogleAccount] = useState<boolean | null>(null);
    const [lookupFailed, setLookupFailed] = useState(false);
    const [password, setPassword] = useState("");
    const [googleToken, setGoogleToken] = useState<string | null>(null);
    // Why Google's button could not be shown. Re-authentication needs it, so Deactivate stays disabled meanwhile.
    const [googleProblem, setGoogleProblem] = useState<GoogleUnavailableReason | null>(null);
    // Set by "Try again" so the button it mounts takes focus (the notice that held it is gone); cleared after each commit.
    const focusGoogleButton = useRef(false);
    const [eraseData, setEraseData] = useState(false);
    const [inProgress, setInProgress] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const alive = useRef(true);
    useEffect(
        () => () => {
            alive.current = false;
        },
        [],
    );
    // children's effects (the focus) have run by now: later mounts are not a "Try again"
    useEffect(() => {
        focusGoogleButton.current = false;
    });

    const userId = MatrixClientPeg.get()?.getSafeUserId();

    // How does this account prove it is itself? Android never retried a failed lookup (the screen stayed stuck).
    const lookup = useCallback(async (): Promise<void> => {
        if (!userId) return;
        setLookupFailed(false);
        for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt++) {
            if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            const result = await clarivaAuth.isGoogleAccount(userId);
            if (!alive.current) return;
            if (result !== null) {
                setIsGoogleAccount(result);
                return;
            }
        }
        setLookupFailed(true);
    }, [userId]);

    useEffect(() => {
        void lookup();
    }, [lookup]);

    const credits = WalletStore.instance.credits;
    const enabled = canDeactivate({
        isGoogleAccount,
        googleAuthorized: googleToken !== null,
        password,
        inProgress,
    });

    const run = async (): Promise<void> => {
        if (!userId || isGoogleAccount === null) return;
        setInProgress(true);
        setError(null);
        // The server kills our token as part of the deactivation: don't greet that with a "signed out" dialog.
        markDeliberateSignOut();
        try {
            await clarivaAuth.deactivateAccount({
                matrixUserId: userId,
                ...(isGoogleAccount ? { googleIdToken: googleToken ?? undefined } : { password }),
                eraseData,
            });
        } catch (e) {
            clearDeliberateSignOut();
            if (!alive.current) return;
            setInProgress(false);
            setError(e instanceof Error && e.message ? e.message : authStrings.deactivateErrorFallback);
            // a rejected/expired Google proof must be obtained again, a wrong password can simply be retyped
            if (isGoogleAccount && (e as { status?: number }).status === 401) setGoogleToken(null);
            return;
        }
        setLandingNotice(authStrings.deactivated);
        onFinished(true);
        // The token is already dead: Lifecycle.logout() ignores the failed /logout and wipes local data.
        dis.dispatch({ action: "logout" });
    };

    const confirmAndRun = async (): Promise<void> => {
        if (!enabled) return;
        const { finished } = Modal.createDialog(QuestionDialog, {
            title: authStrings.deactivateTitle,
            description: authStrings.deactivateConfirmation,
            button: authStrings.deactivate,
            danger: true,
        });
        const [ok] = await finished;
        if (ok && alive.current) await run();
    };

    const bold = <strong>{authStrings.deactivateIrreversible}</strong>;
    const permanently = <strong>{authStrings.deactivateItem1Bold}</strong>;

    const googleConfigured = isGoogleSignInConfigured();

    let reauth: React.ReactNode;
    if (isGoogleAccount) {
        let googleSlot: React.ReactNode;
        if (googleToken) {
            googleSlot = (
                <p className="mx_ClarivaAuth_dialogSuccess" data-testid="clariva-deactivate-authorised">
                    {authStrings.deactivateGoogleAuthorized}
                </p>
            );
        } else if (!googleConfigured || googleProblem !== null) {
            // never an empty slot above a disabled button: say why, and (when it may help) offer a retry
            googleSlot = (
                <ClarivaGoogleNotice
                    reason={googleProblem ?? undefined}
                    context="deactivate"
                    onRetry={
                        googleConfigured
                            ? () => {
                                  focusGoogleButton.current = true;
                                  setGoogleProblem(null);
                              }
                            : undefined
                    }
                    testId="clariva-deactivate-google-unavailable"
                />
            );
        } else {
            googleSlot = (
                <ClarivaGoogleButton
                    text="continue_with"
                    onCredential={(token) => setGoogleToken(token)} // the rendered text does not matter here
                    disabled={inProgress}
                    onUnavailable={setGoogleProblem}
                    autoFocus={focusGoogleButton.current}
                    testId="clariva-deactivate-google"
                />
            );
        }
        reauth = (
            <div className="mx_ClarivaDeactivate_google">
                <p>{authStrings.deactivateGoogleNotice}</p>
                {googleSlot}
            </div>
        );
    } else {
        // e-mail accounts, and also while the account type is still unknown (Android shows the field meanwhile)
        reauth = (
            <>
                <PasswordField
                    id="mx_ClarivaDeactivate_password"
                    label={authStrings.confirmPasswordLabel}
                    value={password}
                    onChange={setPassword}
                    placeholder={authStrings.passwordPlaceholder}
                    autoComplete="current-password"
                    disabled={inProgress}
                    testId="clariva-deactivate-password"
                />
                {lookupFailed && (
                    <div className="mx_ClarivaAuth_dialogError" data-testid="clariva-deactivate-lookup-failed">
                        {authStrings.deactivateCheckFailed}{" "}
                        <button
                            type="button"
                            className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                            onClick={() => void lookup()}
                        >
                            {authStrings.deactivateCheckRetry}
                        </button>
                    </div>
                )}
            </>
        );
    }

    return (
        <BaseDialog
            className="mx_ClarivaDialog mx_ClarivaDeactivateDialog"
            title={authStrings.deactivateTitle}
            contentId="mx_ClarivaDeactivate_content"
            onFinished={() => onFinished(false)}
            hasCancel={!inProgress}
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void confirmAndRun();
                }}
                noValidate
            >
                <div className="mx_Dialog_content mx_ClarivaDialog_content" id="mx_ClarivaDeactivate_content">
                    <p>
                        {authStrings.deactivateDescriptionBefore}
                        {bold}
                        {authStrings.deactivateDescriptionAfter}
                    </p>
                    <ul className="mx_ClarivaDeactivate_list mx_ClarivaDeactivate_bad">
                        <li>
                            <CloseIcon aria-hidden />
                            <span>
                                {permanently}
                                {authStrings.deactivateItem1Rest}
                            </span>
                        </li>
                        <li>
                            <CloseIcon aria-hidden />
                            <span>{authStrings.deactivateItem2}</span>
                        </li>
                        <li>
                            <CloseIcon aria-hidden />
                            <span>{authStrings.deactivateItem3}</span>
                        </li>
                    </ul>
                    <ul className="mx_ClarivaDeactivate_list mx_ClarivaDeactivate_good">
                        <li>
                            <CheckIcon aria-hidden />
                            <span>{authStrings.deactivateItem4}</span>
                        </li>
                    </ul>
                    <SwitchRow
                        id="mx_ClarivaDeactivate_erase"
                        title={authStrings.deactivateDeleteMessages}
                        subtitle={authStrings.deactivateDeleteMessagesNotice}
                        checked={eraseData}
                        onChange={setEraseData}
                        disabled={inProgress}
                        testId="clariva-deactivate-erase"
                    />
                    {credits !== null && credits > 0 && (
                        <div className="mx_ClarivaDeactivate_warning" data-testid="clariva-deactivate-credits">
                            {authStrings.deactivateCreditsWarning(formatCredits(credits))}
                        </div>
                    )}
                    {reauth}
                    {inProgress && <p aria-live="polite">{authStrings.pleaseWait}</p>}
                    {error && (
                        <div className="mx_ClarivaAuth_dialogError" role="alert" data-testid="clariva-deactivate-error">
                            {error}
                        </div>
                    )}
                </div>
                <DialogButtons
                    primaryButton={authStrings.deactivate}
                    primaryButtonClass="danger"
                    primaryIsSubmit
                    primaryDisabled={!enabled}
                    cancelButton={authStrings.cancel}
                    onCancel={() => onFinished(false)}
                    disabled={inProgress}
                />
            </form>
        </BaseDialog>
    );
};
