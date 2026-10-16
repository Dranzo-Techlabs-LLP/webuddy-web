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

import { ClarivaHttpError } from "../../src/clariva/api/http";
import { AUTH_STRINGS, ClarivaAuthError, ClarivaAuthService, mapAuthError } from "../../src/clariva/session/ClarivaAuthService";
import { ClarivaSession } from "../../src/clariva/session/ClarivaSession";
import { configureClariva, installFakeApi, mockResponse } from "./helpers";

const httpError = (status: number, serverMessage?: string): ClarivaHttpError =>
    new ClarivaHttpError(status, serverMessage ?? `HTTP ${status}`, "http", serverMessage);

describe("mapAuthError (spec 01 §3.11)", () => {
    it("prefers the server message for 400/409", () => {
        expect(mapAuthError(httpError(409, 'The username "jane" is already taken. Please choose another.')).message).toBe(
            'The username "jane" is already taken. Please choose another.',
        );
        expect(mapAuthError(httpError(400, "Password must be at least 8 characters")).message).toBe(
            "Password must be at least 8 characters",
        );
    });

    it("falls back to the Android texts", () => {
        expect(mapAuthError(httpError(400)).message).toBe(AUTH_STRINGS.badRequest);
        expect(mapAuthError(httpError(401, "Invalid email/username or password")).message).toBe(AUTH_STRINGS.unauthorized);
        expect(mapAuthError(httpError(409)).message).toBe(AUTH_STRINGS.conflict);
        expect(mapAuthError(httpError(503)).message).toBe(AUTH_STRINGS.serverTrouble);
        expect(mapAuthError(httpError(404)).message).toBe("Sign-in failed (error 404).");
    });

    it("web improvements: 429, Google 401 reason, network", () => {
        expect(mapAuthError(httpError(429, "ThrottlerException: Too Many Requests")).message).toBe(
            AUTH_STRINGS.tooManyAttempts,
        );
        expect(mapAuthError(httpError(401, "Invalid Google credentials"), "google").message).toBe(
            "Invalid Google credentials",
        );
        expect(mapAuthError(new ClarivaHttpError(0, "x", "network")).message).toBe(AUTH_STRINGS.network);
        expect(mapAuthError(new TypeError("boom")).message).toBe(AUTH_STRINGS.network);
    });

    it("deactivation messages", () => {
        expect(mapAuthError(httpError(401), "deactivate").message).toBe(AUTH_STRINGS.deactivate401);
        expect(mapAuthError(httpError(400), "deactivate").message).toBe(AUTH_STRINGS.deactivate400);
        expect(mapAuthError(httpError(500), "deactivate").message).toBe("Could not deactivate the account (error 500).");
    });
});

