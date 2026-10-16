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

import { clarivaGet, clarivaPost, type RequestOptions } from "./http";
import {
    type ClarivaAuthResponse,
    type ClarivaAvailability,
    type ClarivaDeactivateRequest,
    type ClarivaDeactivateResponse,
    type ClarivaGoogleRequest,
    type ClarivaGoogleResponse,
    type ClarivaLoginRequest,
    type ClarivaMatrixSessionResponse,
    type ClarivaOkResponse,
    type ClarivaReauthMethod,
    type ClarivaRegisterRequest,
} from "./types";

/**
 * Android gives the Google exchange and the Matrix-session mint 60 s (read / write timeout); the flat 30 s of `http.ts`
 * is tight for them on a slow network. Both can change server-side state (a new account, a rotated Matrix password,
 * a new device), so waiting longer beats giving up early and tempting a second attempt.
 */
export const SIGN_IN_TIMEOUT_MS = 60_000;

/**
 * Thin typed wrapper over `/v1/auth/*`. No business logic here: see `ClarivaAuthService` for the sign-in
 * pipelines and error mapping.
 */
export const ClarivaAuthApi = {
    /** Email sign-up. Also provisions the Matrix account server-side. */
    register: (request: ClarivaRegisterRequest, options?: RequestOptions): Promise<ClarivaAuthResponse> =>
        clarivaPost("/v1/auth/register", request, options),

    /** Email-or-username + password. Returns a JWT; does not mint a Matrix device. */
    login: (request: ClarivaLoginRequest, options?: RequestOptions): Promise<ClarivaAuthResponse> =>
        clarivaPost("/v1/auth/login", request, options),

    /** Live handle availability while the user is typing. Unauthenticated. */
    usernameAvailable: (username: string, options?: RequestOptions): Promise<ClarivaAvailability> =>
        clarivaGet("/v1/auth/username-available", { ...options, query: { username } }),

    /** Live email availability on the sign-up form (throttled server-side). */
    emailAvailable: (email: string, options?: RequestOptions): Promise<ClarivaAvailability> =>
        clarivaGet("/v1/auth/email-available", { ...options, query: { email } }),

    /** Email a 6-digit reset code. Always `{ ok: true }` whether or not the email exists (non-enumerating). */
    forgotPassword: (email: string, options?: RequestOptions): Promise<ClarivaOkResponse> =>
        clarivaPost("/v1/auth/forgot-password", { email }, options),

    /** Complete a reset with the emailed code + a new password. */
    resetPassword: (
        request: { email: string; code: string; newPassword: string },
        options?: RequestOptions,
    ): Promise<ClarivaOkResponse> => clarivaPost("/v1/auth/reset-password", request, options),

    /**
     * Google sign-in / sign-up. Returns `needsRole: true` (and creates nothing) when a brand-new Google user has
     * not chosen a role yet; the client asks and re-posts with `isConsultant`.
     */
    google: (request: ClarivaGoogleRequest, options?: RequestOptions): Promise<ClarivaGoogleResponse> =>
        clarivaPost("/v1/auth/google", request, { timeoutMs: SIGN_IN_TIMEOUT_MS, ...options }),

    /** Password field or "Re-authorise with Google" button for deactivation? */
    reauthMethod: (matrixUserId: string, options?: RequestOptions): Promise<ClarivaReauthMethod> =>
        clarivaGet("/v1/auth/reauth-method", { ...options, query: { matrixUserId } }),

    /** Irreversible. Authorised by the proof in the body, not by a token. */
    deactivate: (request: ClarivaDeactivateRequest, options?: RequestOptions): Promise<ClarivaDeactivateResponse> =>
        clarivaPost("/v1/auth/deactivate", request, options),

    /**
     * Exchange the Clariva JWT for a Matrix session. **Mints a new device, rotates the Matrix password and
     * overwrites the display name on every call** — call it exactly once per sign-in and never retry in a loop.
     */
    matrixSession: (jwt: string, options?: RequestOptions): Promise<ClarivaMatrixSessionResponse> =>
        clarivaPost("/v1/auth/matrix-session", undefined, {
            timeoutMs: SIGN_IN_TIMEOUT_MS,
            ...options,
            headers: { ...options?.headers, Authorization: `Bearer ${jwt}` },
        }),
};
