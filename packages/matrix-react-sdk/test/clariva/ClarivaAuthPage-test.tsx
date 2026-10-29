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

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { logger } from "matrix-js-sdk/src/logger";

import Modal from "../../src/Modal";
import PlatformPeg from "../../src/PlatformPeg";
import SdkConfig from "../../src/SdkConfig";
import ErrorDialog from "../../src/components/views/dialogs/ErrorDialog";
import { ClarivaAuthPage } from "../../src/clariva/components/auth/ClarivaAuthPage";
import { ClarivaForgotPasswordDialog } from "../../src/clariva/components/auth/ClarivaForgotPasswordDialog";
import { ClarivaGoogleRoleDialog } from "../../src/clariva/components/auth/ClarivaGoogleRoleDialog";
import { ClarivaHttpError } from "../../src/clariva/api/http";
import { ClarivaWalletApi } from "../../src/clariva/api/wallet";
import { AUTH_STRINGS, ClarivaAuthError, clarivaAuth } from "../../src/clariva/session/ClarivaAuthService";
import { ClarivaSession } from "../../src/clariva/session/ClarivaSession";
import { EMPTY_CONSULTANT_SETUP } from "../../src/clariva/session/consultantSetup";
import { authStrings } from "../../src/clariva/strings/auth";
import { configureClariva } from "./helpers";

// Google Identity Services cannot load in jsdom: capture the callback the page registers instead. The mock decides how
// every render ends (drew fine / drew nothing / rejected), whether Google is configured, and which origin the page is on;
// the origin helpers and the error class stay REAL (the page does `instanceof` on the error).
interface MockGoogleOptions {
    text: string;
    onCredential: (token: string) => void;
}
type MockGoogleReason = "script_blocked" | "script_timeout" | "render_failed";
type MockGoogleOutcome = { ok: true } | { ok: false; reason: MockGoogleReason };
type MockGoogleBehaviour =
    | { kind: "ok" }
    | { kind: "notDrawn"; reason: MockGoogleReason }
    | { kind: "reject"; reason: MockGoogleReason }
    // the render resolves but Google "has not drawn yet": the test settles it by hand through mockGoogleSettle
    | { kind: "manual" };
let mockGoogleOptions: MockGoogleOptions | undefined;
let mockGoogleRenders: { options: MockGoogleOptions; dispose: jest.Mock }[] = [];
let mockGoogleBehaviour: MockGoogleBehaviour = { kind: "ok" };
let mockGoogleSettle: ((outcome: MockGoogleOutcome) => void) | undefined;
let mockGoogleConfigured = true;
let mockOrigin = "https://web.clarivahub.com";
jest.mock("../../src/clariva/session/googleIdentity", () => {
    const actual = jest.requireActual("../../src/clariva/session/googleIdentity");
    return {
        ...actual, // GoogleUnavailableError, isDevOrigin, originsToAuthorise: the real ones
        isGoogleSignInConfigured: () => mockGoogleConfigured,
        currentOrigin: () => mockOrigin,
        renderGoogleButton: async (_container: HTMLElement, options: MockGoogleOptions) => {
            mockGoogleOptions = options;
            const dispose = jest.fn();
            mockGoogleRenders.push({ options, dispose });
            if (mockGoogleBehaviour.kind === "reject") {
                throw new actual.GoogleUnavailableError(mockGoogleBehaviour.reason);
            }
            if (mockGoogleBehaviour.kind === "manual") {
                const pending = new Promise<MockGoogleOutcome>((resolve) => {
                    mockGoogleSettle = resolve;
                });
                return { dispose, ready: pending };
            }
            const ready =
                mockGoogleBehaviour.kind === "notDrawn"
                    ? { ok: false, reason: mockGoogleBehaviour.reason }
                    : { ok: true };
            return { dispose, ready: Promise.resolve(ready) };
        },
    };
});

const serverConfig = { hsUrl: "https://matrix.clarivahub.com", isUrl: "", hsName: "clarivahub.com" };
const credentials = {
    matrixUserId: "@jane:clarivahub.com",
    accessToken: "syt_secret",
    deviceId: "DEV1",
    recoveryPassphrase: "p4ss",
};
const signedIn = { credentials, user: { id: "u1", isConsultant: 0 as const } };

const byId = (id: string): HTMLInputElement => screen.getByTestId(id) as HTMLInputElement;
// Compound buttons expose "disabled" as aria-disabled (so they stay keyboard-discoverable), not as the attribute
const submitButton = (): HTMLButtonElement => screen.getByTestId("clariva-auth-submit") as HTMLButtonElement;

