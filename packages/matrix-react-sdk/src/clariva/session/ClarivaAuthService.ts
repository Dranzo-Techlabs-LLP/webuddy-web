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

import { ClarivaAuthApi } from "../api/auth";
import { ClarivaHttpError } from "../api/http";
import {
    type ClarivaAuthResponse,
    type ClarivaAvailability,
    type ClarivaMatrixSessionResponse,
    type ClarivaPublicUser,
} from "../api/types";
import { ClarivaSession } from "./ClarivaSession";

/**
 * Port of Android's `ClarivaAuthService` (libraries/network/.../wallet/ClarivaAuthService.kt) plus the web
 * improvements listed in docs/clariva/spec/01 §3.11 ([N] items). Flow: authenticate against the Clariva API → a JWT
 * → exchange it (exactly once) for a Matrix session. The Matrix password is machine-generated and never reaches the
 * client; the client never calls Matrix `/login`.
 */

/** A user-presentable failure. `message` is safe to show verbatim. */
export class ClarivaAuthError extends Error {
    public readonly name = "ClarivaAuthError";

    public constructor(
        message: string,
        public readonly status?: number,
        public readonly cause?: unknown,
    ) {
        super(message);
        Object.setPrototypeOf(this, ClarivaAuthError.prototype);
    }
}

export interface ClarivaMatrixCredentials {
    matrixUserId: string;
    accessToken: string;
    deviceId: string;
    /** Unlocks (or creates, on the first device) this account's secret storage. `undefined` on an older API. */
    recoveryPassphrase?: string;
}

export interface ClarivaSignedIn {
    credentials: ClarivaMatrixCredentials;
    user: ClarivaPublicUser;
}

/** Google sign-in either completes, or stops to ask a brand-new user for their role. */
export type GoogleAuthOutcome =
    | ({ kind: "signedIn" } & ClarivaSignedIn)
    | {
          kind: "roleRequired";
          email: string | undefined;
          name: string | undefined;
          /** `false`: no Clariva row exists, continuing creates the account. `undefined`: the server did not say. */
          isExisting: boolean | undefined;
      };

export const AUTH_STRINGS = {
    network: "Could not reach Clariva. Check your connection and try again.",
    badRequest: "Please check the details you entered and try again.",
    unauthorized: "Incorrect email or password.",
    conflict: "That email or username is already taken.",
    serverTrouble: "Clariva is having trouble right now. Please try again shortly.",
    tooManyAttempts: "Too many attempts. Please wait a few minutes and try again.",
    noSession: "Clariva did not return a session. Please try again.",
    roleLoop: "Could not complete Google sign-up. Please try again.",
    deactivate401: "Could not verify your identity. Please try again.",
    deactivate400: "Please re-authorise before deactivating.",
    deactivateFailed: "Could not deactivate the account. Please try again.",
} as const;

const sessionError = (status: number): string => `Sign-in failed (error ${status}).`;

/**
 * Map a failure to the text shown to the user. Mirrors Android's `mapHttpError` (spec 01 §3.11) with the
 * recommended web improvements: a specific 429 message, and server messages for 401 on Google/deactivate.
 */
export function mapAuthError(e: unknown, context: "auth" | "google" | "deactivate" = "auth"): ClarivaAuthError {
    if (e instanceof ClarivaAuthError) return e;
    if (e instanceof ClarivaHttpError) {
        if (e.isNetwork) return new ClarivaAuthError(AUTH_STRINGS.network, 0, e);
        const status = e.status;
        // 400 and 409 carry an actionable reason (which username is taken, which field is malformed).
        if ((status === 400 || status === 409) && e.serverMessage)
            return new ClarivaAuthError(e.serverMessage, status, e);
        if (status === 429) return new ClarivaAuthError(AUTH_STRINGS.tooManyAttempts, status, e);
        if (context === "deactivate") {
            if (e.serverMessage) return new ClarivaAuthError(e.serverMessage, status, e);
            if (status === 401) return new ClarivaAuthError(AUTH_STRINGS.deactivate401, status, e);
            if (status === 400) return new ClarivaAuthError(AUTH_STRINGS.deactivate400, status, e);
            return new ClarivaAuthError(`Could not deactivate the account (error ${status}).`, status, e);
        }
        if (status === 401) {
            // Google endpoints answer 401 with a specific reason ("Invalid Google credentials", ...).
            return new ClarivaAuthError(
                context === "google" && e.serverMessage ? e.serverMessage : AUTH_STRINGS.unauthorized,
                status,
                e,
            );
        }
        if (status === 400) return new ClarivaAuthError(AUTH_STRINGS.badRequest, status, e);
        if (status === 409) return new ClarivaAuthError(AUTH_STRINGS.conflict, status, e);
        if (status >= 500) return new ClarivaAuthError(AUTH_STRINGS.serverTrouble, status, e);
        return new ClarivaAuthError(sessionError(status), status, e);
    }
    return new ClarivaAuthError(AUTH_STRINGS.network, 0, e);
}

