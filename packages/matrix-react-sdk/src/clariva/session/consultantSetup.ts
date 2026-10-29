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

import { logger } from "matrix-js-sdk/src/logger";

import ToastStore from "../../stores/ToastStore";
import GenericToast from "../../components/views/toasts/GenericToast";
import { ClarivaWalletApi } from "../api/wallet";
import { type MyBankDetailsBody } from "../api/types";
import { authStrings } from "../strings/auth";
import {
    type BankField,
    type BankForm,
    EMPTY_BANK_FORM,
    hasBankDetails,
    isBankDetailsComplete,
    sanitizeBankInput,
    toMyBankDetailsBody,
} from "../wallet/bankDetails";

/**
 * Optional chat rate and payout bank account, shown on sign-up only once the user says they are a consultant (and as
 * the Google sign-up payout step). Port of Android's `ConsultantSetupForm.kt` and `saveConsultantSetup` in
 * `ClarivaAuthPresenter.kt`. Everything can be left empty or skipped; it can all be set later in Settings.
 */

export const MIN_MAX_CREDITS = 1;
export const MAX_MAX_CREDITS = 100_000;
export const MAX_CREDITS_MAX_DIGITS = 6;
/** Per call; the chat rate and the bank account are saved in parallel. */
export const CONSULTANT_SETUP_TIMEOUT_MS = 10_000;

export type ConsultantSetupField = "maxCredits" | BankField;

/** Values are kept exactly as typed (bar the keystroke filter) and normalised by the functions below. */
export interface ConsultantSetupForm extends BankForm {
    isSkipped: boolean;
    maxCredits: string;
}

export const EMPTY_CONSULTANT_SETUP: ConsultantSetupForm = { ...EMPTY_BANK_FORM, isSkipped: false, maxCredits: "" };

/** Digits only, at most 6 (Android rejects any other keystroke). */
export function sanitizeSetupInput(field: ConsultantSetupField, raw: string): string {
    if (field === "maxCredits") return raw.replace(/\D+/g, "").slice(0, MAX_CREDITS_MAX_DIGITS);
    return sanitizeBankInput(field, raw);
}

export function withSetupField(
    setup: ConsultantSetupForm,
    field: ConsultantSetupField,
    raw: string,
): ConsultantSetupForm {
    return { ...setup, [field]: sanitizeSetupInput(field, raw) };
}

/** "Skip for now" drops what was typed (Android: `ConsultantSetupForm(isSkipped = true)`). */
export function skipSetup(): ConsultantSetupForm {
    return { ...EMPTY_CONSULTANT_SETUP, isSkipped: true };
}

export function resumeSetup(setup: ConsultantSetupForm): ConsultantSetupForm {
    return { ...setup, isSkipped: false };
}

/** `null` when left empty (the rate is then set later) or out of range. */
export function maxCreditsValue(setup: ConsultantSetupForm): number | null {
    const trimmed = setup.maxCredits.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return n >= MIN_MAX_CREDITS && n <= MAX_MAX_CREDITS ? n : null;
}

export function maxCreditsError(setup: ConsultantSetupForm): string | null {
    return setup.maxCredits.trim() && maxCreditsValue(setup) === null
        ? authStrings.maxCreditsError(MIN_MAX_CREDITS, MAX_MAX_CREDITS)
        : null;
}

/** Skipped, empty, or fully valid: anything else blocks "Create account". */
export function isSetupValid(setup: ConsultantSetupForm): boolean {
    return (
        setup.isSkipped || (maxCreditsError(setup) === null && (!hasBankDetails(setup) || isBankDetailsComplete(setup)))
    );
}

/**
 * The setup is skipped, or valid with an IFSC that is not known to be wrong or still being checked (Android
 * `ClarivaAuthState.isConsultantSetupReady`). `ifscBlocksSave` comes from the live lookup (ifsc.ts).
 */
export function isSetupReady(setup: ConsultantSetupForm, ifscBlocksSave: boolean): boolean {
    return setup.isSkipped || (isSetupValid(setup) && !ifscBlocksSave);
}

/** Something will actually be saved after the account is created. */
export function hasAnythingToSave(setup: ConsultantSetupForm): boolean {
    return !setup.isSkipped && (maxCreditsValue(setup) !== null || hasBankDetails(setup));
}

/** What to save after the account exists, or `null` (not a consultant, skipped, or nothing typed). */
export function setupToSave(isConsultant: boolean, setup: ConsultantSetupForm): ConsultantSetupForm | null {
    return isConsultant && hasAnythingToSave(setup) ? setup : null;
}

// ── saving after sign-up ────────────────────────────────────────────────────────────────────────

/** What could not be saved (`null`: everything that was asked for was saved). */
export type SetupSaveFailure = "rate" | "bank" | "both" | null;