describe("ClarivaAuthPage", () => {
    let onLoggedIn: jest.Mock;
    let createDialog: jest.SpyInstance;

    const renderPage = (props: Partial<React.ComponentProps<typeof ClarivaAuthPage>> = {}) =>
        render(<ClarivaAuthPage serverConfig={serverConfig} onLoggedIn={onLoggedIn} {...props} />);

    beforeEach(() => {
        configureClariva({ google_client_id: "client-id.apps.googleusercontent.com" });
        ClarivaSession.resetForTests();
        mockGoogleOptions = undefined;
        mockGoogleRenders = [];
        mockGoogleBehaviour = { kind: "ok" };
        mockGoogleSettle = undefined;
        mockGoogleConfigured = true;
        mockOrigin = "https://web.clarivahub.com";
        onLoggedIn = jest.fn().mockResolvedValue(undefined);
        createDialog = jest
            .spyOn(Modal, "createDialog")
            .mockImplementation((() => ({ finished: new Promise(() => {}), close: jest.fn() })) as never);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it("starts in sign-in mode with the Android copy", () => {
        renderPage();
        expect(screen.getByRole("heading", { name: "Welcome to Clariva" })).toBeInTheDocument();
        expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
        expect(screen.getByLabelText("Password")).toBeInTheDocument();
        expect(screen.getByText("Forgot password?")).toBeInTheDocument();
        expect(screen.getByText("New to Clariva? Create an account")).toBeInTheDocument();
        expect(submitButton()).toHaveTextContent("Sign in");
        expect(screen.queryByLabelText("Name")).toBeNull();
    });

    it("has the web a11y attributes on the identifier field", () => {
        renderPage();
        const identifier = screen.getByLabelText("Email or username");
        expect(identifier).toHaveAttribute("autocomplete", "username");
        expect(identifier).toHaveAttribute("autocapitalize", "none");
        expect(identifier).toHaveAttribute("spellcheck", "false");
        expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
        expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
    });

    it("shows the Privacy and Terms links from branding.auth_footer_links (new tab, no opener)", () => {
        SdkConfig.add({
            branding: {
                // eslint-disable-next-line camelcase
                auth_footer_links: [
                    { text: "Privacy", url: "https://clarivahub.com/privacy.html" },
                    { text: "Terms", url: "https://clarivahub.com/terms.html" },
                    // eslint-disable-next-line no-script-url
                    { text: "Bad scheme", url: "javascript:alert(1)" }, // never rendered
                ],
            },
        });
        renderPage();
        const nav = screen.getByRole("navigation", { name: "Legal" });
        const links = within(nav).getAllByRole("link");
        expect(links.map((a) => a.textContent)).toEqual(["Privacy", "Terms"]);
        expect(links[0]).toHaveAttribute("href", "https://clarivahub.com/privacy.html");
        expect(links[0]).toHaveAttribute("target", "_blank");
        expect(links[0].getAttribute("rel")).toContain("noopener");
    });

    it("has no Legal navigation when no footer links are configured", () => {
        renderPage();
        expect(screen.queryByRole("navigation", { name: "Legal" })).toBeNull();
    });

    it("hides 'Version !!UNSET!!' (the dev-build placeholder) but shows a real version", async () => {
        const platform = jest.spyOn(PlatformPeg, "get");
        platform.mockReturnValue({ getAppVersion: async () => "!!UNSET!!" } as never);
        const { unmount } = renderPage();
        await act(async () => {});
        expect(screen.queryByText(/Version/)).toBeNull();
        unmount();

        platform.mockReturnValue({ getAppVersion: async () => "1.11.76" } as never);
        renderPage();
        expect(await screen.findByText("Version 1.11.76")).toBeInTheDocument();
    });

    it("password eye: a labelled toggle that flips the field type", async () => {
        const user = userEvent.setup();
        renderPage();
        const eye = screen.getByRole("button", { name: "Show password" });
        expect(eye).toHaveAttribute("aria-pressed", "false");
        expect(byId("clariva-auth-password")).toHaveAttribute("type", "password");
        await user.click(eye);
        expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
        expect(byId("clariva-auth-password")).toHaveAttribute("type", "text");
    });

    it("every field row opts out of the stock dialog text-input styling (mx_no_textinput)", () => {
        renderPage();
        expect(byId("clariva-auth-email").parentElement).toHaveClass("mx_no_textinput");
        expect(byId("clariva-auth-password").parentElement).toHaveClass("mx_no_textinput");
    });

    it("disables sign-in until identifier >= 3 and password >= 8, and Enter obeys the same rule", async () => {
        const user = userEvent.setup();
        const signIn = jest.spyOn(clarivaAuth, "signInWithEmail").mockResolvedValue(signedIn);
        renderPage();

        expect(submitButton()).toHaveAttribute("aria-disabled", "true");
        await user.type(byId("clariva-auth-email"), "ja");
        await user.type(byId("clariva-auth-password"), "12345678{Enter}");
        expect(submitButton()).toHaveAttribute("aria-disabled", "true"); // identifier still too short
        expect(signIn).not.toHaveBeenCalled();

        await user.type(byId("clariva-auth-email"), "ne");
        expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
    });

    it("signs in and hands the session to Element: no password, no JWT left behind", async () => {
        const user = userEvent.setup();
        const signIn = jest.spyOn(clarivaAuth, "signInWithEmail").mockImplementation(async () => {
            ClarivaSession.instance.setAuthenticated("jwt", signedIn.user);
            return signedIn;
        });
        renderPage();

        await user.type(byId("clariva-auth-email"), "jane.doe");
        await user.type(byId("clariva-auth-password"), "hunter2hunter2{Enter}");

        await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
        expect(signIn).toHaveBeenCalledWith("jane.doe", "hunter2hunter2");
        expect(onLoggedIn).toHaveBeenCalledWith(
            {
                homeserverUrl: "https://matrix.clarivahub.com",
                identityServerUrl: undefined,
                userId: "@jane:clarivahub.com",
                deviceId: "DEV1",
                accessToken: "syt_secret",
                guest: false,
            },
            "", // the Matrix password does not exist on the client
        );
        expect(ClarivaSession.instance.jwt).toBeNull();
    });

    it("shows the 'Sign-in failed' dialog (with the Google hint on a 401) and keeps the form", async () => {
        const user = userEvent.setup();
        jest.spyOn(clarivaAuth, "signInWithEmail").mockRejectedValue(
            new ClarivaAuthError("Incorrect email or password.", 401),
        );
        renderPage();

        await user.type(byId("clariva-auth-email"), "jane.doe");
        await user.type(byId("clariva-auth-password"), "wrong-password");
        await user.click(submitButton());

        await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
        const props = createDialog.mock.calls[0][1];
        expect(props.title).toBe("Sign-in failed");
        const { container } = render(<>{props.description}</>);
        expect(container.textContent).toBe(`Incorrect email or password.\n${authStrings.googleAccountHint}`);
        expect(onLoggedIn).not.toHaveBeenCalled();
        expect(byId("clariva-auth-email").value).toBe("jane.doe");
        expect(byId("clariva-auth-password").value).toBe("wrong-password");
        await waitFor(() => expect(submitButton()).not.toHaveAttribute("aria-disabled", "true"));
    });

    describe("sign-up", () => {
        const fill = (fields: Record<string, string>): void => {
            for (const [id, value] of Object.entries(fields)) fireEvent.change(byId(id), { target: { value } });
        };

        it("toggles, keeps the typed values and validates name / username / e-mail / password", () => {
            renderPage();
            fill({ "clariva-auth-email": "jane@example.com", "clariva-auth-password": "12345678" });
            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));

            expect(submitButton()).toHaveTextContent("Create account");
            expect(byId("clariva-auth-email").value).toBe("jane@example.com"); // shared field survives the toggle
            expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
            expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
            expect(screen.getByText("I am a consultant")).toBeInTheDocument();
            expect(screen.getByText(authStrings.usernameHelp)).toBeInTheDocument();
            expect(submitButton()).toHaveAttribute("aria-disabled", "true");

            fill({ "clariva-auth-name": "J" });
            expect(screen.getByText("Please enter your name")).toBeInTheDocument();
            fill({ "clariva-auth-name": "Jane Doe", "clariva-auth-username": "ab" });
            expect(screen.getByText("At least 3 characters")).toBeInTheDocument();
            expect(submitButton()).toHaveAttribute("aria-disabled", "true");
            fill({ "clariva-auth-username": "Jane.Doe" });
            // a well-formed handle is being checked (debounced), so "Checking availability…" wins over the preview
            expect(screen.getByTestId("clariva-auth-username-support")).toHaveTextContent("Checking availability…");
            expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
        });

        it("checks availability after 450 ms, cancels stale checks, and 'taken' blocks submit", async () => {
            jest.useFakeTimers();
            const usernameCheck = jest
                .spyOn(clarivaAuth, "isUsernameAvailable")
                .mockResolvedValue({ available: false, reason: "That username is already taken" });
            const emailCheck = jest.spyOn(clarivaAuth, "isEmailAvailable").mockResolvedValue({ available: true });
            renderPage({ initialMode: "signUp" });
            fill({
                "clariva-auth-name": "Jane Doe",
                "clariva-auth-email": "jane@example.com",
                "clariva-auth-password": "12345678",
                "clariva-auth-username": "jane",
            });
            expect(
                screen.getByText("Checking availability…", { selector: "#mx_ClarivaAuth_username-support" }),
            ).toBeInTheDocument();
            expect(usernameCheck).not.toHaveBeenCalled();

            // typing again restarts the debounce: the first value is never queried
            act(() => {
                jest.advanceTimersByTime(300);
            });
            fill({ "clariva-auth-username": "jane2" });
            act(() => {
                jest.advanceTimersByTime(300);
            });
            expect(usernameCheck).not.toHaveBeenCalled();
            await act(async () => {
                jest.advanceTimersByTime(200);
            });
            expect(usernameCheck).toHaveBeenCalledTimes(1);
            expect(usernameCheck.mock.calls[0][0]).toBe("jane2");
            expect(emailCheck).toHaveBeenCalledWith("jane@example.com", expect.anything());

            expect(screen.getByText("That username is already taken")).toBeInTheDocument();
            expect(screen.getByText("Email is available")).toBeInTheDocument();
            expect(submitButton()).toHaveAttribute("aria-disabled", "true");

            // a different username is not blocked by the previous answer
            fill({ "clariva-auth-username": "jane3" });
            expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
        });

        it("a failed availability check is silent (never claims 'taken')", async () => {
            jest.useFakeTimers();
            jest.spyOn(clarivaAuth, "isUsernameAvailable").mockResolvedValue(null);
            jest.spyOn(clarivaAuth, "isEmailAvailable").mockResolvedValue(null);
            renderPage({ initialMode: "signUp" });
            fill({
                "clariva-auth-name": "Jane Doe",
                "clariva-auth-email": "jane@example.com",
                "clariva-auth-password": "12345678",
                "clariva-auth-username": "jane",
            });
            await act(async () => {
                jest.advanceTimersByTime(500);
            });
            expect(screen.queryByText("That username is already taken")).toBeNull();
            expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
        });

        it("always sends isConsultant 0|1 and a normalised handle", async () => {
            const signUp = jest.spyOn(clarivaAuth, "signUpWithEmail").mockResolvedValue(signedIn);
            jest.spyOn(clarivaAuth, "isUsernameAvailable").mockResolvedValue({ available: true });
            jest.spyOn(clarivaAuth, "isEmailAvailable").mockResolvedValue({ available: true });
            renderPage({ initialMode: "signUp" });
            fill({
                "clariva-auth-name": " Jane Doe ",
                "clariva-auth-email": "jane@example.com",
                "clariva-auth-password": "12345678",
                "clariva-auth-username": " Jane.Doe ",
            });
            fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
            fireEvent.click(submitButton());

            await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
            expect(signUp).toHaveBeenCalledWith({
                email: "jane@example.com",
                password: "12345678",
                name: " Jane Doe ",
                username: "jane.doe",
                isConsultant: true,
            });
        });

        it("account created but session failed: switches to sign-in with the e-mail prefilled", async () => {
            jest.spyOn(clarivaAuth, "isUsernameAvailable").mockResolvedValue({ available: true });
            jest.spyOn(clarivaAuth, "isEmailAvailable").mockResolvedValue({ available: true });
            jest.spyOn(clarivaAuth, "signUpWithEmail").mockImplementation(async () => {
                ClarivaSession.instance.setAuthenticated("jwt", signedIn.user); // step one worked
                throw new ClarivaAuthError("Clariva is having trouble right now. Please try again shortly.", 503);
            });
            renderPage({ initialMode: "signUp" });
            fill({
                "clariva-auth-name": "Jane Doe",
                "clariva-auth-email": "jane@example.com",
                "clariva-auth-password": "12345678",
                "clariva-auth-username": "jane",
            });
            fireEvent.click(submitButton());

            await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
            expect(createDialog.mock.calls[0][1].title).toBe("Sign-in failed");
            await waitFor(() => expect(submitButton()).toHaveTextContent("Sign in"));
            expect(byId("clariva-auth-email").value).toBe("jane@example.com");
        });
    });

    describe("Google", () => {
        it("renders the official button with 'Sign in with Google' / 'Sign up with Google' text per mode", async () => {
            renderPage();
            await waitFor(() => expect(mockGoogleOptions?.text).toBe("signin_with"));
            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));
            await waitFor(() => expect(mockGoogleOptions?.text).toBe("signup_with"));
        });

        it("two-step role flow from sign-in: asks, then repeats WITHOUT mode, then signs in", async () => {
            const google = jest
                .spyOn(clarivaAuth, "signInWithGoogle")
                .mockResolvedValueOnce({
                    kind: "roleRequired",
                    email: "j@gmail.com",
                    name: undefined,
                    isExisting: false,
                })
                .mockResolvedValueOnce({ kind: "signedIn", ...signedIn });
            createDialog.mockImplementation(() => ({ finished: Promise.resolve([true, true]), close: jest.fn() }));
            renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());

            await act(async () => {
                mockGoogleOptions!.onCredential("google-id-token");
            });

            await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
            expect(google).toHaveBeenNthCalledWith(1, {
                idToken: "google-id-token",
                isConsultant: null,
                isSignUp: false,
            });
            expect(google).toHaveBeenNthCalledWith(2, { idToken: "google-id-token", isConsultant: true });
            const [dialog, props, , , , options] = createDialog.mock.calls[0];
            expect(dialog).toBe(ClarivaGoogleRoleDialog);
            // the dialog is told where the flow started and what the server answered (CHANGED: it used to get the email only)
            expect(props).toEqual({
                email: "j@gmail.com",
                fromSignIn: true,
                isExisting: false,
                initialSetup: EMPTY_CONSULTANT_SETUP,
            });
            // not dismissible by an outside click
            await expect(options.onBeforeClose("backgroundClick")).resolves.toBe(false);
            await expect(options.onBeforeClose(undefined)).resolves.toBe(true);
        });

        it("Google consultant: the payout step is saved with the sign-in JWT after the account exists", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle")
                .mockResolvedValueOnce({ kind: "roleRequired", email: "j@gmail.com", name: "J", isExisting: false })
                .mockImplementationOnce(async () => {
                    ClarivaSession.instance.setAuthenticated("jwt-google", signedIn.user);
                    return { kind: "signedIn", ...signedIn };
                });
            const updateUser = jest.spyOn(ClarivaWalletApi, "updateUser").mockResolvedValue({} as never);
            const saveBank = jest.spyOn(ClarivaWalletApi, "saveMyBankDetails").mockResolvedValue({} as never);
            const payoutSetup = {
                ...EMPTY_CONSULTANT_SETUP,
                maxCredits: "40",
                accountHolderName: "Jane",
                bankName: "SBI",
                accountNumber: "123456789012",
                ifscCode: "SBIN0001234",
            };
            createDialog.mockImplementation(() => ({
                finished: Promise.resolve([true, true, payoutSetup]),
                close: jest.fn(),
            }));
            renderPage({ initialMode: "signUp" });
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {
                mockGoogleOptions!.onCredential("t");
            });
            await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
            expect(updateUser).toHaveBeenCalledWith("@jane:clarivahub.com", { max_credits: 40 }, { timeoutMs: 10_000 });
            expect(saveBank).toHaveBeenCalledWith(
                "jwt-google",
                expect.objectContaining({ ifscCode: "SBIN0001234", accountNumber: "123456789012" }),
                { timeoutMs: 10_000 },
            );
        });

        it("Google consultant: opening the session fails after the save started, so the dialog says what was not saved", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle")
                .mockResolvedValueOnce({ kind: "roleRequired", email: "j@gmail.com", name: "J", isExisting: false })
                .mockImplementationOnce(async () => {
                    ClarivaSession.instance.setAuthenticated("jwt-google", signedIn.user);
                    return { kind: "signedIn", ...signedIn };
                });
            jest.spyOn(ClarivaWalletApi, "updateUser").mockRejectedValue(new Error("offline"));
            onLoggedIn.mockRejectedValue(new Error("Could not start the client"));
            createDialog.mockImplementation((dialog: unknown) => ({
                finished:
                    dialog === ClarivaGoogleRoleDialog
                        ? Promise.resolve([true, true, { ...EMPTY_CONSULTANT_SETUP, maxCredits: "40" }])
                        : new Promise(() => {}),
                close: jest.fn(),
            }));
            renderPage({ initialMode: "signUp" });
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {
                mockGoogleOptions!.onCredential("t");
            });
            await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
            const errorCall = createDialog.mock.calls.find(([dialog]) => dialog === ErrorDialog)!;
            const { container } = render(<>{errorCall[1].description}</>);
            expect(container.textContent).toContain("Could not start the client");
            expect(container.textContent).toContain(
                "Account created, but your chat rate wasn't saved. Set it in Settings › Billing and payments.",
            );
        });

        it("Google consultant who skipped the payout step: nothing is saved", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle")
                .mockResolvedValueOnce({ kind: "roleRequired", email: "j@gmail.com", name: "J", isExisting: false })
                .mockResolvedValueOnce({ kind: "signedIn", ...signedIn });
            const updateUser = jest.spyOn(ClarivaWalletApi, "updateUser");
            const saveBank = jest.spyOn(ClarivaWalletApi, "saveMyBankDetails");
            createDialog.mockImplementation(() => ({
                finished: Promise.resolve([true, true, null]),
                close: jest.fn(),
            }));
            renderPage({ initialMode: "signUp" });
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {
                mockGoogleOptions!.onCredential("t");
            });
            await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
            expect(updateUser).not.toHaveBeenCalled();
            expect(saveBank).not.toHaveBeenCalled();
        });

        it("from the sign-up page the first call carries mode signup (via isSignUp), the follow-up does not", async () => {
            const google = jest
                .spyOn(clarivaAuth, "signInWithGoogle")
                .mockResolvedValueOnce({ kind: "roleRequired", email: undefined, name: undefined, isExisting: false })
                .mockResolvedValueOnce({ kind: "signedIn", ...signedIn });
            createDialog.mockImplementation(() => ({ finished: Promise.resolve([true, false]), close: jest.fn() }));
            renderPage({ initialMode: "signUp" });
            await waitFor(() => expect(mockGoogleOptions?.text).toBe("signup_with"));
            await act(async () => {
                mockGoogleOptions!.onCredential("t");
            });
            await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
            expect(google).toHaveBeenNthCalledWith(1, { idToken: "t", isConsultant: null, isSignUp: true });
            expect(google).toHaveBeenNthCalledWith(2, { idToken: "t", isConsultant: false });
        });

        it("cancelling the role dialog abandons the attempt and releases the form", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle").mockResolvedValue({
                kind: "roleRequired",
                email: undefined,
                name: undefined,
                isExisting: false,
            });
            createDialog.mockImplementation(() => ({ finished: Promise.resolve([false]), close: jest.fn() }));
            renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {
                mockGoogleOptions!.onCredential("t");
            });
            expect(onLoggedIn).not.toHaveBeenCalled();
            await waitFor(() => expect(screen.getByTestId("clariva-auth-toggle-mode")).toBeEnabled());
        });

        it("shows the server's reason for a rejected Google token", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle").mockRejectedValue(
                new ClarivaAuthError("Invalid Google credentials", 401),
            );
            renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {
                mockGoogleOptions!.onCredential("t");
            });
            await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
            const { container } = render(<>{createDialog.mock.calls[0][1].description}</>);
            expect(container.textContent).toBe("Invalid Google credentials");
        });
    });

    describe("Google mode is the one of the button that was PRESSED, not of the page when the answer arrives", () => {
        const toggle = (): void => {
            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));
        };
        const roleRequired = {
            kind: "roleRequired",
            email: "new@gmail.com",
            name: undefined,
            isExisting: false,
        } as const;

        it("Sign in pressed, page toggled to Sign up while the chooser was open: still a sign-IN", async () => {
            const google = jest.spyOn(clarivaAuth, "signInWithGoogle").mockResolvedValue(roleRequired);
            renderPage(); // Sign in
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(1));
            const pressed = mockGoogleRenders[0].options;
            expect(pressed.text).toBe("signin_with");

            toggle(); // the chooser is still open in Google's popup
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(2));
            expect(submitButton()).toHaveTextContent("Create account");

            await act(async () => {
                pressed.onCredential("token");
            });
            await waitFor(() => expect(createDialog).toHaveBeenCalled());
            expect(google).toHaveBeenCalledWith({ idToken: "token", isConsultant: null, isSignUp: false });
            // and the role dialog tells the user that continuing would CREATE an account (they asked to sign in)
            expect(createDialog.mock.calls[0][0]).toBe(ClarivaGoogleRoleDialog);
            expect(createDialog.mock.calls[0][1]).toEqual({
                email: "new@gmail.com",
                fromSignIn: true,
                isExisting: false,
                initialSetup: EMPTY_CONSULTANT_SETUP,
            });
        });

        it("Sign up pressed, page toggled to Sign in while the chooser was open: still a sign-UP", async () => {
            const google = jest.spyOn(clarivaAuth, "signInWithGoogle").mockResolvedValue(roleRequired);
            renderPage({ initialMode: "signUp" });
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(1));
            const pressed = mockGoogleRenders[0].options;
            expect(pressed.text).toBe("signup_with");

            toggle();
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(2));
            expect(submitButton()).toHaveTextContent("Sign in");

            await act(async () => {
                pressed.onCredential("token");
            });
            await waitFor(() => expect(createDialog).toHaveBeenCalled());
            expect(google).toHaveBeenCalledWith({ idToken: "token", isConsultant: null, isSignUp: true });
            expect(createDialog.mock.calls[0][1]).toEqual({
                email: "new@gmail.com",
                fromSignIn: false,
                isExisting: false,
                initialSetup: EMPTY_CONSULTANT_SETUP,
            });
        });

        it("a token from the button that is showing now carries the mode it shows", async () => {
            const google = jest.spyOn(clarivaAuth, "signInWithGoogle").mockResolvedValue(roleRequired);
            renderPage();
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(1));
            toggle();
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(2));

            await act(async () => {
                mockGoogleRenders[1].options.onCredential("token");
            });
            expect(google).toHaveBeenCalledWith({ idToken: "token", isConsultant: null, isSignUp: true });
        });
    });

    describe("Google button pending state, focus after Try again", () => {
        const loading = (): Element | null => document.querySelector(".mx_ClarivaAuth_googleLoading");

        it("shows 'Connecting to Google…' in the slot until Google has drawn, then removes it", async () => {
            mockGoogleBehaviour = { kind: "manual" };
            renderPage();
            await waitFor(() => expect(mockGoogleSettle).toBeDefined());
            expect(screen.getByTestId("clariva-auth-google")).toContainElement(loading() as HTMLElement);
            expect(loading()).toHaveTextContent(authStrings.googleLoading);
            expect(loading()).toHaveAttribute("aria-hidden", "true");

            await act(async () => {
                mockGoogleSettle!({ ok: true });
            });
            expect(loading()).toBeNull();
            expect(screen.queryByTestId("clariva-auth-google-notice")).toBeNull();
        });

        it("a button that draws nothing swaps the loading text for the notice", async () => {
            mockGoogleBehaviour = { kind: "manual" };
            renderPage();
            await waitFor(() => expect(mockGoogleSettle).toBeDefined());
            expect(loading()).not.toBeNull();

            await act(async () => {
                mockGoogleSettle!({ ok: false, reason: "render_failed" });
            });
            expect(loading()).toBeNull();
            expect(screen.getByTestId("clariva-auth-google-notice")).toBeInTheDocument();
        });

        it("the first load of the page does not move focus to the Google button", async () => {
            renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {});
            expect(screen.getByTestId("clariva-auth-google")).not.toHaveFocus();
        });

        it("Try again hands keyboard focus to the button it mounts (the notice that held it is gone)", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");

            mockGoogleBehaviour = { kind: "ok" };
            const retry = screen.getByTestId("clariva-auth-google-notice-retry");
            retry.focus();
            fireEvent.click(retry);

            await waitFor(() => expect(screen.getByTestId("clariva-auth-google")).toBeInTheDocument());
            expect(screen.getByTestId("clariva-auth-google")).toHaveFocus();
        });

        it("a second Try again (after a first one that failed again) hands focus over too", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_timeout" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");

            fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry")); // fails again
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(2));
            await screen.findByTestId("clariva-auth-google-notice");

            mockGoogleBehaviour = { kind: "ok" };
            fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry"));
            await waitFor(() => expect(screen.getByTestId("clariva-auth-google")).toHaveFocus());
        });

        it("focus is taken once: toggling Sign in <-> Sign up afterwards leaves it where the user put it", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");
            mockGoogleBehaviour = { kind: "ok" };
            fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry"));
            await waitFor(() => expect(screen.getByTestId("clariva-auth-google")).toHaveFocus());

            byId("clariva-auth-email").focus();
            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(3));
            await act(async () => {});
            expect(screen.getByTestId("clariva-auth-google")).not.toHaveFocus();
        });
    });

    describe("Google completion errors", () => {
        const signInThroughGoogle = async (): Promise<string> => {
            renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {
                mockGoogleOptions!.onCredential("google-id-token");
            });
            await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
            const { container } = render(<>{createDialog.mock.calls[0][1].description}</>);
            return container.textContent ?? "";
        };

        beforeEach(() => {
            jest.spyOn(clarivaAuth, "signInWithGoogle").mockResolvedValue({ kind: "signedIn", ...signedIn });
        });

        it("an unexpected error AFTER Google succeeded shows its own message, not 'Could not reach Clariva'", async () => {
            // e.g. opening the Matrix session threw because IndexedDB is blocked: nothing to do with the network
            onLoggedIn.mockRejectedValue(new Error("Failed to open the local database: access denied"));
            const shown = await signInThroughGoogle();
            expect(shown).toBe("Failed to open the local database: access denied");
            expect(shown).not.toContain(AUTH_STRINGS.network);
            expect(createDialog.mock.calls[0][1].title).toBe("Sign-in failed");
            // and the form is usable again
            await waitFor(() => expect(screen.getByTestId("clariva-auth-toggle-mode")).toBeEnabled());
        });

        it("an error without a message falls back to the generic text", async () => {
            onLoggedIn.mockRejectedValue(new Error(""));
            expect(await signInThroughGoogle()).toBe(authStrings.errorGeneric);
        });

        it("a thrown non-Error falls back to the generic text", async () => {
            onLoggedIn.mockRejectedValue("a bare string");
            expect(await signInThroughGoogle()).toBe(authStrings.errorGeneric);
        });

        describe("foreign error text is capped and flattened; the full error goes to the log", () => {
            let warn: jest.SpyInstance;
            beforeEach(() => {
                warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
            });

            it("a very long message is cut to 200 characters with a trailing ellipsis", async () => {
                const error = new Error(`Failed to open the database: ${"x".repeat(500)}`);
                onLoggedIn.mockRejectedValue(error);
                const shown = await signInThroughGoogle();
                expect(shown).toHaveLength(200);
                expect(shown.endsWith("…")).toBe(true);
                expect(shown.startsWith("Failed to open the database: xxx")).toBe(true);
                // the whole thing is still available to whoever reads the console
                expect(warn).toHaveBeenCalledWith("Clariva: Google sign-in failed", error);
                expect((warn.mock.calls[0][1] as Error).message).toHaveLength(529);
            });

            it("a message of exactly 200 characters is shown whole", async () => {
                onLoggedIn.mockRejectedValueOnce(new Error("a".repeat(200)));
                expect(await signInThroughGoogle()).toBe("a".repeat(200));
            });

            it("201 characters are cut to 200 including the ellipsis", async () => {
                onLoggedIn.mockRejectedValue(new Error("a".repeat(201)));
                expect(await signInThroughGoogle()).toBe(`${"a".repeat(199)}…`);
            });

            it("runs of whitespace and newlines (a stack trace) collapse to single spaces", async () => {
                onLoggedIn.mockRejectedValue(
                    new Error("  QuotaExceededError:\n\n   the quota\tis   full \n at foo (bar.js:1:2)  "),
                );
                expect(await signInThroughGoogle()).toBe("QuotaExceededError: the quota is full at foo (bar.js:1:2)");
            });

            it("a message that is only whitespace falls back to the generic text", async () => {
                onLoggedIn.mockRejectedValue(new Error(" \n\t "));
                expect(await signInThroughGoogle()).toBe(authStrings.errorGeneric);
            });

            it("a short message is untouched", async () => {
                onLoggedIn.mockRejectedValue(new Error("Failed to open the local database: access denied"));
                expect(await signInThroughGoogle()).toBe("Failed to open the local database: access denied");
            });

            it("API errors keep their mapped message and are not capped by this rule", async () => {
                const long = "Invalid Google credentials ".repeat(20).trim();
                jest.spyOn(clarivaAuth, "signInWithGoogle").mockRejectedValue(
                    new ClarivaHttpError(400, "HTTP 400", "http", long),
                );
                const shown = await signInThroughGoogle();
                expect(shown).toBe(long);
                expect(shown.length).toBeGreaterThan(200);
            });
        });

        it("a genuine network failure keeps the mapped 'Could not reach Clariva' message", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle").mockRejectedValue(
                new ClarivaHttpError(0, "Failed to fetch", "network"),
            );
            expect(await signInThroughGoogle()).toBe(AUTH_STRINGS.network);
        });

        it("an API failure from the completion step keeps its mapped reason", async () => {
            jest.spyOn(clarivaAuth, "signInWithGoogle").mockRejectedValue(
                new ClarivaHttpError(401, "HTTP 401", "http", "Invalid Google credentials"),
            );
            expect(await signInThroughGoogle()).toBe("Invalid Google credentials");
        });
    });

    describe("Google role dialog (spec: sign-in must never silently become sign-up)", () => {
        const startGoogle = async (
            mode: "signIn" | "signUp",
            roleRequired: { email: string | undefined; isExisting: boolean | undefined },
        ): Promise<jest.SpyInstance> => {
            const google = jest.spyOn(clarivaAuth, "signInWithGoogle").mockResolvedValue({
                kind: "roleRequired",
                name: undefined,
                ...roleRequired,
            });
            createDialog.mockImplementation(() => ({ finished: Promise.resolve([false]), close: jest.fn() }));
            renderPage({ initialMode: mode });
            await waitFor(() =>
                expect(mockGoogleOptions?.text).toBe(mode === "signIn" ? "signin_with" : "signup_with"),
            );
            await act(async () => {
                mockGoogleOptions!.onCredential("google-id-token");
            });
            await waitFor(() => expect(createDialog).toHaveBeenCalled());
            return google;
        };
        const dialogProps = (): React.ComponentProps<typeof ClarivaGoogleRoleDialog> => {
            expect(createDialog.mock.calls[0][0]).toBe(ClarivaGoogleRoleDialog);
            return { ...createDialog.mock.calls[0][1], onFinished: jest.fn() };
        };

        it("from the SIGN-IN screen with no account: tells the user that continuing creates one", async () => {
            await startGoogle("signIn", { email: "new@gmail.com", isExisting: false });
            const props = dialogProps();
            expect(props).toMatchObject({ email: "new@gmail.com", fromSignIn: true, isExisting: false });

            render(<ClarivaGoogleRoleDialog {...props} />);
            expect(screen.getByTestId("clariva-role-no-account")).toHaveTextContent(
                authStrings.googleNoAccountNotice("new@gmail.com"),
            );
        });

        it("from the SIGN-UP screen: no such notice (creating an account is what was asked for)", async () => {
            await startGoogle("signUp", { email: "new@gmail.com", isExisting: false });
            const props = dialogProps();
            expect(props).toMatchObject({ email: "new@gmail.com", fromSignIn: false, isExisting: false });

            render(<ClarivaGoogleRoleDialog {...props} />);
            expect(screen.queryByTestId("clariva-role-no-account")).toBeNull();
        });

        it.each([[true], [undefined]])(
            "from the sign-in screen with isExisting %s: no notice (an older server must not read as 'no account')",
            async (isExisting) => {
                await startGoogle("signIn", { email: "old@gmail.com", isExisting });
                const props = dialogProps();
                expect(props.fromSignIn).toBe(true);
                expect(props.isExisting).toBe(isExisting);

                render(<ClarivaGoogleRoleDialog {...props} />);
                expect(screen.queryByTestId("clariva-role-no-account")).toBeNull();
            },
        );

        it("Cancel creates nothing: one server call, no session, no error dialog, form released", async () => {
            const google = await startGoogle("signIn", { email: "new@gmail.com", isExisting: false });
            await waitFor(() => expect(screen.getByTestId("clariva-auth-toggle-mode")).toBeEnabled());

            expect(google).toHaveBeenCalledTimes(1); // the follow-up call (which would create the account) never happens
            expect(google).toHaveBeenCalledWith({ idToken: "google-id-token", isConsultant: null, isSignUp: false });
            expect(onLoggedIn).not.toHaveBeenCalled();
            expect(createDialog.mock.calls.filter(([dialog]) => dialog === ErrorDialog)).toHaveLength(0);
            expect(ClarivaSession.instance.jwt).toBeNull();
        });
    });

    describe("Google button while a sign-in runs", () => {
        it("is inert (keyboard AND mouse) until the attempt ends, and a second credential is ignored", async () => {
            let resolveGoogle: (outcome: Awaited<ReturnType<typeof clarivaAuth.signInWithGoogle>>) => void = () => {};
            const google = jest.spyOn(clarivaAuth, "signInWithGoogle").mockReturnValue(
                new Promise((resolve) => {
                    resolveGoogle = resolve;
                }),
            );
            createDialog.mockImplementation(() => ({ finished: Promise.resolve([false]), close: jest.fn() }));
            const { container } = renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            const buttonHost = container.querySelector(".mx_ClarivaAuth_googleButton")!;
            expect(buttonHost).not.toHaveAttribute("inert");
            expect(container.querySelector(".mx_ClarivaAuth_googleShield")).toBeNull();

            await act(async () => {
                mockGoogleOptions!.onCredential("first-token");
            });
            expect(buttonHost).toHaveAttribute("inert");
            expect(container.querySelector(".mx_ClarivaAuth_googleShield")).not.toBeNull();

            await act(async () => {
                mockGoogleOptions!.onCredential("second-token");
            });
            expect(google).toHaveBeenCalledTimes(1);

            await act(async () => {
                resolveGoogle({ kind: "roleRequired", email: undefined, name: undefined, isExisting: false });
            });
            await waitFor(() => expect(buttonHost).not.toHaveAttribute("inert"));
            expect(container.querySelector(".mx_ClarivaAuth_googleShield")).toBeNull();
        });
    });

    describe("Google is unavailable", () => {
        const failures: [string, string][] = [
            ["script_blocked", authStrings.googleUnavailableBlocked],
            ["script_timeout", authStrings.googleUnavailableTimeout],
            ["render_failed", authStrings.googleUnavailableRender],
        ];
        const notice = (): HTMLElement => screen.getByTestId("clariva-auth-google-notice");

        it.each(failures)(
            "a script that fails (%s) replaces the button with the notice; nothing else changes",
            async (reason, text) => {
                mockGoogleBehaviour = { kind: "reject", reason: reason as never };
                renderPage();

                expect(await screen.findByTestId("clariva-auth-google-notice")).toBeInTheDocument();
                expect(notice()).toHaveTextContent(authStrings.googleUnavailableTitle);
                expect(notice()).toHaveTextContent(text);
                expect(notice()).toHaveTextContent(authStrings.googleUnavailableFallbackSignIn);
                expect(screen.queryByTestId("clariva-auth-google")).toBeNull(); // the button is gone
                expect(screen.getByText(authStrings.or)).toBeInTheDocument(); // the divider stays
                expect(screen.getByTestId("clariva-auth-email")).toBeInTheDocument();
                expect(createDialog).not.toHaveBeenCalled(); // a quiet notice, never an ErrorDialog
            },
        );

        it("a button that draws nothing is reported the same way", async () => {
            mockGoogleBehaviour = { kind: "notDrawn", reason: "render_failed" };
            renderPage();
            expect(await screen.findByTestId("clariva-auth-google-notice")).toHaveTextContent(
                authStrings.googleUnavailableRender,
            );
            expect(createDialog).not.toHaveBeenCalled();
        });

        it("only the text is a live region; the Try again button sits outside it, inside the notice", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");

            const region = within(notice()).getByRole("status");
            expect(within(notice()).getAllByRole("status")).toHaveLength(1);
            expect(region).toHaveTextContent(authStrings.googleUnavailableTitle);
            expect(region).toHaveTextContent(authStrings.googleUnavailableBlocked);
            expect(region.querySelector("button")).toBeNull();
            const retry = screen.getByTestId("clariva-auth-google-notice-retry");
            expect(region).not.toContainElement(retry);
            expect(notice()).toContainElement(retry);
            expect(notice()).not.toHaveAttribute("role");
        });

        it("the sign-in notice does not promise a password to a Google-only user; the sign-up notice has no caveat", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");
            expect(notice()).toHaveTextContent("You can still sign in with your email or username and password.");
            expect(notice()).toHaveTextContent(
                /Signed up with Google\? Try again in a moment, or use the Clariva app\./,
            );

            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));
            expect(notice()).toHaveTextContent("You can still create an account with your email and password.");
            expect(notice()).not.toHaveTextContent(/Signed up with Google/);
        });

        it("a working button shows no notice", async () => {
            renderPage();
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {});
            expect(screen.queryByTestId("clariva-auth-google-notice")).toBeNull();
            expect(screen.getByTestId("clariva-auth-google")).toBeInTheDocument();
        });

        it("email and password sign-in still works, with no error dialog", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            const signIn = jest.spyOn(clarivaAuth, "signInWithEmail").mockResolvedValue(signedIn);
            const user = userEvent.setup();
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");

            await user.type(byId("clariva-auth-email"), "jane.doe");
            await user.type(byId("clariva-auth-password"), "hunter2hunter2{Enter}");

            await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
            expect(signIn).toHaveBeenCalledWith("jane.doe", "hunter2hunter2");
            expect(createDialog).not.toHaveBeenCalled();
        });

        it("Try again mounts the button afresh; if Google is still down the notice comes back", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_timeout" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");
            expect(mockGoogleRenders).toHaveLength(1);

            // still down: the retry fails visibly again (fireEvent: act-wrapped, so the remounted button's effect runs)
            fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry"));
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(2));
            await screen.findByTestId("clariva-auth-google-notice");

            // back up
            mockGoogleBehaviour = { kind: "ok" };
            fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry"));
            await waitFor(() => expect(screen.getByTestId("clariva-auth-google")).toBeInTheDocument());
            expect(screen.queryByTestId("clariva-auth-google-notice")).toBeNull();
            expect(mockGoogleRenders).toHaveLength(3);
            expect(mockGoogleRenders[2].options.text).toBe("signin_with");
        });

        it("the notice survives a Sign in <-> Sign up toggle and says what is still possible in each mode", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            renderPage();
            await screen.findByTestId("clariva-auth-google-notice");
            expect(notice()).toHaveTextContent(authStrings.googleUnavailableFallbackSignIn);

            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode")); // Create account
            expect(notice()).toHaveTextContent(authStrings.googleUnavailableFallbackSignUp);
            expect(notice()).not.toHaveTextContent(authStrings.googleUnavailableFallbackSignIn);
            expect(screen.getByText(authStrings.or)).toBeInTheDocument();

            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode")); // and back
            expect(notice()).toHaveTextContent(authStrings.googleUnavailableFallbackSignIn);
            await act(async () => {});
            expect(mockGoogleRenders).toHaveLength(1); // no new attempt behind the notice
        });

        it("toggling Sign in <-> Sign up with a WORKING button remounts it with the new text each time", async () => {
            renderPage();
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(1));
            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(2));
            fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode"));
            await waitFor(() => expect(mockGoogleRenders).toHaveLength(3));
            expect(mockGoogleRenders.map((r) => r.options.text)).toEqual(["signin_with", "signup_with", "signin_with"]);
            // every replaced render was disposed; only the live one is left
            expect(mockGoogleRenders[0].dispose).toHaveBeenCalledTimes(1);
            expect(mockGoogleRenders[1].dispose).toHaveBeenCalledTimes(1);
            expect(mockGoogleRenders[2].dispose).not.toHaveBeenCalled();
        });

        describe("password 401 hint", () => {
            const wrongPassword = async (): Promise<string> => {
                jest.spyOn(clarivaAuth, "signInWithEmail").mockRejectedValue(
                    new ClarivaAuthError("Incorrect email or password.", 401),
                );
                fireEvent.change(byId("clariva-auth-email"), { target: { value: "jane.doe" } });
                fireEvent.change(byId("clariva-auth-password"), { target: { value: "wrong-password" } });
                fireEvent.click(submitButton());
                await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
                const { container } = render(<>{createDialog.mock.calls[0][1].description}</>);
                return container.textContent ?? "";
            };

            it("points at 'Sign in with Google' while the button is available", async () => {
                renderPage();
                await waitFor(() => expect(mockGoogleOptions).toBeDefined());
                expect(await wrongPassword()).toBe(`Incorrect email or password.\n${authStrings.googleAccountHint}`);
            });

            it("does NOT point at a button that is not there: says Google is unavailable instead", async () => {
                mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
                renderPage();
                await screen.findByTestId("clariva-auth-google-notice");
                const shown = await wrongPassword();
                expect(shown).toBe(`Incorrect email or password.\n${authStrings.googleAccountHintUnavailable}`);
                expect(shown).not.toContain(authStrings.googleAccountHint);
            });

            describe("the hint follows the Google state when the request FAILS, not when it was sent", () => {
                const slowWrongPassword = (): { fail: () => Promise<void>; shown: () => string } => {
                    let reject: (e: unknown) => void = () => {};
                    jest.spyOn(clarivaAuth, "signInWithEmail").mockReturnValue(
                        new Promise((_resolve, rejectFn) => {
                            reject = rejectFn;
                        }),
                    );
                    fireEvent.change(byId("clariva-auth-email"), { target: { value: "jane.doe" } });
                    fireEvent.change(byId("clariva-auth-password"), { target: { value: "wrong-password" } });
                    fireEvent.click(submitButton()); // the request is now in flight and slow
                    return {
                        fail: async () => {
                            await act(async () => {
                                reject(new ClarivaAuthError("Incorrect email or password.", 401));
                            });
                            await waitFor(() =>
                                expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()),
                            );
                        },
                        shown: () =>
                            render(<>{createDialog.mock.calls[0][1].description}</>).container.textContent ?? "",
                    };
                };

                it("Google's script timed out WHILE the password request was running: says Google is unavailable", async () => {
                    mockGoogleBehaviour = { kind: "manual" };
                    renderPage();
                    await waitFor(() => expect(mockGoogleSettle).toBeDefined());
                    const request = slowWrongPassword();

                    await act(async () => {
                        mockGoogleSettle!({ ok: false, reason: "script_timeout" });
                    });
                    await screen.findByTestId("clariva-auth-google-notice");
                    await request.fail();

                    expect(request.shown()).toBe(
                        `Incorrect email or password.\n${authStrings.googleAccountHintUnavailable}`,
                    );
                });

                it("Google recovered (Try again) WHILE the password request was running: points at the button", async () => {
                    mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
                    renderPage();
                    await screen.findByTestId("clariva-auth-google-notice");
                    const request = slowWrongPassword();

                    mockGoogleBehaviour = { kind: "ok" };
                    fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry"));
                    await waitFor(() => expect(screen.getByTestId("clariva-auth-google")).toBeInTheDocument());
                    await request.fail();

                    expect(request.shown()).toBe(`Incorrect email or password.\n${authStrings.googleAccountHint}`);
                });
            });

            it("the same when Google is not configured on this deployment (no Google block at all)", async () => {
                mockGoogleConfigured = false;
                renderPage();
                expect(screen.queryByTestId("clariva-auth-google")).toBeNull();
                expect(screen.queryByTestId("clariva-auth-google-notice")).toBeNull();
                expect(screen.queryByText(authStrings.or)).toBeNull();
                expect(mockGoogleRenders).toHaveLength(0);
                expect(await wrongPassword()).toBe(
                    `Incorrect email or password.\n${authStrings.googleAccountHintUnavailable}`,
                );
            });
        });

        describe("developer hint (Authorized JavaScript origins)", () => {
            it("on a development origin: collapsed by default, listing the origins to authorise", async () => {
                mockOrigin = "http://localhost:8090";
                renderPage();
                await waitFor(() => expect(mockGoogleOptions).toBeDefined());

                const hint = screen.getByTestId("clariva-auth-google-dev-hint");
                expect(hint.tagName).toBe("DETAILS");
                expect(hint).not.toHaveAttribute("open");
                expect(within(hint).getByText(authStrings.googleDevHintSummary)).toBeInTheDocument();
                expect(Array.from(hint.querySelectorAll("code")).map((c) => c.textContent)).toEqual([
                    "http://localhost:8090",
                    "http://localhost",
                ]);
            });

            it.each([
                ["http://127.0.0.1:8080", true],
                ["http://[::1]:3000", true],
                ["https://x.test", true],
                ["https://clarivahub.com", false],
                ["https://web.clarivahub.com", false],
                ["https://localhost.evil.com", false],
                ["http://192.168.1.5:8090", false],
            ])("the hint on %s is shown: %s", async (origin, shown) => {
                mockOrigin = origin;
                renderPage();
                await waitFor(() => expect(mockGoogleOptions).toBeDefined());
                expect(!!screen.queryByTestId("clariva-auth-google-dev-hint")).toBe(shown);
            });

            it("on a production origin the origin appears nowhere in the DOM, with a working button or a notice", async () => {
                mockOrigin = "https://web.clarivahub.com";
                const { unmount } = renderPage();
                await waitFor(() => expect(mockGoogleOptions).toBeDefined());
                await act(async () => {});
                expect(document.body.textContent).not.toContain("web.clarivahub.com");
                expect(document.body.textContent).not.toContain("Authorized JavaScript origins");
                expect(document.body.innerHTML).not.toContain("web.clarivahub.com");
                unmount();

                mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
                renderPage();
                await screen.findByTestId("clariva-auth-google-notice");
                expect(document.body.innerHTML).not.toContain("web.clarivahub.com");
                expect(screen.queryByTestId("clariva-auth-google-dev-hint")).toBeNull();
            });
        });
    });

    it("opens the forgot-password dialog prefilled only with an e-mail address", async () => {
        const user = userEvent.setup();
        renderPage();
        await user.type(byId("clariva-auth-email"), "jane.doe");
        await user.click(screen.getByTestId("clariva-auth-forgot-password"));
        expect(createDialog).toHaveBeenLastCalledWith(ClarivaForgotPasswordDialog, {
            initialEmail: "",
            googleAvailable: true,
        });

        await user.clear(byId("clariva-auth-email"));
        await user.type(byId("clariva-auth-email"), "jane@example.com");
        await user.click(screen.getByTestId("clariva-auth-forgot-password"));
        expect(createDialog).toHaveBeenLastCalledWith(ClarivaForgotPasswordDialog, {
            initialEmail: "jane@example.com",
            googleAvailable: true,
        });
    });

    describe("forgot-password dialog is told whether 'Sign in with Google' can be pointed at", () => {
        const forgot = (): HTMLElement => screen.getByTestId("clariva-auth-forgot-password");

        it("reads the CURRENT Google state each time it opens (same e-mail, so the opener itself is unchanged)", async () => {
            mockGoogleBehaviour = { kind: "manual" };
            const user = userEvent.setup();
            renderPage();
            await waitFor(() => expect(mockGoogleSettle).toBeDefined());
            await user.type(byId("clariva-auth-email"), "jane@example.com");

            await user.click(forgot());
            expect(createDialog).toHaveBeenLastCalledWith(ClarivaForgotPasswordDialog, {
                initialEmail: "jane@example.com",
                googleAvailable: true,
            });

            // Google turns out to be unusable
            await act(async () => {
                mockGoogleSettle!({ ok: false, reason: "script_timeout" });
            });
            await screen.findByTestId("clariva-auth-google-notice");
            await user.click(forgot());
            expect(createDialog).toHaveBeenLastCalledWith(ClarivaForgotPasswordDialog, {
                initialEmail: "jane@example.com",
                googleAvailable: false,
            });

            // and then recovers
            mockGoogleBehaviour = { kind: "ok" };
            fireEvent.click(screen.getByTestId("clariva-auth-google-notice-retry"));
            await waitFor(() => expect(screen.getByTestId("clariva-auth-google")).toBeInTheDocument());
            await user.click(forgot());
            expect(createDialog).toHaveBeenLastCalledWith(ClarivaForgotPasswordDialog, {
                initialEmail: "jane@example.com",
                googleAvailable: true,
            });
        });

        it("Google not configured on this deployment: googleAvailable is false", async () => {
            mockGoogleConfigured = false;
            const user = userEvent.setup();
            renderPage();
            await user.click(forgot());
            expect(createDialog).toHaveBeenLastCalledWith(ClarivaForgotPasswordDialog, {
                initialEmail: "",
                googleAvailable: false,
            });
        });

        it("opened straight from the URL (openForgotPassword) it gets the same flag", async () => {
            renderPage({ openForgotPassword: true });
            await waitFor(() =>
                expect(createDialog).toHaveBeenCalledWith(ClarivaForgotPasswordDialog, {
                    initialEmail: "",
                    googleAvailable: true,
                }),
            );
        });
    });

    it("returns to sign-in with the e-mail prefilled after a password reset", async () => {
        const user = userEvent.setup();
        createDialog.mockImplementation(() => ({ finished: Promise.resolve(["jane@example.com"]), close: jest.fn() }));
        renderPage({ initialMode: "signUp" });
        fireEvent.click(screen.getByTestId("clariva-auth-toggle-mode")); // to sign-in
        await user.click(screen.getByTestId("clariva-auth-forgot-password"));
        await waitFor(() => expect(byId("clariva-auth-email").value).toBe("jane@example.com"));
        expect(byId("clariva-auth-password").value).toBe("");
        expect(submitButton()).toHaveTextContent("Sign in");
    });
});

