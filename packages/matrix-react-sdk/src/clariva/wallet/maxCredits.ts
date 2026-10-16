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

/**
 * Pure logic of the consultant "Max Credits" editor (spec 02 §2.6, §3.8).
 *
 * The user's edit is a *draft* held in component state: `null` means "untouched, show the saved value", a string
 * means "the user typed this". The saved value comes from the polled `WalletStore`. Because an untouched draft is
 * `null` and a touched one is never rewritten by anything but the user, a poll can never clobber what is being typed
 * (the Android bug of spec 02 §3.8 / §7.2.4, where the 8 s refresh reset an unsaved edit).
 */

/** `max_credits` is DECIMAL(10,2); whole credits only, so 8 digits is the largest the column can hold. */
export const MAX_CREDITS_LIMIT = 99_999_999;
export const MAX_CREDITS_DIGITS = String(MAX_CREDITS_LIMIT).length;

/** Digits only (Android accepts `isEmpty() || all(isDigit)`; pasting "1,000" yields "1000"). */
export function sanitizeMaxCreditsInput(text: string): string {
    return text.replace(/\D+/g, "").slice(0, MAX_CREDITS_DIGITS);
}

/** What the field shows: the draft when there is one, otherwise the saved value ("" while the saved value is unknown). */
export function displayedValue(draft: string | null, saved: number | null): string {
    if (draft !== null) return draft;
    return saved === null ? "" : String(Math.trunc(saved));
}

/** The draft as a number, or `null` when it is empty / not a whole number within range. */
export function parseDraft(draft: string | null): number | null {
    if (draft === null || draft === "" || !/^\d+$/.test(draft)) return null;
    const n = Number(draft);
    return Number.isSafeInteger(n) && n <= MAX_CREDITS_LIMIT ? n : null;
}

/**
 * Android's `hasChanges = input.isNotEmpty() && input != savedValue`. An empty field hides Save/Cancel (the user is
 * mid-edit); the saved value is compared as a number so "0100" counts as equal to 100.
 */
export function isDirty(draft: string | null, saved: number | null): boolean {
    if (draft === null || draft === "") return false;
    const n = Number(draft);
    if (!Number.isFinite(n)) return true;
    return saved === null || n !== Math.trunc(saved);
}

/** The draft is above what the column can store: Save is disabled and the field says why. */
export function isTooLarge(draft: string | null): boolean {
    return draft !== null && /^\d+$/.test(draft) && Number(draft) > MAX_CREDITS_LIMIT;
}

/** Save is possible: dirty, a valid number, and nothing already in flight. */
export function canSave(draft: string | null, saved: number | null, saving: boolean): boolean {
    return !saving && isDirty(draft, saved) && parseDraft(draft) !== null;
}