export class ClarivaAuthService {
    // `matrix-session` rotates the Matrix password on every call: two concurrent calls for the same account make
    // the loser's login fail (spec 05 race R4). Single-flight per JWT so a double click can never fire two.
    private readonly sessionInFlight = new Map<string, Promise<ClarivaMatrixSessionResponse>>();

    /** Email sign-up (also provisions the Matrix account server-side), then a Matrix session. */
    public async signUpWithEmail(args: {
        email: string;
        password: string;
        name: string;
        username: string;
        isConsultant: boolean;
    }): Promise<ClarivaSignedIn> {
        return this.runAuth(() =>
            ClarivaAuthApi.register({
                email: args.email.trim(),
                password: args.password,
                name: args.name.trim(),
                username: args.username.trim().toLowerCase(),
                // ALWAYS present (0|1): the server validates it and omission once broke every new client account.
                isConsultant: args.isConsultant ? 1 : 0,
            }),
        );
    }

    /** `identifier` is an email address or a username; the API resolves either. */
    public async signInWithEmail(identifier: string, password: string): Promise<ClarivaSignedIn> {
        return this.runAuth(() => ClarivaAuthApi.login({ identifier: identifier.trim(), password }));
    }

    /**
     * Either signs in, or reports that a brand-new user must pick a role first. `isConsultant` is `null` on the
     * first attempt (the server then answers `needsRole` instead of silently defaulting to a client) and `mode:
     * "signup"` is sent only from the sign-up screen, never on the role follow-up.
     */
    public async signInWithGoogle(args: {
        idToken: string;
        isConsultant: boolean | null;
        isSignUp?: boolean;
    }): Promise<GoogleAuthOutcome> {
        try {
            const response = await ClarivaAuthApi.google({
                idToken: args.idToken,
                ...(args.isConsultant === null ? {} : { isConsultant: args.isConsultant ? 1 : 0 }),
                ...(args.isSignUp && args.isConsultant === null ? { mode: "signup" as const } : {}),
            });
            if (response.needsRole === true) {
                if (args.isConsultant !== null) throw new ClarivaAuthError(AUTH_STRINGS.roleLoop);
                return {
                    kind: "roleRequired",
                    email: response.email ?? undefined,
                    name: response.name ?? undefined,
                    // not collapsed to a boolean: an older server that omits it must not read as "no account exists"
                    isExisting: typeof response.isExisting === "boolean" ? response.isExisting : undefined,
                };
            }
            if (!response.token || !response.user) throw new ClarivaAuthError(AUTH_STRINGS.noSession);
            const signedIn = await this.finishSignIn({ token: response.token, user: response.user });
            return { kind: "signedIn", ...signedIn };
        } catch (e) {
            throw mapAuthError(e, "google");
        }
    }

    /**
     * Retry only the Matrix-session exchange with the JWT of a sign-up/sign-in whose SECOND step failed
     * (spec 01 §7.3 #12: the account already exists, so a second "Create account" would 409). Callers retry once and
     * only on network-level failures (`status === 0`): every successful exchange leaves a device behind and Synapse
     * rate-limits logins.
     */
    public async resumeMatrixSession(): Promise<ClarivaSignedIn> {
        const jwt = ClarivaSession.instance.jwt;
        const user = ClarivaSession.instance.user;
        if (!jwt || !user) throw new ClarivaAuthError(AUTH_STRINGS.network, 0);
        try {
            return await this.finishSignIn({ token: jwt, user });
        } catch (e) {
            throw mapAuthError(e);
        }
    }

