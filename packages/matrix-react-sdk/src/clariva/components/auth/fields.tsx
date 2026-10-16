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
import classNames from "classnames";
import VisibilityOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/visibility-on";
import VisibilityOffIcon from "@vector-im/compound-design-tokens/assets/web/icons/visibility-off";
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";
import CheckCircleIcon from "@vector-im/compound-design-tokens/assets/web/icons/check-circle-solid";

import { type SupportKind, type SupportText } from "../../session/authForm";
import { authStrings } from "../../strings/auth";

/**
 * Small form controls shared by the landing page and the Clariva dialogs. Plain HTML + Compound tokens (see
 * res/css/clariva/_auth.pcss): real `<label>`s, `aria-describedby` for the support line, `aria-invalid` for hard
 * errors, `aria-live` for the availability text (spec 01 §2.1 [N] accessibility notes).
 */

export interface AuthFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: "text" | "email" | "tel" | "password";
    autoComplete?: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    maxLength?: number;
    disabled?: boolean;
    autoFocus?: boolean;
    /** Text under the field (error / availability / help). */
    support?: SupportText | null;
    /** Turns the input into a no-autocorrect identifier field (usernames, e-mail). */
    identifier?: boolean;
    testId?: string;
    /** Extra element at the end of the input row (the password eye). */
    trailing?: React.ReactNode;
    /** Static text at the start of the input row (e.g. a currency sign); decorative, hidden from screen readers. */
    prefix?: string;
    /** Always-visible helper text under the field; replaced by `support` while there is one. */
    help?: string;
    /** Fired when the field loses focus (inline validation on blur). */
    onBlur?: () => void;
    /** Announce an error support line with role="alert" (otherwise it is an assertive live region). */
    alert?: boolean;
}

/** The small glyph in front of a support line: state is never conveyed by colour alone. */
const SupportIcon: React.FC<{ kind: SupportKind }> = ({ kind }) => {
    switch (kind) {
        case "error":
            return <ErrorIcon className="mx_ClarivaAuth_supportIcon" aria-hidden />;
        case "available":
            return <CheckCircleIcon className="mx_ClarivaAuth_supportIcon" aria-hidden />;
        case "checking":
            return <span className="mx_ClarivaAuth_supportIcon mx_ClarivaAuth_supportSpinner" aria-hidden />;
        default:
            return null;
    }
};

export const AuthField: React.FC<AuthFieldProps> = ({
    id,
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    autoComplete,
    inputMode,
    maxLength,
    disabled,
    autoFocus,
    support,
    identifier,
    testId,
    trailing,
    prefix,
    help,
    onBlur,
    alert,
}) => {
    const shownSupport: SupportText | null = support ?? (help ? { kind: "help", text: help } : null);
    const supportId = shownSupport ? `${id}-support` : undefined;
    return (
        <div className="mx_ClarivaAuth_field">
            <label className="mx_ClarivaAuth_label" htmlFor={id}>
                {label}
            </label>
            {/* mx_no_textinput: opts out of the stock "text input in a dialog" styling (margin, 4px radius) */}
            <div
                className={classNames("mx_ClarivaAuth_inputRow", "mx_no_textinput", {
                    mx_ClarivaAuth_inputRow_error: support?.kind === "error",
                    mx_ClarivaAuth_inputRow_success: support?.kind === "available",
                    mx_ClarivaAuth_inputRow_disabled: disabled,
                })}
            >
                {prefix && (
                    <span className="mx_ClarivaAuth_prefix" aria-hidden="true">
                        {prefix}
                    </span>
                )}
                <input
                    id={id}
                    className="mx_ClarivaAuth_input"
                    type={type}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    maxLength={maxLength}
                    disabled={disabled}
                    autoFocus={autoFocus}
                    aria-invalid={support?.kind === "error" ? true : undefined}
                    aria-describedby={supportId}
                    data-testid={testId}
                    {...(identifier ? { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } : {})}
                />
                {trailing}
            </div>
            {shownSupport && (
                <div
                    id={supportId}
                    className={classNames("mx_ClarivaAuth_support", `mx_ClarivaAuth_support_${shownSupport.kind}`)}
                    // A live region that is inserted already holding its text is announced inconsistently; role="alert"
                    // is announced on insertion by every screen reader, so every error line is one.
                    role={shownSupport.kind === "error" || alert ? "alert" : undefined}
                    aria-live={shownSupport.kind === "error" ? "assertive" : "polite"}
                    data-testid={testId ? `${testId}-support` : undefined}
                >
                    <SupportIcon kind={shownSupport.kind} />
                    {shownSupport.text}
                </div>
            )}
        </div>
    );
};

export interface PasswordFieldProps extends Omit<AuthFieldProps, "type" | "trailing" | "identifier"> {
    /** `new-password` on sign-up / reset, `current-password` on sign-in. */
    autoComplete: "new-password" | "current-password";
}

/** Password input with the trailing eye button. Visibility resets to hidden while the form is busy (Android). */
export const PasswordField: React.FC<PasswordFieldProps> = ({ disabled, ...props }) => {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        if (disabled) setVisible(false);
    }, [disabled]);

    return (
        <AuthField
            {...props}
            disabled={disabled}
            type={visible ? "text" : "password"}
            trailing={
                <button
                    type="button"
                    className="mx_ClarivaAuth_eye mx_Dialog_nonDialogButton"
                    aria-label={visible ? authStrings.hidePassword : authStrings.showPassword}
                    aria-pressed={visible}
                    disabled={disabled}
                    onClick={() => setVisible((v) => !v)}
                    data-testid={props.testId ? `${props.testId}-toggle` : undefined}
                >
                    {visible ? <VisibilityOffIcon aria-hidden /> : <VisibilityOnIcon aria-hidden />}
                </button>
            }
        />
    );
};

export interface SwitchRowProps {
    id: string;
    title: string;
    subtitle: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    testId?: string;
}

/** Title + subtitle on the left, a switch on the right ("I am a consultant" / "Delete all my messages"). */
export const SwitchRow: React.FC<SwitchRowProps> = ({ id, title, subtitle, checked, onChange, disabled, testId }) => (
    <label className="mx_ClarivaAuth_switchRow" htmlFor={id}>
        <span className="mx_ClarivaAuth_switchText">
            <span className="mx_ClarivaAuth_switchTitle">{title}</span>
            <span className="mx_ClarivaAuth_switchSubtitle">{subtitle}</span>
        </span>
        <input
            id={id}
            className="mx_ClarivaAuth_switch"
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            data-testid={testId}
        />
    </label>
);