describe("ClarivaForgotPasswordDialog", () => {
    beforeEach(() => {
        configureClariva();
    });
    afterEach(() => jest.restoreAllMocks());

    it("walks e-mail -> code + new password -> done, then returns the e-mail to sign in with", async () => {
        const onFinished = jest.fn();
        const request = jest.spyOn(clarivaAuth, "requestPasswordReset").mockResolvedValue();
        const reset = jest.spyOn(clarivaAuth, "resetPassword").mockResolvedValue();
        const user = userEvent.setup();
        render(<ClarivaForgotPasswordDialog initialEmail="" onFinished={onFinished} />);

        expect(screen.getByText(authStrings.forgotEmailSubtitle)).toBeInTheDocument();
        const send = screen.getByTestId("dialog-primary-button");
        expect(send).toBeDisabled();
        await user.type(screen.getByTestId("clariva-forgot-email"), "jane@example.com");
        expect(send).toBeEnabled();
        await user.click(send);

        expect(request).toHaveBeenCalledWith("jane@example.com");
        expect(await screen.findByText(authStrings.forgotCodeSubtitle("jane@example.com"))).toBeInTheDocument();

        const reseter = screen.getByTestId("dialog-primary-button");
        expect(reseter).toBeDisabled();
        await user.type(screen.getByTestId("clariva-forgot-code"), "12a345-678");
        expect(screen.getByTestId("clariva-forgot-code")).toHaveValue("123456"); // digits only, max 6
        await user.type(screen.getByTestId("clariva-forgot-password"), "newpassword1");
        expect(reseter).toBeEnabled();
        await user.click(reseter);

        expect(reset).toHaveBeenCalledWith("jane@example.com", "123456", "newpassword1");
        expect(await screen.findByText(authStrings.forgotSuccess)).toBeInTheDocument();
        await user.click(screen.getByTestId("dialog-primary-button"));
        expect(onFinished).toHaveBeenCalledWith("jane@example.com");
    });

    it("resend clears the typed code; errors show the mapped server message", async () => {
        const user = userEvent.setup();
        jest.spyOn(clarivaAuth, "requestPasswordReset").mockResolvedValue();
        jest.spyOn(clarivaAuth, "resetPassword").mockRejectedValue(
            new ClarivaAuthError("That code is invalid or has expired. Please request a new one.", 400),
        );
        render(<ClarivaForgotPasswordDialog initialEmail="jane@example.com" onFinished={jest.fn()} />);
        await user.click(screen.getByTestId("dialog-primary-button"));
        await screen.findByTestId("clariva-forgot-code");

        await user.type(screen.getByTestId("clariva-forgot-code"), "111111");
        await user.type(screen.getByTestId("clariva-forgot-password"), "newpassword1");
        await user.click(screen.getByTestId("dialog-primary-button"));
        expect(await screen.findByTestId("clariva-forgot-error")).toHaveTextContent(
            "That code is invalid or has expired. Please request a new one.",
        );

        await user.click(screen.getByTestId("clariva-forgot-resend"));
        await waitFor(() => expect(screen.getByTestId("clariva-forgot-code")).toHaveValue(""));
    });

    it("drops a response that arrives after the dialog was dismissed", async () => {
        let resolveRequest: () => void = () => {};
        jest.spyOn(clarivaAuth, "requestPasswordReset").mockReturnValue(
            new Promise<void>((resolve) => {
                resolveRequest = resolve;
            }),
        );
        const user = userEvent.setup();
        const { unmount } = render(
            <ClarivaForgotPasswordDialog initialEmail="jane@example.com" onFinished={jest.fn()} />,
        );
        await user.click(screen.getByTestId("dialog-primary-button"));
        unmount();
        const errors = jest.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => resolveRequest());
        expect(errors).not.toHaveBeenCalled(); // no setState on an unmounted component
    });
});

