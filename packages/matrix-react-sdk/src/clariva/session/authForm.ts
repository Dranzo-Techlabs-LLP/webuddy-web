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

import { authStrings } from "../strings/auth";

/**
 * Pure form rules of the Clariva landing page, ported from Android's `ClarivaAuthState.kt` (spec 01 §3.1-§3.3).
 * No React, no I/O: everything here is unit-tested and shared by the page, the forgot-password dialog and the
 * deactivate dialog.
 */

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;
export const MIN_PASSWORD_LENGTH = 8;
export const MIN_NAME_LENGTH = 2;
export const MIN_EMAIL_LENGTH = 5;
export const MIN_IDENTIFIER_LENGTH = 3;
export const RESET_CODE_LENGTH = 6;
/** Debounce for the live username/email availability checks (Android: USERNAME_CHECK_DEBOUNCE_MS). */
export const AVAILABILITY_DEBOUNCE_MS = 450;

/** 3-30 chars, first char alphanumeric, then `a-z 0-9 . _ -` (the server re-checks the same pattern). */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export type AuthMode = "signIn" | "signUp";
export type Availability = "unknown" | "checking" | "available" | "taken";

/** `trim().lowercase()`: what is checked and what is sent. */
export function normalizeUsername(raw: string): string {
    return raw.trim().toLowerCase();
}

export function isUsernameWellFormed(raw: string): boolean {
    const normalized = normalizeUsername(raw);
    return normalized.length > 0 && USERNAME_REGEX.test(normalized);
}

/** The e-mail rule used for sign-up, availability checks and the forgot-password dialog's "Send code". */
export function looksLikeEmail(raw: string): boolean {
    const trimmed = raw.trim();
    return trimmed.includes("@") && trimmed.length >= MIN_EMAIL_LENGTH;
}

/** Inline error under the Name field: only once something was typed. */
export function nameErrorText(name: string): string | null {
    return name.length > 0 && name.trim().length < MIN_NAME_LENGTH ? authStrings.nameError : null;
}

/** Hard error under the username field (Android order: too short, too long, bad pattern, taken). */
export function usernameHardError(raw: string, availability: Availability, takenReason?: string | null): string | null {
    const normalized = normalizeUsername(raw);
    if (normalized.length === 0) return null;
    if (normalized.length < MIN_USERNAME_LENGTH) return authStrings.usernameTooShort;
    if (normalized.length > MAX_USERNAME_LENGTH) return authStrings.usernameTooLong;
    if (!USERNAME_REGEX.test(normalized)) return authStrings.usernameInvalid;
    if (availability === "taken") return takenReason?.trim() || authStrings.usernameTaken;
    return null;
}

export type SupportKind = "error" | "checking" | "available" | "preview" | "help";

export interface SupportText {
    kind: SupportKind;
    text: string;
}

/**
 * The line shown under the username field. Priority (spec 01 §2.1): hard error > checking > available >
 * live preview > static help.
 */
export function usernameSupportText(
    raw: string,
    availability: Availability,
    serverName: string,
    takenReason?: string | null,
): SupportText {
    const error = usernameHardError(raw, availability, takenReason);
    if (error) return { kind: "error", text: error };
    const normalized = normalizeUsername(raw);
    if (availability === "checking") return { kind: "checking", text: authStrings.usernameChecking };
    if (availability === "available") {
        return { kind: "available", text: authStrings.usernameAvailable(normalized, serverName) };
    }
    if (normalized.length > 0) return { kind: "preview", text: authStrings.usernamePreview(normalized, serverName) };
    return { kind: "help", text: authStrings.usernameHelp };
}

/** The line shown under the e-mail field in sign-up mode (nothing for `unknown`). */
export function emailSupportText(availability: Availability): SupportText | null {
    switch (availability) {
        case "checking":
            return { kind: "checking", text: authStrings.emailChecking };
        case "available":
            return { kind: "available", text: authStrings.emailAvailable };
        case "taken":
            return { kind: "error", text: authStrings.emailTaken };
        default:
            return null;
    }
}