export interface SetupSaveApi {
    updateMaxCredits(matrixUserId: string, maxCredits: number, timeoutMs: number): Promise<unknown>;
    saveBankDetails(jwt: string, body: MyBankDetailsBody, timeoutMs: number): Promise<unknown>;
}

const defaultApi: SetupSaveApi = {
    updateMaxCredits: (matrixUserId, maxCredits, timeoutMs) =>
        ClarivaWalletApi.updateUser(matrixUserId, { max_credits: maxCredits }, { timeoutMs }),
    saveBankDetails: (jwt, body, timeoutMs) => ClarivaWalletApi.saveMyBankDetails(jwt, body, { timeoutMs }),
};

/** Resolves `true` when `work` succeeded within `timeoutMs`; never rejects (Android: `withTimeoutOrNull` + `runCatching`). */
async function succeedsWithin(work: () => Promise<unknown>, timeoutMs: number, what: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const attempt = (async (): Promise<boolean> => {
        try {
            await work();
            return true;
        } catch (e) {
            logger.warn(`Clariva: ${what} not saved at sign-up`, e);
            return false;
        }
    })();
    try {
        return await Promise.race([attempt, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Save the optional chat rate and bank account typed at sign-up, once the account exists.
 *
 * Both run together and each is bounded by `timeoutMs`; nothing here ever throws, so it can never block or fail
 * signing in. The bank account is authorised by the Clariva JWT of this sign-up (`jwt`, captured before it is
 * dropped); without one it counts as not saved (Android: "Please sign in again to add bank details").
 */
export async function saveConsultantSetup(args: {
    matrixUserId: string;
    jwt: string | null;
    setup: ConsultantSetupForm;
    timeoutMs?: number;
    api?: SetupSaveApi;
}): Promise<SetupSaveFailure> {
    const { matrixUserId, jwt, setup } = args;
    const timeoutMs = args.timeoutMs ?? CONSULTANT_SETUP_TIMEOUT_MS;
    const api = args.api ?? defaultApi;

    const credits = maxCreditsValue(setup);
    const rate =
        credits === null
            ? null
            : succeedsWithin(() => api.updateMaxCredits(matrixUserId, credits, timeoutMs), timeoutMs, "chat rate");
    const bank = !hasBankDetails(setup)
        ? null
        : jwt
          ? succeedsWithin(
                () => api.saveBankDetails(jwt, toMyBankDetailsBody(setup), timeoutMs),
                timeoutMs,
                "bank details",
            )
          : Promise.resolve(false);

    const rateSaved = rate ? await rate : true;
    const bankSaved = bank ? await bank : true;
    if (!rateSaved && !bankSaved) return "both";
    if (!bankSaved) return "bank";
    if (!rateSaved) return "rate";
    return null;
}

/** Everything `setup` asks to save, as a failure: for an account that exists but whose setup was never saved. */
export function unsavedSetupFailure(setup: ConsultantSetupForm | null): SetupSaveFailure {
    if (!setup || !hasAnythingToSave(setup)) return null;
    const rate = maxCreditsValue(setup) !== null;
    const bank = hasBankDetails(setup);
    if (rate && bank) return "both";
    return bank ? "bank" : "rate";
}

/** Android's home-screen snackbar copy for each failure. */
export function setupFailureText(failure: SetupSaveFailure): string | null {
    switch (failure) {
        case "both":
            return authStrings.setupFailedBoth;
        case "bank":
            return authStrings.setupFailedBank;
        case "rate":
            return authStrings.setupFailedRate;
        default:
            return null;
    }
}

const SETUP_FAILED_TOAST_KEY = "clariva_signup_setup_failed";

/**
 * Tell the user, once they are in the app, what the sign-up setup did not save. Android posts a long snackbar on its
 * app-wide dispatcher so it shows on the home screen; the web's equivalent is Element's global ToastStore: it
 * survives the landing page unmounting and is drawn by the logged-in view. It must be raised AFTER the client has
 * started (Lifecycle resets the ToastStore when it starts one), which is why callers report only once sign-in has
 * completed. A toast, unlike a modal, never interrupts the first look at the app.
 */
export function showSetupFailure(failure: SetupSaveFailure): void {
    const text = setupFailureText(failure);
    if (!text) return;
    ToastStore.sharedInstance().addOrReplaceToast({
        key: SETUP_FAILED_TOAST_KEY,
        title: authStrings.setupFailedTitle,
        icon: "verification_warning",
        props: {
            description: text,
            primaryLabel: authStrings.ok,
            onPrimaryClick: (): void => ToastStore.sharedInstance().dismissToast(SETUP_FAILED_TOAST_KEY),
        },
        component: GenericToast,
        priority: 20,
    });
}
