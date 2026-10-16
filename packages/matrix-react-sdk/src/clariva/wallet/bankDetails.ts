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

import { type BankDetailsBody } from "../api/types";
import { walletStrings as S } from "../strings/wallet";

/**
 * Bank details form logic (spec 02 §2.7, §7.2.7). Android only checks that the five fields are not blank and sends
 * them untrimmed; the web trims, upper-cases the IFSC and applies two cheap format checks, because nothing on the
 * server validates them and a typo here is only discovered when a payout fails.
 */

export type BankField = "bankName" | "accountNumber" | "ifscCode" | "accountHolderName" | "branchName";

export interface BankForm {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountHolderName: string;
    branchName: string;
}

export const EMPTY_BANK_FORM: BankForm = {
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    branchName: "",
};

export const BANK_FIELDS: readonly { field: BankField; label: string; autoComplete: string }[] = [
    { field: "bankName", label: S.bankName, autoComplete: "off" },
    { field: "accountNumber", label: S.accountNumber, autoComplete: "off" },
    { field: "ifscCode", label: S.ifscCode, autoComplete: "off" },
    { field: "accountHolderName", label: S.accountHolderName, autoComplete: "off" },
    { field: "branchName", label: S.branchName, autoComplete: "off" },
];

/** 4 letters, a literal zero, 6 letters/digits. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{6,24}$/;

export const isBlank = (value: string): boolean => value.trim().length === 0;

/** The trimmed values that would be sent (IFSC upper-cased, inner whitespace of the account number removed). */
export function normalizeBankForm(form: BankForm): BankForm {
    return {
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.replace(/\s+/g, ""),
        ifscCode: form.ifscCode.trim().toUpperCase(),
        accountHolderName: form.accountHolderName.trim(),
        branchName: form.branchName.trim(),
    };
}

export type BankErrors = Partial<Record<BankField, string>>;

/** Field-level problems of the (normalised) form. Blank fields report "required". */
export function validateBankForm(form: BankForm): BankErrors {
    const n = normalizeBankForm(form);
    const errors: BankErrors = {};
    for (const { field } of BANK_FIELDS) {
        if (isBlank(n[field])) errors[field] = S.fieldRequired;
    }
    if (!errors.accountNumber && !ACCOUNT_NUMBER_PATTERN.test(n.accountNumber)) {
        errors.accountNumber = S.accountNumberInvalid;
    }
    if (!errors.ifscCode && !IFSC_PATTERN.test(n.ifscCode)) errors.ifscCode = S.ifscInvalid;
    return errors;
}

/** Android: "enabled iff not saving and all five fields are non-blank" (plus the format checks above). */
export function canSaveBankForm(form: BankForm, saving: boolean): boolean {
    return !saving && Object.keys(validateBankForm(form)).length === 0;
}

export function sameBankForm(a: BankForm, b: BankForm): boolean {
    const x = normalizeBankForm(a);
    const y = normalizeBankForm(b);
    return BANK_FIELDS.every(({ field }) => x[field] === y[field]);
}

/** `POST /v1/experts/bank-details` body; `expertId` is the Matrix user id (not the Webuddy name; identical here). */
export function toBankDetailsBody(expertId: string, form: BankForm): BankDetailsBody {
    const n = normalizeBankForm(form);
    return {
        expertId,
        bankName: n.bankName,
        accountNumber: n.accountNumber,
        ifscCode: n.ifscCode,
        accountHolderName: n.accountHolderName,
        branchName: n.branchName,
    };
}
