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

import { round2 } from "../money";
import { chatStrings } from "../strings/chat";

/**
 * Pure helpers for the consultant's "Approve Refund" dialog (spec 03 U5 / lesson L13).
 */

/** Tolerance when comparing a typed amount with the held amount (spec: `r > held + 1e-6`). */
const HELD_EPSILON = 1e-6;

/** The only characters the field accepts: digits and at most one dot (no sign, no spaces, no exponent). */
const AMOUNT_INPUT_PATTERN = /^\d*\.?\d*$/;

/**
 * Android's `formatAmount`: an integer when the value is whole (`20.0` -> `20`), otherwise the plain decimal
 * (`12.5`, `12.34`). Used for the "₹{held}" texts and for the `{amt}` of the partial-approval Matrix message.
 * The value is first rounded to the server's 2-decimal precision so float noise (0.1 + 0.2) never leaks out.
 */
export function formatPlainAmount(value: number): string {
    return String(round2(value));
}

/** Input filter: accept the new field value only when it is empty or matches `^\d*\.?\d*$`. */
export function isAllowedRefundAmountInput(next: string): boolean {
    return AMOUNT_INPUT_PATTERN.test(next);
}

/**
 * Parse the typed text like Kotlin's `trim().toDoubleOrNull()` for the characters the filter lets through:
 * `"5."` -> 5, `".5"` -> 0.5, `"."` / `""` -> null. (JS `Number("")` is 0, so blanks are handled explicitly.)
 */
export function parseRefundAmountText(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed || !AMOUNT_INPUT_PATTERN.test(trimmed) || !/\d/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
}

export interface RefundAmountValidation {
    /** The text parsed and rounded to 2 dp with the server's rounding (`Math.round(x * 100) / 100`), or null. */
    amount: number | null;
    /** `amount != null && amount > 0 && !(held known && amount > held + 1e-6)`. */
    valid: boolean;
    /** Error state of the field: Partial mode, text not blank and not valid. */
    showError: boolean;
}

/**
 * Validate the "Partial refund" field. `held` is the amount of the hold in credits (`null` when unknown, in which
 * case there is no upper bound client-side and the server decides).
 */
export function validateRefundAmount(text: string, held: number | null): RefundAmountValidation {
    const parsed = parseRefundAmountText(text);
    const amount = parsed === null ? null : round2(parsed);
    const heldKnown = held !== null && Number.isFinite(held);
    const valid = amount !== null && amount > 0 && !(heldKnown && amount > (held as number) + HELD_EPSILON);
    return { amount, valid, showError: text.trim().length > 0 && !valid };
}

/** The supporting text under the Partial field (spec U5). */
export function refundAmountSupportText(showError: boolean, held: number | null): string {
    const heldText = held !== null && Number.isFinite(held) ? formatPlainAmount(held) : null;
    if (showError) {
        return heldText !== null
            ? chatStrings.refundAmountErrorWithHeld(heldText)
            : chatStrings.refundAmountErrorNoHeld;
    }
    return heldText !== null ? chatStrings.refundAmountHelperWithHeld(heldText) : chatStrings.refundAmountHelperNoHeld;
}
