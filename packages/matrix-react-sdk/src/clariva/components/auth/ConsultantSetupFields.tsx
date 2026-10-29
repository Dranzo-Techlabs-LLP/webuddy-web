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
import LockIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock-solid";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";

import { type SupportText } from "../../session/authForm";
import {
    type ConsultantSetupField,
    type ConsultantSetupForm,
    MAX_CREDITS_MAX_DIGITS,
    maxCreditsError,
} from "../../session/consultantSetup";
import { authStrings } from "../../strings/auth";
import { accountNumberError, BankAccountRules, ifscError, isBankDetailsIncomplete } from "../../wallet/bankDetails";
import { type IfscStatus, ifscStatusText } from "../../wallet/ifsc";
import { AuthField } from "./fields";

/**
 * The line under an IFSC field: the format error first, then what the live lookup found. Shared by the sign-up
 * payout fields and Settings > Bank Details. A branch that is not found is an error; an unreachable directory is only
 * a note (it never blocks: the API checks the code again on save).
 */
export function ifscSupport(ifscCode: string, status: IfscStatus): SupportText | null {
    const formatError = ifscError(ifscCode);
    if (formatError) return { kind: "error", text: formatError };
    const text = ifscStatusText(status);
    if (!text) return null;
    switch (status.kind) {
        case "notFound":
            return { kind: "error", text };
        case "found":
            return { kind: "available", text };
        case "checking":
            return { kind: "checking", text };
        default:
            return { kind: "help", text };
    }
}

/** "Set up payouts  [Optional]" and the line under it. */
export const SetupHeader: React.FC<{ subtitle?: string; headingId?: string }> = ({ subtitle, headingId }) => (
    <div className="mx_ClarivaSetup_header">
        <div className="mx_ClarivaSetup_titleRow">
            <h2 className="mx_ClarivaSetup_title" id={headingId}>
                {authStrings.setupTitle}
            </h2>
            <span className="mx_ClarivaSetup_optional">{authStrings.setupOptional}</span>
        </div>
        <p className="mx_ClarivaSetup_subtitle">{subtitle ?? authStrings.setupSubtitle}</p>
    </div>
);

interface Props {
    setup: ConsultantSetupForm;
    onChange: (field: ConsultantSetupField, value: string) => void;
    ifscStatus: IfscStatus;
    disabled?: boolean;
    /** The name typed on the form (or Google's), shown as the account holder placeholder. */
    holderNameHint?: string;
    /** `undefined` hides the inline "Skip for now" (the Google step has its own, next to Continue). */
    onSkip?: () => void;
    showHeader?: boolean;
    /** Keeps element ids unique between the sign-up form and the Google dialog. */
    idPrefix: string;
}

/**
 * The optional chat rate + bank account fields (Android `ConsultantSetupFields`). Shared by the sign-up card and the
 * Google sign-up payout step, so both ask for, and check, exactly the same.
 */
