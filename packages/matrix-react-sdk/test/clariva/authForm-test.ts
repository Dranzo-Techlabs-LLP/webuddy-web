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

import {
    type AuthFormValues,
    canDeactivate,
    canSendResetCode,
    canSubmitReset,
    emailSupportText,
    forgotPasswordPrefill,
    isUsernameWellFormed,
    looksLikeEmail,
    nameErrorText,
    normalizeUsername,
    sanitizeResetCode,
    signInFailureText,
    submitEnabled,
    usernameHardError,
    usernameSupportText,
} from "../../src/clariva/session/authForm";
import { authStrings } from "../../src/clariva/strings/auth";

const base: AuthFormValues = {
    mode: "signIn",
    email: "",
    password: "",
    name: "",
    username: "",
    usernameAvailability: "unknown",
    emailAvailability: "unknown",
    isLoading: false,
};

describe("submitEnabled (spec 01 §3.2)", () => {
    it("sign-in needs an identifier of 3+ characters and a password of 8+", () => {
        expect(submitEnabled(base)).toBe(false);
        expect(submitEnabled({ ...base, email: "jo", password: "12345678" })).toBe(false);
        expect(submitEnabled({ ...base, email: "jo.", password: "1234567" })).toBe(false);
        expect(submitEnabled({ ...base, email: "jo.", password: "12345678" })).toBe(true);
        // a username is fine, no '@' needed
        expect(submitEnabled({ ...base, email: "jane.doe", password: "12345678" })).toBe(true);
    });

    it("measures the identifier after trimming, never trims the password", () => {
        expect(submitEnabled({ ...base, email: "  ab  ", password: "12345678" })).toBe(false);
        expect(submitEnabled({ ...base, email: "abc", password: "        " })).toBe(true); // 8 spaces count
    });

    it("is off while a request is in flight", () => {
        expect(submitEnabled({ ...base, email: "jane.doe", password: "12345678", isLoading: true })).toBe(false);
    });

    const signUp: AuthFormValues = {
        ...base,
        mode: "signUp",
        email: "jane@example.com",
        password: "12345678",
        name: "Jane Doe",
        username: "Jane.Doe",
    };

    it("sign-up needs name, a well-formed username and an e-mail address", () => {
        expect(submitEnabled(signUp)).toBe(true);
        expect(submitEnabled({ ...signUp, name: "J" })).toBe(false);
        expect(submitEnabled({ ...signUp, name: "  J " })).toBe(false);
        expect(submitEnabled({ ...signUp, username: "" })).toBe(false);
        expect(submitEnabled({ ...signUp, username: "ab" })).toBe(false);
        expect(submitEnabled({ ...signUp, username: "_jane" })).toBe(false);
        expect(submitEnabled({ ...signUp, email: "jane" })).toBe(false);
        expect(submitEnabled({ ...signUp, email: "a@b." })).toBe(false); // 4 chars
        expect(submitEnabled({ ...signUp, password: "1234567" })).toBe(false);
    });

    it("only 'taken' blocks; unknown and checking never do", () => {
        expect(submitEnabled({ ...signUp, usernameAvailability: "taken" })).toBe(false);
        expect(submitEnabled({ ...signUp, emailAvailability: "taken" })).toBe(false);
        for (const state of ["unknown", "checking", "available"] as const) {
            expect(submitEnabled({ ...signUp, usernameAvailability: state, emailAvailability: state })).toBe(true);
        }
    });

    it("a consultant's payout setup must be ready (skipped, empty or valid); a client's is never consulted", () => {
        expect(submitEnabled({ ...signUp, isConsultant: true, consultantSetupReady: true })).toBe(true);
        expect(submitEnabled({ ...signUp, isConsultant: true, consultantSetupReady: false })).toBe(false);
        expect(submitEnabled({ ...signUp, isConsultant: true })).toBe(true); // omitted means ready
        expect(submitEnabled({ ...signUp, isConsultant: false, consultantSetupReady: false })).toBe(true);
        // sign-in has no setup at all
        expect(
            submitEnabled({
                ...base,
                email: "jane.doe",
                password: "12345678",
                isConsultant: true,
                consultantSetupReady: false,
            }),
        ).toBe(true);
    });
});