describe("ClarivaAuthService", () => {
    const user = { id: "u1", isConsultant: 1 as const, matrixUserId: "@jane:clarivahub.com" };
    let service: ClarivaAuthService;

    beforeEach(() => {
        configureClariva();
        ClarivaSession.resetForTests();
        service = new ClarivaAuthService();
    });

    it("sign-up always sends isConsultant (0|1), a trimmed/lower-cased handle, then exchanges the JWT once", async () => {
        const fetchMock = installFakeApi({
            "POST /v1/auth/register": () => mockResponse(201, { token: "jwt-1", user }),
            "POST /v1/auth/matrix-session": () =>
                mockResponse(200, {
                    userId: "@jane:clarivahub.com",
                    accessToken: "syt_x",
                    deviceId: "DEV1",
                    recoveryPassphrase: "p4ss",
                }),
        });

        const result = await service.signUpWithEmail({
            email: " Jane@Example.com ",
            password: "hunter22!",
            name: "  Jane Doe ",
            username: " Jane.Doe ",
            isConsultant: false,
        });

        const register = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(register).toEqual({
            email: "Jane@Example.com",
            password: "hunter22!",
            name: "Jane Doe",
            username: "jane.doe",
            isConsultant: 0, // present even though it is the default
        });
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer jwt-1");
        expect(result.credentials).toEqual({
            matrixUserId: "@jane:clarivahub.com",
            accessToken: "syt_x",
            deviceId: "DEV1",
            recoveryPassphrase: "p4ss",
        });
        expect(ClarivaSession.instance.jwt).toBe("jwt-1");
        expect(ClarivaSession.instance.isConsultantHint).toBe(true);
        // the passphrase is single-use
        expect(ClarivaSession.instance.takeRecoveryPassphrase()).toBe("p4ss");
        expect(ClarivaSession.instance.takeRecoveryPassphrase()).toBeNull();
    });

    it("treats a missing passphrase as 'history unavailable', not an error", async () => {
        installFakeApi({
            "POST /v1/auth/login": () => mockResponse(200, { token: "jwt", user }),
            "POST /v1/auth/matrix-session": () => mockResponse(200, { userId: "@j:x", accessToken: "t", deviceId: "D" }),
        });
        const { credentials } = await service.signInWithEmail("jane", "pw-pw-pw-pw");
        expect(credentials.recoveryPassphrase).toBeUndefined();
    });

    it("single-flights matrix-session (it rotates the Matrix password on every call)", async () => {
        let sessionCalls = 0;
        installFakeApi({
            "POST /v1/auth/login": () => mockResponse(200, { token: "same-jwt", user }),
            "POST /v1/auth/matrix-session": async () => {
                sessionCalls++;
                await new Promise((r) => setTimeout(r, 10));
                return mockResponse(200, { userId: "@j:x", accessToken: "t", deviceId: "D" });
            },
        });
        await Promise.all([service.signInWithEmail("jane", "pw"), service.signInWithEmail("jane", "pw")]);
        expect(sessionCalls).toBe(1);
    });

    it("maps failures to presentable errors and never leaks the JWT flow on 401", async () => {
        installFakeApi({ "POST /v1/auth/login": () => mockResponse(401, { statusCode: 401, message: "Invalid email/username or password" }) });
        await expect(service.signInWithEmail("jane", "bad")).rejects.toMatchObject({
            name: "ClarivaAuthError",
            message: AUTH_STRINGS.unauthorized,
            status: 401,
        });
    });

    describe("Google", () => {
        it("first call omits isConsultant (so a new user gets needsRole) and sends mode=signup only from sign-up", async () => {
            const fetchMock = installFakeApi({
                "POST /v1/auth/google": () => mockResponse(200, { needsRole: true, email: "a@b.c", name: "A", isExisting: false }),
            });
            const outcome = await service.signInWithGoogle({ idToken: "gid", isConsultant: null, isSignUp: true });
            expect(outcome).toEqual({ kind: "roleRequired", email: "a@b.c", name: "A", isExisting: false });
            expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ idToken: "gid", mode: "signup" });
        });

        it.each([
            [true, true],
            [false, false],
            [undefined, undefined], // an older server that does not say
            ["no", undefined], // never coerced to a boolean
            [null, undefined],
        ])(
            "needsRole with isExisting %j reaches the caller as %j (an unknown answer is not 'no account')",
            async (sent, got) => {
                installFakeApi({
                    "POST /v1/auth/google": () =>
                        mockResponse(200, { needsRole: true, email: "a@b.c", isExisting: sent }),
                });
                const outcome = await service.signInWithGoogle({ idToken: "gid", isConsultant: null });
                expect(outcome).toEqual({ kind: "roleRequired", email: "a@b.c", name: undefined, isExisting: got });
                expect((outcome as { isExisting: unknown }).isExisting).toBe(got);
            },
        );

        it("the role follow-up carries isConsultant and never re-asserts signup", async () => {
            const fetchMock = installFakeApi({
                "POST /v1/auth/google": () => mockResponse(200, { token: "jwt", user }),
                "POST /v1/auth/matrix-session": () => mockResponse(200, { userId: "@j:x", accessToken: "t", deviceId: "D" }),
            });
            const outcome = await service.signInWithGoogle({ idToken: "gid", isConsultant: true, isSignUp: true });
            expect(outcome.kind).toBe("signedIn");
            expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ idToken: "gid", isConsultant: 1 });
        });

        it("a second needsRole is an error, and a 200 without a token is an error", async () => {
            installFakeApi({ "POST /v1/auth/google": () => mockResponse(200, { needsRole: true }) });
            await expect(service.signInWithGoogle({ idToken: "g", isConsultant: false })).rejects.toThrow(
                AUTH_STRINGS.roleLoop,
            );
            installFakeApi({ "POST /v1/auth/google": () => mockResponse(200, {}) });
            await expect(service.signInWithGoogle({ idToken: "g", isConsultant: null })).rejects.toThrow(AUTH_STRINGS.noSession);
        });
    });

    it("availability checks are silent on any failure (never claim 'taken' when we could not check)", async () => {
        installFakeApi({
            "GET /v1/auth/username-available": () => mockResponse(429, { message: "ThrottlerException" }),
            "GET /v1/auth/email-available": () => mockResponse(200, { available: false, reason: "taken" }),
        });
        expect(await service.isUsernameAvailable("Jane")).toBeNull();
        expect(await service.isEmailAvailable("a@b.c")).toEqual({ available: false, reason: "taken" });
    });

    it("deactivation sends exactly one proof and an explicit eraseData", async () => {
        const fetchMock = installFakeApi({
            "POST /v1/auth/deactivate": () => mockResponse(200, { deactivated: true }),
        });
        await service.deactivateAccount({ matrixUserId: "@j:x", password: "pw", eraseData: false });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ matrixUserId: "@j:x", password: "pw", eraseData: false });

        installFakeApi({ "POST /v1/auth/deactivate": () => mockResponse(200, { deactivated: false }) });
        await expect(service.deactivateAccount({ matrixUserId: "@j:x", googleIdToken: "g", eraseData: true })).rejects.toBeInstanceOf(
            ClarivaAuthError,
        );
    });
});