export interface AuthFormValues {
    mode: AuthMode;
    /** Shared field: "Email or username" when signing in, "Email" when signing up (values survive a mode toggle). */
    email: string;
    password: string;
    name: string;
    username: string;
    usernameAvailability: Availability;
    emailAvailability: Availability;
    isLoading: boolean;
    /** The "I am a consultant" switch (sign-up only). */
    isConsultant?: boolean;
    /**
     * The optional payout setup is skipped, or valid with an IFSC not known to be wrong (`isSetupReady` in
     * consultantSetup.ts). Only consulted for a consultant; omitted means ready.
     */
    consultantSetupReady?: boolean;
}

/**
 * Whether the primary button (and the Enter key!) may submit. Exact port of `ClarivaAuthState.submitEnabled`
 * (spec 01 §3.2). `unknown` and `checking` availability never block: the server is the real gate. Android's Enter
 * key bypassed this predicate; the web guards both with the same function.
 */
export function submitEnabled(values: AuthFormValues): boolean {
    if (values.isLoading) return false;
    const email = values.email.trim();
    const credentialsValid =
        values.mode === "signIn"
            ? email.length >= MIN_IDENTIFIER_LENGTH && values.password.length >= MIN_PASSWORD_LENGTH
            : looksLikeEmail(email) && values.password.length >= MIN_PASSWORD_LENGTH;
    if (!credentialsValid) return false;
    if (values.mode === "signIn") return true;
    return (
        values.name.trim().length >= MIN_NAME_LENGTH &&
        isUsernameWellFormed(values.username) &&
        values.usernameAvailability !== "taken" &&
        values.emailAvailability !== "taken" &&
        // The setup is optional, but what IS typed must be valid: half a bank account would otherwise be dropped.
        (!values.isConsultant || values.consultantSetupReady !== false)
    );
}

// ── forgot-password dialog ──────────────────────────────────────────────────────────────────────

/** The dialog is prefilled from the sign-in field only when that field holds an e-mail address. */
export function forgotPasswordPrefill(identifier: string): string {
    const trimmed = identifier.trim();
    return trimmed.includes("@") ? trimmed : "";
}

export function canSendResetCode(email: string, isLoading: boolean): boolean {
    return !isLoading && looksLikeEmail(email);
}

/** Digits only, at most six, enforced on every keystroke. */
export function sanitizeResetCode(raw: string): string {
    return raw.replace(/\D/g, "").slice(0, RESET_CODE_LENGTH);
}

export function canSubmitReset(code: string, newPassword: string, isLoading: boolean): boolean {
    const trimmed = code.trim();
    return (
        !isLoading &&
        trimmed.length === RESET_CODE_LENGTH &&
        /^\d{6}$/.test(trimmed) &&
        newPassword.length >= MIN_PASSWORD_LENGTH
    );
}

// ── deactivate dialog ───────────────────────────────────────────────────────────────────────────

export interface DeactivateInputs {
    /** `null` while the account type is still unknown (the lookup is in flight or failed). */
    isGoogleAccount: boolean | null;
    googleAuthorized: boolean;
    password: string;
    inProgress: boolean;
}

/** Android: unknown account type disables the button; Google needs a fresh token; email needs a password. */
export function canDeactivate(inputs: DeactivateInputs): boolean {
    if (inputs.inProgress) return false;
    if (inputs.isGoogleAccount === null) return false;
    return inputs.isGoogleAccount ? inputs.googleAuthorized : inputs.password.length > 0;
}

/**
 * 401 on a password sign-in can also mean "this is a Google-only account"; the web adds a hint (spec 01 §3.5 [N]).
 * The hint points at "Sign in with Google" only while that button is actually available on the page
 * (`googleAvailable`); otherwise it says Google is unavailable instead of pointing at something that is not there.
 */
export function signInFailureText(
    message: string,
    status: number | undefined,
    viaPassword: boolean,
    googleAvailable = true,
): string {
    if (viaPassword && status === 401) {
        const hint = googleAvailable ? authStrings.googleAccountHint : authStrings.googleAccountHintUnavailable;
        return `${message}\n${hint}`;
    }
    return message;
}