describe("username rules (spec 01 §3.1)", () => {
    it("normalises to trimmed lower case", () => {
        expect(normalizeUsername("  Jane.Doe ")).toBe("jane.doe");
    });

    it("accepts 3-30 chars, alphanumeric first, then a-z 0-9 . _ -", () => {
        for (const ok of ["abc", "a.b", "j_d-1", "1abc", "a".repeat(30), "Jane.Doe"]) {
            expect(isUsernameWellFormed(ok)).toBe(true);
        }
        for (const bad of ["", "ab", ".abc", "-abc", "_abc", "a b c", "ab@c", "a".repeat(31), "jané"]) {
            expect(isUsernameWellFormed(bad)).toBe(false);
        }
    });

    it("reports hard errors in Android's order, only for non-empty input", () => {
        expect(usernameHardError("", "unknown")).toBeNull();
        expect(usernameHardError("ab", "unknown")).toBe(authStrings.usernameTooShort);
        expect(usernameHardError("a".repeat(31), "unknown")).toBe(authStrings.usernameTooLong);
        expect(usernameHardError("a b c", "unknown")).toBe(authStrings.usernameInvalid);
        expect(usernameHardError("abc", "taken")).toBe(authStrings.usernameTaken);
        expect(usernameHardError("abc", "taken", "That username is not available")).toBe(
            "That username is not available",
        );
        expect(usernameHardError("abc", "available")).toBeNull();
    });

    it("resolves the support line: error > checking > available > preview > help", () => {
        const s = "clarivahub.com";
        expect(usernameSupportText("", "unknown", s)).toEqual({ kind: "help", text: authStrings.usernameHelp });
        expect(usernameSupportText("Jane", "unknown", s)).toEqual({
            kind: "preview",
            text: "You will be @jane:clarivahub.com",
        });
        expect(usernameSupportText("jane", "checking", s).kind).toBe("checking");
        expect(usernameSupportText("jane", "available", s)).toEqual({
            kind: "available",
            text: "Available — you will be @jane:clarivahub.com",
        });
        expect(usernameSupportText("jane", "taken", s).kind).toBe("error");
        expect(usernameSupportText("ab", "checking", s).kind).toBe("error");
    });
});

