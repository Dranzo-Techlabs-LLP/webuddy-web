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

import { ClarivaHttpError } from "../api/http";
import { type MyBankDetailsBody, type SavedBankAccount } from "../api/types";
import { walletStrings as S } from "../strings/wallet";

/**
 * Payout bank account rules, shared by consultant sign-up and Settings > Bank Details. Port of Android's
 * `BankAccountRules` (BankDetails.kt), kept in sync with the API's `AddMyBankDetailDto`. Pure: no React, no I/O.
 */
export const BankAccountRules = {
    ACCOUNT_NUMBER_MAX_DIGITS: 18,
    IFSC_LENGTH: 11,
    MAX_TEXT_LENGTH: 120,
    MIN_NAME_LENGTH: 2,
    ACCOUNT_NUMBER_REGEX: /^\d{9,18}$/,
    IFSC_REGEX: /^[A-Z]{4}0[A-Z0-9]{6}$/,

    isValidAccountNumber(value: string): boolean {
        return BankAccountRules.ACCOUNT_NUMBER_REGEX.test(value.trim());
    },
    isValidIfsc(value: string): boolean {
        return BankAccountRules.IFSC_REGEX.test(normalizeIfsc(value));
    },
    isValidName(value: string): boolean {
        return value.trim().length >= BankAccountRules.MIN_NAME_LENGTH;
    },
} as const;

export function normalizeIfsc(value: string): string {
    return value.trim().toUpperCase();
}

export type BankField = "accountHolderName" | "bankName" | "accountNumber" | "ifscCode" | "branchName";

/** The bank fields exactly as typed (normalised only when checked and sent). */
export interface BankForm {
    accountHolderName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branchName: string;
}

export const EMPTY_BANK_FORM: BankForm = {
    accountHolderName: "",
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    branchName: "",
};

/**
 * What a keystroke may put in a field. Android rejects a keystroke that breaks these (rewriting the text desyncs its
 * IME); the web has no IME problem, so a paste such as "1234 5678 9012" keeps its digits instead of being refused.
 */
export function sanitizeBankInput(field: BankField, raw: string): string {
    switch (field) {
        case "accountNumber":
            return raw.replace(/\D+/g, "").slice(0, BankAccountRules.ACCOUNT_NUMBER_MAX_DIGITS);
        case "ifscCode":
            // shown upper-cased, as Android's capitalising keyboard would type it
            return raw
                .replace(/[^A-Za-z0-9]+/g, "")
                .toUpperCase()
                .slice(0, BankAccountRules.IFSC_LENGTH);
        default:
            return raw.replace(/[\r\n]+/g, "").slice(0, BankAccountRules.MAX_TEXT_LENGTH);
    }
}

/** Shown under the field only once something is typed, so an empty form does not nag. */
export function accountNumberError(accountNumber: string): string | null {
    return accountNumber.trim() && !BankAccountRules.isValidAccountNumber(accountNumber) ? S.accountNumberError : null;
}

export function ifscError(ifscCode: string): string | null {
    return ifscCode.trim() && !BankAccountRules.isValidIfsc(ifscCode) ? S.ifscFormatError : null;
}

/** True once any bank field is filled: from then on all required ones are needed. */
export function hasBankDetails(form: BankForm): boolean {
    return [form.accountHolderName, form.bankName, form.accountNumber, form.ifscCode, form.branchName].some(
        (v) => v.trim().length > 0,
    );
}

/** Holder, bank, account number and IFSC valid; the branch is optional. */
export function isBankDetailsComplete(form: BankForm): boolean {
    return (
        BankAccountRules.isValidName(form.accountHolderName) &&
        BankAccountRules.isValidName(form.bankName) &&
        BankAccountRules.isValidAccountNumber(form.accountNumber) &&
        BankAccountRules.isValidIfsc(form.ifscCode)
    );
}

/** Partly filled: shown under the sign-up bank section, which then blocks "Create account". */
export function isBankDetailsIncomplete(form: BankForm): boolean {
    return hasBankDetails(form) && !isBankDetailsComplete(form);
}

/**
 * Settings > Bank Details "Save Details" (Android `BankDetailsState.canSave`): not saving, every required field valid,
 * and an IFSC that is not known to be wrong or still being checked (`ifscBlocksSave`, see ifsc.ts).
 */
export function canSaveBankDetails(form: BankForm, ifscBlocksSave: boolean, saving: boolean): boolean {
    return !saving && isBankDetailsComplete(form) && !ifscBlocksSave;
}

/** `POST /v1/experts/me/bank-details` body: trimmed, IFSC upper-cased, a blank branch omitted rather than sent blank. */
export function toMyBankDetailsBody(form: BankForm): MyBankDetailsBody {
    const branch = form.branchName.trim();
    return {
        accountHolderName: form.accountHolderName.trim(),
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.trim(),
        ifscCode: normalizeIfsc(form.ifscCode),
        ...(branch ? { branchName: branch } : {}),
    };
}

/** What an IFSC lookup filled in (bank and branch), see `applyIfscAutofill`. */
export interface IfscAutofill {
    bank: string;
    branch: string;
}

/**
 * A found branch fills in bank and branch WITHOUT overwriting what the user typed: a field is replaced only while it
 * is blank or still holds what the previous lookup put there (Android: `takeUnless { isBlank() || it == previous }`).
 */
export function applyIfscAutofill<T extends Pick<BankForm, "bankName" | "branchName">>(
    form: T,
    found: IfscAutofill,
    previous: IfscAutofill | null,
): T {
    const keep = (value: string, previousValue: string | undefined): boolean =>
        !(value.trim() === "" || value === previousValue);
    return {
        ...form,
        bankName: keep(form.bankName, previous?.bank) ? form.bankName : found.bank,
        branchName: keep(form.branchName, previous?.branch) ? form.branchName : found.branch,
    };
}

/** "State Bank of India •••• 9012". */
export function savedAccountTitle(account: SavedBankAccount): string {
    return `${account.bankName} •••• ${account.accountNumberLast4}`;
}

/** "Jane Doe · IFSC SBIN0001234 · MG Road" (the branch only when there is one). */
export function savedAccountDetails(account: SavedBankAccount): string {
    return [account.accountHolderName, `IFSC ${account.ifscCode}`, account.branchName?.trim() || null]
        .filter((p): p is string => !!p)
        .join(" · ");
}

/**
 * The API's own reason for a rejected save (a 4xx such as "No bank branch found for IFSC ..."), else the generic
 * line: never a server error page or a network library message (Android `WalletApiException.userMessage`).
 */
export function bankSaveErrorText(e: unknown): string {
    if (e instanceof ClarivaHttpError && !e.isNetwork && e.status >= 400 && e.status <= 499 && e.serverMessage) {
        return e.serverMessage;
    }
    return S.bankSaveFailed;
}
