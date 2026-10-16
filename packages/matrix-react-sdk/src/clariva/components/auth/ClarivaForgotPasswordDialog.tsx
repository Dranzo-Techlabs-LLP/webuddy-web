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

import React, { useEffect, useRef, useState } from "react";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../../components/views/elements/DialogButtons";
import { clarivaAuth } from "../../session/ClarivaAuthService";
import {
    canSendResetCode,
    canSubmitReset,
    MIN_PASSWORD_LENGTH,
    RESET_CODE_LENGTH,
    sanitizeResetCode,
} from "../../session/authForm";
import { authStrings } from "../../strings/auth";
import { AuthField, PasswordField } from "./fields";

interface Props {
    /** Prefilled from the sign-in field only when it holds an e-mail address. */
    initialEmail: string;
    /**
     * Whether "Sign in with Google" can be pointed at on the landing page right now (configured and not found broken).
     * Decides which Google hint the code step shows. Defaults to true.
     */
    googleAvailable?: boolean;
    /** Called with the e-mail to sign in with after a successful reset; nothing when cancelled. */
    onFinished: (signInEmail?: string) => void;
}

type Step = "email" | "code" | "done";

/**
 * "Reset password" (spec 01 §2.3, §3.6): e-mail -> 6-digit code + new password -> done. The server always answers
 * "ok" to the first request (it never reveals whether the address exists), so a successful request always advances.
 */
export const ClarivaForgotPasswordDialog: React.FC<Props> = ({ initialEmail, googleAvailable = true, onFinished }) => {
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Responses that arrive after the dialog was dismissed are dropped.
    const alive = useRef(true);
    useEffect(
        () => () => {
            alive.current = false;
        },
        [],
    );

    const requestCode = async (): Promise<void> => {
        if (!canSendResetCode(email, loading)) return;
        setLoading(true);
        setError(null);
        try {
            await clarivaAuth.requestPasswordReset(email);
            if (!alive.current) return;
            setCode(""); // older codes are invalidated server-side
            setStep("code");
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : authStrings.errorGeneric);
        } finally {
            if (alive.current) setLoading(false);
        }
    };

    const submitReset = async (): Promise<void> => {
        if (!canSubmitReset(code, newPassword, loading)) return;
        setLoading(true);
        setError(null);
        try {
            await clarivaAuth.resetPassword(email, code, newPassword);
            if (!alive.current) return;
            setNewPassword("");
            setStep("done");
        } catch (e) {
            if (alive.current) setError(e instanceof Error ? e.message : authStrings.errorGeneric);
        } finally {
            if (alive.current) setLoading(false);
        }
    };

    const cancel = (): void => onFinished();

    let body: React.ReactNode;
    let buttons: React.ReactNode;
    if (step === "email") {
        body = (
            <>
                <p>{authStrings.forgotEmailSubtitle}</p>
                <AuthField
                    id="mx_ClarivaForgot_email"
                    label={authStrings.emailLabel}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder={authStrings.emailPlaceholder}
                    autoComplete="email"
                    identifier
                    disabled={loading}
                    autoFocus
                    testId="clariva-forgot-email"
                />
            </>
        );
        buttons = (
            <DialogButtons
                primaryButton={loading ? authStrings.pleaseWait : authStrings.forgotSendCode}
                primaryIsSubmit
                primaryDisabled={!canSendResetCode(email, loading)}
                cancelButton={authStrings.forgotCancel}
                onCancel={cancel}
                disabled={false}
                hasCancel
            />
        );
    } else if (step === "code") {
        body = (
            <>
                <p>{authStrings.forgotCodeSubtitle(email.trim())}</p>
                {/* the server stays silent for unknown addresses AND Google accounts, so say what that can mean */}
                <p className="mx_ClarivaAuth_dialogHint" data-testid="clariva-forgot-google-hint">
                    {googleAvailable ? authStrings.forgotGoogleHint : authStrings.forgotGoogleHintUnavailable}
                </p>
                <AuthField
                    id="mx_ClarivaForgot_code"
                    label={authStrings.forgotCodeLabel}
                    value={code}
                    onChange={(v) => setCode(sanitizeResetCode(v))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={RESET_CODE_LENGTH}
                    disabled={loading}
                    autoFocus
                    testId="clariva-forgot-code"
                />
                <PasswordField
                    id="mx_ClarivaForgot_password"
                    label={authStrings.forgotNewPasswordLabel}
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder={authStrings.passwordHint(MIN_PASSWORD_LENGTH)}
                    autoComplete="new-password"
                    disabled={loading}
                    testId="clariva-forgot-password"
                />
                <button
                    type="button"
                    className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                    onClick={requestCode}
                    disabled={loading}
                    data-testid="clariva-forgot-resend"
                >
                    {authStrings.forgotResend}
                </button>
            </>
        );
        buttons = (
            <DialogButtons
                primaryButton={loading ? authStrings.pleaseWait : authStrings.forgotSubmit}
                primaryIsSubmit
                primaryDisabled={!canSubmitReset(code, newPassword, loading)}
                cancelButton={authStrings.forgotCancel}
                onCancel={cancel}
                disabled={false}
                hasCancel
            />
        );
    } else {
        body = <p data-testid="clariva-forgot-done">{authStrings.forgotSuccess}</p>;
        buttons = (
            <DialogButtons
                primaryButton={authStrings.signIn}
                onPrimaryButtonClick={() => onFinished(email.trim())}
                hasCancel={false}
                focus
            />
        );
    }

    return (
        <BaseDialog
            className="mx_ClarivaDialog mx_ClarivaForgotDialog"
            title={authStrings.forgotTitle}
            contentId="mx_ClarivaForgot_content"
            onFinished={cancel}
            hasCancel
        >
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    void (step === "email" ? requestCode() : step === "code" ? submitReset() : Promise.resolve());
                }}
                noValidate
            >
                <div className="mx_Dialog_content mx_ClarivaDialog_content" id="mx_ClarivaForgot_content">
                    {body}
                    {error && (
                        <div className="mx_ClarivaAuth_dialogError" role="alert" data-testid="clariva-forgot-error">
                            {error}
                        </div>
                    )}
                </div>
                {buttons}
            </form>
        </BaseDialog>
    );
};