describe("other field helpers", () => {
    it("e-mail looks like an address: '@' and at least 5 chars after trimming", () => {
        expect(looksLikeEmail("a@b.c")).toBe(true);
        expect(looksLikeEmail(" a@b.c ")).toBe(true);
        expect(looksLikeEmail("a@b.")).toBe(false);
        expect(looksLikeEmail("abcdef")).toBe(false);
    });

    it("name error only appears once something was typed", () => {
        expect(nameErrorText("")).toBeNull();
        expect(nameErrorText(" J ")).toBe(authStrings.nameError);
        expect(nameErrorText("Jo")).toBeNull();
    });

    it("e-mail availability text", () => {
        expect(emailSupportText("unknown")).toBeNull();
        expect(emailSupportText("checking")?.text).toBe("Checking availability…");
        expect(emailSupportText("available")?.text).toBe("Email is available");
        expect(emailSupportText("taken")).toEqual({
            kind: "error",
            text: "That email is already registered. Sign in instead.",
        });
    });

    it("401 on a password sign-in gets the Google hint, nothing else does", () => {
        expect(signInFailureText("Incorrect email or password.", 401, true)).toBe(
            `Incorrect email or password.\n${authStrings.googleAccountHint}`,
        );
        expect(signInFailureText("Incorrect email or password.", 401, false)).toBe("Incorrect email or password.");
        expect(signInFailureText("boom", 500, true)).toBe("boom");
    });

    describe("googleAvailable (4th parameter): never point at a Google button that is not there", () => {
        const message = "Incorrect email or password.";

        it("defaults to available, so the existing three-argument calls keep their behaviour", () => {
            expect(signInFailureText(message, 401, true)).toBe(`${message}
${authStrings.googleAccountHint}`);
            expect(signInFailureText(message, 401, true, true)).toBe(`${message}
${authStrings.googleAccountHint}`);
        });

        it("when Google is not available a 401 says so instead of pointing at the button", () => {
            const shown = signInFailureText(message, 401, true, false);
            expect(shown).toBe(`${message}
${authStrings.googleAccountHintUnavailable}`);
            expect(shown).not.toContain(authStrings.googleAccountHint);
            expect(authStrings.googleAccountHintUnavailable).toMatch(/isn't available/);
        });

        it("the unavailable hint is true whether Google is unconfigured or failed, and points at the Clariva app", () => {
            // no "right now" / "try again later": an unconfigured deployment will not recover by waiting
            expect(authStrings.googleAccountHintUnavailable).toBe(
                "Signed up with Google? Google sign-in isn't available on this page. Use the Clariva app instead.",
            );
            expect(authStrings.googleAccountHintUnavailable).not.toMatch(/right now|later/i);
        });

        it("only a 401 on a PASSWORD sign-in gets any hint, whatever the Google state", () => {
            for (const googleAvailable of [true, false]) {
                expect(signInFailureText("boom", 500, true, googleAvailable)).toBe("boom");
                expect(signInFailureText("boom", 429, true, googleAvailable)).toBe("boom");
                expect(signInFailureText("boom", undefined, true, googleAvailable)).toBe("boom");
                expect(signInFailureText(message, 401, false, googleAvailable)).toBe(message);
            }
        });
    });
});

describe("authStrings", () => {
    it("no longer carries the dead Google strings", () => {
        for (const dead of ["googleNotConfigured", "googleNotConfiguredBuild", "googleNoToken", "googleFailed"]) {
            expect(authStrings).not.toHaveProperty(dead);
        }
    });

    it("the role copy no longer promises a Settings option that does not exist on web or Android", () => {
        const copy = [authStrings.googleRoleSubtitle, authStrings.googleRoleSubtitleWithEmail("j@gmail.com")];
        for (const text of copy) expect(text).not.toMatch(/changed later|Settings/i);
        expect(authStrings.googleRoleSubtitleWithEmail("j@gmail.com")).toContain("j@gmail.com");
    });

    it("the sign-in fallback does not promise a password to somebody who only has Google", () => {
        const text = authStrings.googleUnavailableFallbackSignIn;
        expect(text).toBe(
            "You can still sign in with your email or username and password. Signed up with Google? Try again in a moment, or use the Clariva app.",
        );
        expect(text).toMatch(/Signed up with Google\?/);
        expect(text).toMatch(/Clariva app/);
        // sign-up has no such caveat: a brand-new account always has a password to choose
        expect(authStrings.googleUnavailableFallbackSignUp).toBe(
            "You can still create an account with your email and password.",
        );
    });

    it("deactivate copy: the not-configured sentence has no retry, the retry sentence follows a failure reason", () => {
        expect(authStrings.deactivateGoogleUnavailable).toBe(
            "This account can only be deactivated by re-authorising with Google, which isn't set up on this site. Use the Clariva app.",
        );
        expect(authStrings.deactivateGoogleUnavailableRetry).toBe(
            "You can try again, or deactivate your account from the Clariva app.",
        );
        // neither repeats the notice title that sits above it, and the "can't be deactivated" claim is gone
        for (const text of [authStrings.deactivateGoogleUnavailable, authStrings.deactivateGoogleUnavailableRetry]) {
            expect(text).not.toContain(authStrings.googleUnavailableTitle);
            expect(text).not.toMatch(/can't be deactivated from the web/);
        }
        expect(authStrings.deactivateGoogleUnavailable).not.toMatch(/try again/i);
    });

    it("forgot-password hint: one variant points at Sign in with Google, the other does not", () => {
        expect(authStrings.forgotGoogleHint).toBe(
            "Signed up with Google? Google accounts have no password, so no code is sent. Cancel and use Sign in with Google.",
        );
        expect(authStrings.forgotGoogleHintUnavailable).toBe(
            "Signed up with Google? Google accounts have no password, so no code is sent. Google sign-in isn't available on this page, so cancel and use the Clariva app instead.",
        );
        // true whether Google is unconfigured or failed to load: never promises that waiting will help
        expect(authStrings.forgotGoogleHintUnavailable).not.toMatch(/later/i);
    });

    it("the Google button's loading text is a plain muted status", () => {
        expect(authStrings.googleLoading).toBe("Connecting to Google…");
    });

    it("'no account' notice names the address, or says 'this Google account' when the server sent none", () => {
        expect(authStrings.googleNoAccountNotice("j@gmail.com")).toBe(
            "No Clariva account exists for j@gmail.com. Continue to create one, or Cancel and pick another Google account.",
        );
        expect(authStrings.googleNoAccountNotice()).toContain("No Clariva account exists for this Google account.");
        expect(authStrings.googleNoAccountNotice("")).toContain("this Google account");
    });
});

describe("forgot password (spec 01 §2.3)", () => {
    it("prefills the dialog from the sign-in field only when it holds an e-mail", () => {
        expect(forgotPasswordPrefill(" jane@example.com ")).toBe("jane@example.com");
        expect(forgotPasswordPrefill("jane.doe")).toBe("");
    });

    it("'Send code' needs an address and no request in flight", () => {
        expect(canSendResetCode("jane@example.com", false)).toBe(true);
        expect(canSendResetCode("jane@example.com", true)).toBe(false);
        expect(canSendResetCode("a@b", false)).toBe(false);
    });

    it("the code field keeps digits only, at most six", () => {
        expect(sanitizeResetCode("12a3 45-678")).toBe("123456");
        expect(sanitizeResetCode("abc")).toBe("");
    });

    it("'Reset password' needs exactly six digits and a password of 8+", () => {
        expect(canSubmitReset("123456", "12345678", false)).toBe(true);
        expect(canSubmitReset("12345", "12345678", false)).toBe(false);
        expect(canSubmitReset("12345a", "12345678", false)).toBe(false);
        expect(canSubmitReset("123456", "1234567", false)).toBe(false);
        expect(canSubmitReset("123456", "12345678", true)).toBe(false);
    });
});

describe("deactivate (spec 01 §2.8)", () => {
    const inputs = { isGoogleAccount: false, googleAuthorized: false, password: "", inProgress: false };

    it("an unknown account type disables the button", () => {
        expect(canDeactivate({ ...inputs, isGoogleAccount: null, password: "x" })).toBe(false);
    });

    it("email accounts need a password, Google accounts need the fresh token", () => {
        expect(canDeactivate({ ...inputs, password: "" })).toBe(false);
        expect(canDeactivate({ ...inputs, password: "x" })).toBe(true);
        expect(canDeactivate({ ...inputs, isGoogleAccount: true })).toBe(false);
        expect(canDeactivate({ ...inputs, isGoogleAccount: true, googleAuthorized: true })).toBe(true);
    });

    it("is off while the request runs", () => {
        expect(canDeactivate({ ...inputs, password: "x", inProgress: true })).toBe(false);
    });
});