export const ConsultantSetupFields: React.FC<Props> = ({
    setup,
    onChange,
    ifscStatus,
    disabled,
    holderNameHint,
    onSkip,
    showHeader = true,
    idPrefix,
}) => {
    const creditsError = maxCreditsError(setup);
    const numberError = accountNumberError(setup.accountNumber);
    const bankHeadingId = `${idPrefix}_bankTitle`;

    return (
        <div className="mx_ClarivaSetup_fields" data-testid="clariva-signup-setup">
            {showHeader && <SetupHeader />}
            <AuthField
                id={`${idPrefix}_maxCredits`}
                label={authStrings.maxCreditsLabel}
                value={setup.maxCredits}
                onChange={(v) => onChange("maxCredits", v)}
                placeholder={authStrings.maxCreditsPlaceholder}
                inputMode="numeric"
                autoComplete="off"
                maxLength={MAX_CREDITS_MAX_DIGITS}
                disabled={disabled}
                support={creditsError ? { kind: "error", text: creditsError } : null}
                help={authStrings.maxCreditsHelp}
                trailing={
                    <span className="mx_ClarivaSetup_suffix" aria-hidden="true">
                        {authStrings.maxCreditsSuffix}
                    </span>
                }
                testId="clariva-signup-max-credits"
            />

            <div className="mx_ClarivaSetup_bank" role="group" aria-labelledby={bankHeadingId}>
                <div className="mx_ClarivaSetup_bankHeader">
                    <h3 className="mx_ClarivaSetup_bankTitle" id={bankHeadingId}>
                        <LockIcon aria-hidden="true" />
                        {authStrings.bankTitle}
                    </h3>
                    <p className="mx_ClarivaSetup_bankHelp">{authStrings.bankHelp}</p>
                </div>
                <AuthField
                    id={`${idPrefix}_holder`}
                    label={authStrings.accountHolderLabel}
                    value={setup.accountHolderName}
                    onChange={(v) => onChange("accountHolderName", v)}
                    placeholder={holderNameHint?.trim() || undefined}
                    autoComplete="off"
                    maxLength={BankAccountRules.MAX_TEXT_LENGTH}
                    disabled={disabled}
                    testId="clariva-signup-account-holder"
                />
                <AuthField
                    id={`${idPrefix}_bankName`}
                    label={authStrings.bankNameLabel}
                    value={setup.bankName}
                    onChange={(v) => onChange("bankName", v)}
                    placeholder={authStrings.bankNamePlaceholder}
                    autoComplete="off"
                    maxLength={BankAccountRules.MAX_TEXT_LENGTH}
                    disabled={disabled}
                    testId="clariva-signup-bank-name"
                />
                <AuthField
                    id={`${idPrefix}_accountNumber`}
                    label={authStrings.accountNumberLabel}
                    value={setup.accountNumber}
                    onChange={(v) => onChange("accountNumber", v)}
                    inputMode="numeric"
                    autoComplete="off"
                    identifier
                    disabled={disabled}
                    support={numberError ? { kind: "error", text: numberError } : null}
                    testId="clariva-signup-account-number"
                />
                <AuthField
                    id={`${idPrefix}_ifsc`}
                    label={authStrings.ifscLabel}
                    value={setup.ifscCode}
                    onChange={(v) => onChange("ifscCode", v)}
                    placeholder={authStrings.ifscPlaceholder}
                    autoComplete="off"
                    identifier
                    disabled={disabled}
                    support={ifscSupport(setup.ifscCode, ifscStatus)}
                    testId="clariva-signup-ifsc"
                />
                <AuthField
                    id={`${idPrefix}_branch`}
                    label={authStrings.branchLabel}
                    value={setup.branchName}
                    onChange={(v) => onChange("branchName", v)}
                    autoComplete="off"
                    maxLength={BankAccountRules.MAX_TEXT_LENGTH}
                    disabled={disabled}
                    testId="clariva-signup-branch"
                />
                {/* "Create account" stays disabled while a bank account is half typed, so say why */}
                {isBankDetailsIncomplete(setup) && (
                    <p
                        className="mx_ClarivaSetup_incomplete"
                        role="status"
                        data-testid="clariva-signup-bank-incomplete"
                    >
                        <InfoIcon aria-hidden="true" />
                        {authStrings.bankIncomplete}
                    </p>
                )}
            </div>

            {onSkip && (
                <div className="mx_ClarivaSetup_actions">
                    <button
                        type="button"
                        className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                        onClick={onSkip}
                        disabled={disabled}
                        data-testid="clariva-signup-setup-skip"
                    >
                        {authStrings.setupSkip}
                    </button>
                </div>
            )}
        </div>
    );
};

/** What replaces the fields after "Skip for now": where to do it later, and a way back. */
export const SkippedSetup: React.FC<{ onResume: () => void; disabled?: boolean }> = ({ onResume, disabled }) => (
    <div className="mx_ClarivaSetup_skipped" data-testid="clariva-signup-setup-skipped">
        <p className="mx_ClarivaSetup_skippedText">
            <InfoIcon aria-hidden="true" />
            {authStrings.setupSkipped}
        </p>
        <div className="mx_ClarivaSetup_actions">
            <button
                type="button"
                className="mx_ClarivaAuth_linkButton mx_Dialog_nonDialogButton"
                onClick={onResume}
                disabled={disabled}
                data-testid="clariva-signup-setup-resume"
            >
                {authStrings.setupResume}
            </button>
        </div>
    </div>
);