    // ── availability (silent on any failure: never claim "taken" when we could not check) ──────────

    public async isUsernameAvailable(username: string, signal?: AbortSignal): Promise<ClarivaAvailability | null> {
        try {
            return await ClarivaAuthApi.usernameAvailable(username.trim().toLowerCase(), { signal });
        } catch (e) {
            logger.debug("Clariva auth: username availability check failed", e);
            return null;
        }
    }

    public async isEmailAvailable(email: string, signal?: AbortSignal): Promise<ClarivaAvailability | null> {
        try {
            return await ClarivaAuthApi.emailAvailable(email.trim(), { signal });
        } catch (e) {
            logger.debug("Clariva auth: email availability check failed", e);
            return null;
        }
    }

    // ── password reset ──────────────────────────────────────────────────────────────────────────────

    /** The server always reports success whether or not the email exists; success only means "accepted". */
    public async requestPasswordReset(email: string): Promise<void> {
        try {
            await ClarivaAuthApi.forgotPassword(email.trim());
        } catch (e) {
            throw mapAuthError(e);
        }
    }

    public async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
        try {
            await ClarivaAuthApi.resetPassword({ email: email.trim(), code: code.trim(), newPassword });
        } catch (e) {
            throw mapAuthError(e);
        }
    }

    // ── account lifecycle ───────────────────────────────────────────────────────────────────────────

    /** Does this account deactivate with a password, or with Google re-auth? `null` when unknown. */
    public async isGoogleAccount(matrixUserId: string): Promise<boolean | null> {
        try {
            return (await ClarivaAuthApi.reauthMethod(matrixUserId)).isGoogleAccount;
        } catch (e) {
            logger.debug("Clariva auth: could not determine the re-auth method", e);
            return null;
        }
    }

    /** Permanently deactivate. Exactly one proof: `password` (email account) or `googleIdToken` (Google account). */
    public async deactivateAccount(args: {
        matrixUserId: string;
        password?: string;
        googleIdToken?: string;
        eraseData: boolean;
    }): Promise<void> {
        try {
            const res = await ClarivaAuthApi.deactivate({
                matrixUserId: args.matrixUserId,
                ...(args.password !== undefined ? { password: args.password } : {}),
                ...(args.googleIdToken !== undefined ? { googleIdToken: args.googleIdToken } : {}),
                eraseData: args.eraseData,
            });
            if (!res.deactivated) throw new ClarivaAuthError(AUTH_STRINGS.deactivateFailed);
        } catch (e) {
            throw mapAuthError(e, "deactivate");
        }
    }

    // ── internals ───────────────────────────────────────────────────────────────────────────────────

    private async runAuth(authenticate: () => Promise<ClarivaAuthResponse>): Promise<ClarivaSignedIn> {
        try {
            return await this.finishSignIn(await authenticate());
        } catch (e) {
            throw mapAuthError(e);
        }
    }

    /** JWT → Matrix session. The JWT is held in memory only. */
    private async finishSignIn(auth: ClarivaAuthResponse): Promise<ClarivaSignedIn> {
        ClarivaSession.instance.setAuthenticated(auth.token, auth.user);
        const session = await this.exchangeForMatrixSession(auth.token);
        ClarivaSession.instance.setRecoveryPassphrase(session.recoveryPassphrase);
        return {
            user: auth.user,
            credentials: {
                matrixUserId: session.userId,
                accessToken: session.accessToken,
                deviceId: session.deviceId,
                recoveryPassphrase: session.recoveryPassphrase?.trim() ? session.recoveryPassphrase : undefined,
            },
        };
    }

    private exchangeForMatrixSession(jwt: string): Promise<ClarivaMatrixSessionResponse> {
        const existing = this.sessionInFlight.get(jwt);
        if (existing) return existing;
        const promise = ClarivaAuthApi.matrixSession(jwt).finally(() => this.sessionInFlight.delete(jwt));
        this.sessionInFlight.set(jwt, promise);
        return promise;
    }
}

/** Shared instance (the service is stateless apart from the single-flight map). */
export const clarivaAuth = new ClarivaAuthService();