describe("ClarivaGoogleRoleDialog", () => {
    it("preselects 'No', shows the email subtitle, and commits the staged choice on Continue", async () => {
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaGoogleRoleDialog email="j@gmail.com" onFinished={onFinished} />);
        expect(screen.getByText(authStrings.googleRoleSubtitleWithEmail("j@gmail.com"))).toBeInTheDocument();
        expect(screen.getByTestId("clariva-role-no")).toBeChecked();

        await user.click(screen.getByTestId("clariva-role-no"));
        await user.click(screen.getByTestId("dialog-primary-button"));
        expect(onFinished).toHaveBeenCalledWith(true, false);
    });

    it("'Yes' leads to the optional payout step instead of finishing (nothing is created yet)", async () => {
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaGoogleRoleDialog email="j@gmail.com" onFinished={onFinished} />);
        await user.click(screen.getByTestId("clariva-role-yes"));
        await user.click(screen.getByTestId("dialog-primary-button"));
        expect(onFinished).not.toHaveBeenCalled();
        expect(screen.getByText(authStrings.googlePayoutSubtitleWithEmail("j@gmail.com"))).toBeInTheDocument();
        expect(screen.getByLabelText("Max credits per chat")).toBeInTheDocument();
    });

    it("Cancel abandons; there is no close button", async () => {
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaGoogleRoleDialog onFinished={onFinished} />);
        expect(screen.getByText(authStrings.googleRoleSubtitle)).toBeInTheDocument();
        expect(screen.queryByLabelText("Close dialog")).toBeNull();
        await user.click(screen.getByTestId("dialog-cancel-button"));
        expect(onFinished).toHaveBeenCalledWith(false);
    });
});
