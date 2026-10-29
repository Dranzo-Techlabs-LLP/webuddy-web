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
import { EventEmitter } from "events";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CryptoEvent } from "matrix-js-sdk/src/crypto";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import dis from "../../src/dispatcher/dispatcher";
import Modal from "../../src/Modal";
import { ClarivaDeactivateDialog } from "../../src/clariva/components/auth/ClarivaDeactivateDialog";
import { ClarivaForgotPasswordDialog } from "../../src/clariva/components/auth/ClarivaForgotPasswordDialog";
import { ClarivaGoogleRoleDialog } from "../../src/clariva/components/auth/ClarivaGoogleRoleDialog";
import { ClarivaLogoutDialog } from "../../src/clariva/components/auth/ClarivaLogoutDialog";
import { ClarivaSignedOutDialog } from "../../src/clariva/components/auth/ClarivaSignedOutDialog";
import { ClarivaBackupProgress } from "../../src/clariva/session/backupProgress";
import { ClarivaAuthError, clarivaAuth } from "../../src/clariva/session/ClarivaAuthService";
import { isDeliberateSignOut, takeLandingNotice } from "../../src/clariva/session/signOutState";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { authStrings } from "../../src/clariva/strings/auth";
import { stubClient } from "../test-utils";
import { configureClariva } from "./helpers";

// Google Identity Services cannot load in jsdom. The mock decides how every render ends (drew fine / drew nothing /
// rejected) and whether Google is configured at all; the error class stays REAL (the button does `instanceof` on it).
interface MockGoogleOptions {
    text: string;
    onCredential: (token: string) => void;
}
type MockGoogleBehaviour =
    | { kind: "ok" }
    | { kind: "notDrawn"; reason: "script_blocked" | "script_timeout" | "render_failed" }
    | { kind: "reject"; reason: "script_blocked" | "script_timeout" | "render_failed" };
let mockGoogleOptions: MockGoogleOptions | undefined;
let mockGoogleRenders: MockGoogleOptions[] = [];
let mockGoogleBehaviour: MockGoogleBehaviour = { kind: "ok" };
let mockGoogleConfigured = true;
jest.mock("../../src/clariva/session/googleIdentity", () => {
    const actual = jest.requireActual("../../src/clariva/session/googleIdentity");
    return {
        ...actual,
        isGoogleSignInConfigured: () => mockGoogleConfigured,
        renderGoogleButton: async (_container: HTMLElement, options: MockGoogleOptions) => {
            mockGoogleOptions = options;
            mockGoogleRenders.push(options);
            if (mockGoogleBehaviour.kind === "reject") {
                throw new actual.GoogleUnavailableError(mockGoogleBehaviour.reason);
            }
            const ready =
                mockGoogleBehaviour.kind === "notDrawn"
                    ? { ok: false, reason: mockGoogleBehaviour.reason }
                    : { ok: true };
            return { dispose: () => {}, ready: Promise.resolve(ready) };
        },
    };
});

beforeEach(() => {
    configureClariva();
    mockGoogleOptions = undefined;
    mockGoogleRenders = [];
    mockGoogleBehaviour = { kind: "ok" };
    mockGoogleConfigured = true;
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    ClarivaBackupProgress.resetForTests();
    takeLandingNotice();
});

describe("ClarivaLogoutDialog (spec 01 §2.7)", () => {
    it("asks 'Sign out?' with the Android copy, no key-backup warnings, and logs out on confirm", async () => {
        const dispatch = jest.spyOn(dis, "dispatch").mockImplementation(() => {});
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaLogoutDialog onFinished={onFinished} />);

        expect(screen.getByText("Sign out?")).toBeInTheDocument();
        expect(screen.getByText(authStrings.signOutSubtitle)).toBeInTheDocument();
        expect(screen.queryByText(/recovery key|Secure Backup|set up/i)).toBeNull();

        await user.click(screen.getByRole("button", { name: "Sign out" }));
        expect(dispatch).toHaveBeenCalledWith({ action: "logout" });
        expect(onFinished).toHaveBeenCalledWith(true);
    });

    it("closes every open dialog (e.g. Settings, where Sign out lives) before logging out", async () => {
        const dispatch = jest.spyOn(dis, "dispatch").mockImplementation(() => {});
        const closeAll = jest.spyOn(Modal, "forceCloseAllModals");
        render(<ClarivaLogoutDialog onFinished={jest.fn()} />);
        await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
        expect(closeAll).toHaveBeenCalled();
        expect(closeAll.mock.invocationCallOrder[0]).toBeLessThan(dispatch.mock.invocationCallOrder[0]);
        closeAll.mockRestore();
    });

    it("Cancel does not log out", async () => {
        const dispatch = jest.spyOn(dis, "dispatch").mockImplementation(() => {});
        const onFinished = jest.fn();
        render(<ClarivaLogoutDialog onFinished={onFinished} />);
        await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
        expect(dispatch).not.toHaveBeenCalled();
        expect(onFinished).toHaveBeenCalledWith(false);
    });

    it("shows the 'keys still being backed up' variant while room keys are uploading, live", () => {
        const emitter = new EventEmitter();
        ClarivaBackupProgress.instance.attach(emitter as unknown as MatrixClient);
        render(<ClarivaLogoutDialog onFinished={jest.fn()} />);
        expect(screen.getByText("Sign out?")).toBeInTheDocument();

        act(() => {
            emitter.emit(CryptoEvent.KeyBackupSessionsRemaining, 12);
        });
        expect(screen.getByText("Your keys are still being backed up")).toBeInTheDocument();
        expect(screen.getByText("Please wait for this to complete before signing out.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Sign out anyway" })).toBeInTheDocument();

        act(() => {
            emitter.emit(CryptoEvent.KeyBackupSessionsRemaining, 0);
        });
        expect(screen.getByText("Sign out?")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Sign out anyway" })).toBeNull();
    });
});

describe("ClarivaSignedOutDialog (spec 01 §2.5)", () => {
    it("drops the 'changed your password' reason and offers 'Sign in again'", async () => {
        const onFinished = jest.fn();
        render(<ClarivaSignedOutDialog onFinished={onFinished} />);
        expect(screen.getByText("You’re signed out")).toBeInTheDocument();
        expect(screen.getByText(authStrings.signedOutSubtitle)).toBeInTheDocument();
        expect(screen.getByText("You have deleted the session from another session")).toBeInTheDocument();
        expect(screen.getByText("Your server’s administrator has invalidated your access")).toBeInTheDocument();
        expect(screen.queryByText(/changed your password/)).toBeNull();
        await userEvent.setup().click(screen.getByRole("button", { name: "Sign in again" }));
        expect(onFinished).toHaveBeenCalled();
    });
});

describe("ClarivaDeactivateDialog (spec 01 §2.8, §3.10)", () => {
    let dispatch: jest.SpyInstance;
    let userId: string;

    beforeEach(() => {
        userId = stubClient().getSafeUserId();
        dispatch = jest.spyOn(dis, "dispatch").mockImplementation(() => {});
        // the confirmation question: accept
        jest.spyOn(Modal, "createDialog").mockImplementation((() => ({
            finished: Promise.resolve([true]),
            close: jest.fn(),
        })) as never);
    });

    const primary = (): HTMLButtonElement => screen.getByTestId("dialog-primary-button") as HTMLButtonElement;

    it("email account: needs the password, sends it with eraseData, then logs out locally", async () => {
        jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(false);
        const deactivate = jest.spyOn(clarivaAuth, "deactivateAccount").mockResolvedValue();
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaDeactivateDialog onFinished={onFinished} />);

        expect(screen.getByText("irreversible")).toBeInTheDocument();
        expect(screen.getByText("Permanently disable")).toBeInTheDocument();
        expect(screen.getByText(authStrings.deactivateItem4)).toBeInTheDocument();
        expect(primary()).toBeDisabled();

        await user.type(screen.getByLabelText("Confirm password"), "my-password");
        await user.click(screen.getByTestId("clariva-deactivate-erase"));
        expect(primary()).toBeEnabled();
        await user.click(primary());

        await waitFor(() => expect(onFinished).toHaveBeenCalledWith(true));
        expect(deactivate).toHaveBeenCalledWith({ matrixUserId: userId, password: "my-password", eraseData: true });
        expect(dispatch).toHaveBeenCalledWith({ action: "logout" });
        expect(takeLandingNotice()).toBe("Your account has been deactivated.");
    });

    it("shows the server's message when deactivation fails (Android hid it) and allows a retry", async () => {
        jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(false);
        jest.spyOn(clarivaAuth, "deactivateAccount").mockRejectedValue(
            new ClarivaAuthError("Could not verify your identity", 401),
        );
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaDeactivateDialog onFinished={onFinished} />);

        await user.type(screen.getByLabelText("Confirm password"), "wrong");
        await user.click(primary());

        expect(await screen.findByTestId("clariva-deactivate-error")).toHaveTextContent(
            "Could not verify your identity",
        );
        expect(onFinished).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalledWith({ action: "logout" });
        expect(isDeliberateSignOut()).toBe(false); // a later genuine invalidation must still be announced
        expect(primary()).toBeEnabled();
    });

    it("Google account: asks to authorise with Google first and sends the token, not a password", async () => {
        jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(true);
        const deactivate = jest.spyOn(clarivaAuth, "deactivateAccount").mockResolvedValue();
        const user = userEvent.setup();
        render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);

        expect(await screen.findByText(authStrings.deactivateGoogleNotice)).toBeInTheDocument();
        expect(screen.queryByLabelText("Confirm password")).toBeNull();
        expect(primary()).toBeDisabled();
        await waitFor(() => expect(mockGoogleOptions).toBeDefined());

        await act(async () => {
            mockGoogleOptions!.onCredential("fresh-google-token");
        });
        expect(screen.getByText(authStrings.deactivateGoogleAuthorized)).toBeInTheDocument();
        expect(primary()).toBeEnabled();
        await user.click(primary());

        await waitFor(() => expect(deactivate).toHaveBeenCalled());
        expect(deactivate).toHaveBeenCalledWith({
            matrixUserId: userId,
            googleIdToken: "fresh-google-token",
            eraseData: false,
        });
    });

    describe("Google account while Google is unavailable (it used to be an empty slot and a dead button)", () => {
        const unavailable = (): HTMLElement => screen.getByTestId("clariva-deactivate-google-unavailable");

        beforeEach(() => {
            jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(true);
        });

        const reasonTexts = {
            script_blocked: authStrings.googleUnavailableBlocked,
            script_timeout: authStrings.googleUnavailableTimeout,
            render_failed: authStrings.googleUnavailableRender,
        } as const;
        // title + body, exactly: the body must not be a second copy of the title
        const bodyOf = (): string => unavailable().querySelector(".mx_ClarivaAuth_googleNoticeBody")!.textContent ?? "";

        it.each(["script_blocked", "script_timeout", "render_failed"] as const)(
            "a failed script (%s) says why, offers a retry or the app, and Deactivate stays disabled",
            async (reason) => {
                mockGoogleBehaviour = { kind: "reject", reason };
                render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);

                expect(await screen.findByTestId("clariva-deactivate-google-unavailable")).toBeInTheDocument();
                expect(unavailable()).toHaveTextContent(authStrings.googleUnavailableTitle);
                expect(bodyOf()).toBe(`${reasonTexts[reason]} ${authStrings.deactivateGoogleUnavailableRetry}`);
                // a retry button next to "can't be deactivated from the web" used to contradict itself
                expect(bodyOf()).not.toMatch(/can't be deactivated from the web/);
                expect(screen.getByTestId("clariva-deactivate-google-unavailable-retry")).toBeInTheDocument();
                expect(screen.queryByTestId("clariva-deactivate-google")).toBeNull();
                expect(screen.queryByLabelText("Confirm password")).toBeNull(); // a Google account has no password
                expect(primary()).toBeDisabled();
            },
        );

        it("a button that draws nothing is reported the same way", async () => {
            mockGoogleBehaviour = { kind: "notDrawn", reason: "render_failed" };
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google-unavailable");
            expect(bodyOf()).toBe(
                `${authStrings.googleUnavailableRender} ${authStrings.deactivateGoogleUnavailableRetry}`,
            );
            expect(primary()).toBeDisabled();
        });

        it("Google not configured on this deployment: says so, no retry (nothing to retry), no attempt", async () => {
            mockGoogleConfigured = false;
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);

            await screen.findByTestId("clariva-deactivate-google-unavailable");
            expect(bodyOf()).toBe(authStrings.deactivateGoogleUnavailable);
            expect(bodyOf()).toContain("isn't set up on this site");
            expect(bodyOf()).not.toMatch(/try again/i);
            expect(screen.queryByTestId("clariva-deactivate-google-unavailable-retry")).toBeNull();
            expect(screen.queryByTestId("clariva-deactivate-google")).toBeNull();
            expect(mockGoogleRenders).toHaveLength(0); // never even tried to load Google
            expect(primary()).toBeDisabled();
        });

        it.each([
            [true, "script_blocked"],
            [false, undefined],
        ] as const)("the body never starts by repeating the title (configured: %s)", async (configured, reason) => {
            mockGoogleConfigured = configured;
            if (reason) mockGoogleBehaviour = { kind: "reject", reason };
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google-unavailable");
            const title = unavailable().querySelector(".mx_ClarivaAuth_googleNoticeTitle")!.textContent ?? "";
            expect(title).toBe(authStrings.googleUnavailableTitle);
            expect(bodyOf().startsWith(title)).toBe(false);
            expect(bodyOf()).not.toContain(title);
        });

        it("only the text is a live region; the retry button is a sibling outside it", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_timeout" };
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google-unavailable");

            const region = within(unavailable()).getByRole("status");
            const retry = screen.getByTestId("clariva-deactivate-google-unavailable-retry");
            expect(region).toHaveTextContent(authStrings.googleUnavailableTitle);
            expect(region).not.toContainElement(retry);
            expect(unavailable()).toContainElement(retry);
        });

        it("the explanation and the Google button share the .mx_ClarivaDeactivate_google block (spaced by its gap)", async () => {
            const { container } = render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google");
            const block = container.querySelector(".mx_ClarivaDeactivate_google")!;
            expect(block).toContainElement(screen.getByText(authStrings.deactivateGoogleNotice));
            expect(block).toContainElement(screen.getByTestId("clariva-deactivate-google"));
        });

        it("Try again hands keyboard focus to the Google button it mounts", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google-unavailable");

            mockGoogleBehaviour = { kind: "ok" };
            const retry = screen.getByTestId("clariva-deactivate-google-unavailable-retry");
            retry.focus();
            fireEvent.click(retry);

            await waitFor(() => expect(screen.getByTestId("clariva-deactivate-google")).toBeInTheDocument());
            expect(screen.getByTestId("clariva-deactivate-google")).toHaveFocus();
        });

        it("a Google button that was there from the start does not take focus", async () => {
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google");
            await act(async () => {});
            expect(screen.getByTestId("clariva-deactivate-google")).not.toHaveFocus();
        });

        it("a button re-mounted by a rejected Google proof (401) does not steal focus after an earlier Try again", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            jest.spyOn(clarivaAuth, "deactivateAccount").mockRejectedValue(
                new ClarivaAuthError("Could not verify your identity", 401),
            );
            const user = userEvent.setup();
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google-unavailable");
            mockGoogleBehaviour = { kind: "ok" };
            fireEvent.click(screen.getByTestId("clariva-deactivate-google-unavailable-retry"));
            await waitFor(() => expect(screen.getByTestId("clariva-deactivate-google")).toHaveFocus());

            await act(async () => {
                mockGoogleOptions!.onCredential("fresh-google-token");
            });
            await user.click(primary()); // the server rejects the proof: the authorised line goes, the button is back
            await screen.findByTestId("clariva-deactivate-error");
            await waitFor(() => expect(screen.getByTestId("clariva-deactivate-google")).toBeInTheDocument());
            expect(screen.getByTestId("clariva-deactivate-google")).not.toHaveFocus();
        });

        it("Try again mounts the button afresh and the dialog can then be completed", async () => {
            mockGoogleBehaviour = { kind: "reject", reason: "script_blocked" };
            const deactivate = jest.spyOn(clarivaAuth, "deactivateAccount").mockResolvedValue();
            const user = userEvent.setup();
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await screen.findByTestId("clariva-deactivate-google-unavailable");
            expect(mockGoogleRenders).toHaveLength(1);

            mockGoogleBehaviour = { kind: "ok" };
            fireEvent.click(screen.getByTestId("clariva-deactivate-google-unavailable-retry")); // act-wrapped

            await waitFor(() => expect(screen.getByTestId("clariva-deactivate-google")).toBeInTheDocument());
            expect(screen.queryByTestId("clariva-deactivate-google-unavailable")).toBeNull();
            expect(mockGoogleRenders).toHaveLength(2);
            expect(primary()).toBeDisabled(); // still needs the fresh Google token

            await act(async () => {
                mockGoogleOptions!.onCredential("fresh-google-token");
            });
            expect(primary()).toBeEnabled();
            await user.click(primary());
            await waitFor(() => expect(deactivate).toHaveBeenCalled());
            expect(deactivate).toHaveBeenCalledWith({
                matrixUserId: userId,
                googleIdToken: "fresh-google-token",
                eraseData: false,
            });
        });

        it("a working Google button shows no notice", async () => {
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
            await waitFor(() => expect(mockGoogleOptions).toBeDefined());
            await act(async () => {});
            expect(screen.queryByTestId("clariva-deactivate-google-unavailable")).toBeNull();
            expect(screen.getByTestId("clariva-deactivate-google")).toBeInTheDocument();
        });

        it("an e-mail account is unaffected by Google being unavailable or unconfigured", async () => {
            jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(false);
            mockGoogleConfigured = false;
            const deactivate = jest.spyOn(clarivaAuth, "deactivateAccount").mockResolvedValue();
            const user = userEvent.setup();
            render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);

            await user.type(await screen.findByLabelText("Confirm password"), "my-password");
            expect(screen.queryByTestId("clariva-deactivate-google-unavailable")).toBeNull();
            expect(primary()).toBeEnabled();
            await user.click(primary());
            await waitFor(() =>
                expect(deactivate).toHaveBeenCalledWith({
                    matrixUserId: userId,
                    password: "my-password",
                    eraseData: false,
                }),
            );
        });
    });

    it("retries a failed re-auth lookup and offers a manual retry (Android got stuck)", async () => {
        jest.useFakeTimers();
        const lookup = jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(null);
        render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(5000);
        });
        expect(lookup).toHaveBeenCalledTimes(3);
        expect(screen.getByTestId("clariva-deactivate-lookup-failed")).toBeInTheDocument();
        expect(primary()).toBeDisabled(); // unknown account type never enables the button

        lookup.mockResolvedValue(false);
        await act(async () => {
            screen.getByText(authStrings.deactivateCheckRetry).click();
            await jest.advanceTimersByTimeAsync(10);
        });
        expect(screen.queryByTestId("clariva-deactivate-lookup-failed")).toBeNull();
    });

    it("warns that remaining credits are lost (spec 01 R-15)", async () => {
        jest.spyOn(clarivaAuth, "isGoogleAccount").mockResolvedValue(false);
        jest.spyOn(WalletStore.instance, "credits", "get").mockReturnValue(250);
        render(<ClarivaDeactivateDialog onFinished={jest.fn()} />);
        expect(await screen.findByTestId("clariva-deactivate-credits")).toHaveTextContent("250");
    });
});

describe("ClarivaForgotPasswordDialog: Google-created accounts", () => {
    it("says that Google accounts have no password and get no code, once the code step is waiting", async () => {
        jest.spyOn(clarivaAuth, "requestPasswordReset").mockResolvedValue();
        const user = userEvent.setup();
        render(<ClarivaForgotPasswordDialog initialEmail="jane@gmail.com" onFinished={jest.fn()} />);
        expect(screen.queryByTestId("clariva-forgot-google-hint")).toBeNull(); // nothing to explain before asking
        await user.click(screen.getByTestId("dialog-primary-button"));

        const hint = await screen.findByTestId("clariva-forgot-google-hint");
        expect(hint).toHaveTextContent(authStrings.forgotGoogleHint);
        expect(hint).toHaveTextContent(/Google accounts have no password/);
        expect(hint).toHaveTextContent(/no code is sent/);
        expect(hint).toHaveTextContent(/Sign in with Google/);
        // the real fields are still right there
        expect(screen.getByTestId("clariva-forgot-code")).toBeInTheDocument();
        expect(screen.getByTestId("clariva-forgot-password")).toBeInTheDocument();
    });

    describe("googleAvailable decides which hint the code step shows (same test id)", () => {
        const reachCodeStep = async (googleAvailable?: boolean): Promise<HTMLElement> => {
            jest.spyOn(clarivaAuth, "requestPasswordReset").mockResolvedValue();
            const user = userEvent.setup();
            render(
                <ClarivaForgotPasswordDialog
                    initialEmail="jane@gmail.com"
                    googleAvailable={googleAvailable}
                    onFinished={jest.fn()}
                />,
            );
            await user.click(screen.getByTestId("dialog-primary-button"));
            return screen.findByTestId("clariva-forgot-google-hint");
        };

        it("defaults to available: points at Sign in with Google", async () => {
            const hint = await reachCodeStep();
            expect(hint.textContent).toBe(authStrings.forgotGoogleHint);
            expect(hint.textContent).toBe(
                "Signed up with Google? Google accounts have no password, so no code is sent. Cancel and use Sign in with Google.",
            );
        });

        it("googleAvailable true: the same hint", async () => {
            expect((await reachCodeStep(true)).textContent).toBe(authStrings.forgotGoogleHint);
        });

        it("googleAvailable false: does not point at a button that is not there", async () => {
            const hint = await reachCodeStep(false);
            expect(hint.textContent).toBe(authStrings.forgotGoogleHintUnavailable);
            expect(hint.textContent).toContain("Clariva app");
            expect(hint.textContent).not.toBe(authStrings.forgotGoogleHint);
            expect(hint.textContent).not.toContain("Cancel and use Sign in with Google");
            // exactly one hint is on screen, and the real fields are still right there
            expect(screen.getAllByTestId("clariva-forgot-google-hint")).toHaveLength(1);
            expect(screen.getByTestId("clariva-forgot-code")).toBeInTheDocument();
        });

        it("no hint on the first step in either case (nothing to explain before asking)", () => {
            render(<ClarivaForgotPasswordDialog initialEmail="" googleAvailable={false} onFinished={jest.fn()} />);
            expect(screen.queryByTestId("clariva-forgot-google-hint")).toBeNull();
        });
    });

    it("keeps the hint through a resend, and drops it once the password was reset", async () => {
        const request = jest.spyOn(clarivaAuth, "requestPasswordReset").mockResolvedValue();
        jest.spyOn(clarivaAuth, "resetPassword").mockResolvedValue();
        const user = userEvent.setup();
        render(<ClarivaForgotPasswordDialog initialEmail="jane@example.com" onFinished={jest.fn()} />);
        await user.click(screen.getByTestId("dialog-primary-button"));
        await screen.findByTestId("clariva-forgot-google-hint");

        await user.click(screen.getByTestId("clariva-forgot-resend"));
        await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        expect(screen.getByTestId("clariva-forgot-google-hint")).toBeInTheDocument();

        await user.type(screen.getByTestId("clariva-forgot-code"), "123456");
        await user.type(screen.getByTestId("clariva-forgot-password"), "newpassword1");
        await user.click(screen.getByTestId("dialog-primary-button"));
        await screen.findByTestId("clariva-forgot-done");
        expect(screen.queryByTestId("clariva-forgot-google-hint")).toBeNull();
    });
});

describe("ClarivaGoogleRoleDialog copy and the 'no account' notice", () => {
    it("never says the choice can be changed later in Settings (false on web and on Android)", () => {
        const { rerender } = render(<ClarivaGoogleRoleDialog onFinished={jest.fn()} />);
        expect(screen.getByText(authStrings.googleRoleSubtitle)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/changed later|in Settings/i);

        rerender(<ClarivaGoogleRoleDialog email="j@gmail.com" onFinished={jest.fn()} />);
        expect(screen.getByText(authStrings.googleRoleSubtitleWithEmail("j@gmail.com"))).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/changed later|in Settings/i);
    });

    it.each<[boolean | undefined, boolean | undefined, boolean]>([
        // fromSignIn, isExisting, notice shown
        [true, false, true], // Sign in with Google, no account: continuing would quietly create one
        [true, true, false],
        [true, undefined, false], // an older server that did not say
        [false, false, false], // from "Create account": creating is what was asked for
        [false, true, false],
        [false, undefined, false],
        [undefined, false, false],
        [undefined, undefined, false],
    ])("fromSignIn %s, isExisting %s => notice shown: %s", (fromSignIn, isExisting, shown) => {
        render(
            <ClarivaGoogleRoleDialog
                email="j@gmail.com"
                fromSignIn={fromSignIn}
                isExisting={isExisting}
                onFinished={jest.fn()}
            />,
        );
        expect(!!screen.queryByTestId("clariva-role-no-account")).toBe(shown);
    });

    it("the notice names the address and says how to back out; Continue and Cancel behave as before", async () => {
        const onFinished = jest.fn();
        const user = userEvent.setup();
        render(<ClarivaGoogleRoleDialog email="j@gmail.com" fromSignIn isExisting={false} onFinished={onFinished} />);

        const notice = screen.getByTestId("clariva-role-no-account");
        expect(notice).toHaveTextContent("No Clariva account exists for j@gmail.com.");
        expect(notice).toHaveTextContent(/Continue to create one, or Cancel and pick another Google account\./);
        expect(screen.getByTestId("clariva-role-no")).toBeChecked(); // "No" stays preselected

        await user.click(screen.getByTestId("dialog-primary-button"));
        expect(onFinished).toHaveBeenLastCalledWith(true, false);
        await user.click(screen.getByTestId("dialog-cancel-button"));
        expect(onFinished).toHaveBeenLastCalledWith(false);
    });

    it("without an address the notice says 'this Google account'", () => {
        render(<ClarivaGoogleRoleDialog fromSignIn isExisting={false} onFinished={jest.fn()} />);
        expect(screen.getByTestId("clariva-role-no-account")).toHaveTextContent(
            "No Clariva account exists for this Google account.",
        );
    });

    describe("creating an account from the sign-in screen (the notice already names the address)", () => {
        it("the second paragraph is the email-less subtitle, so the address appears once", () => {
            const { container } = render(
                <ClarivaGoogleRoleDialog email="j@gmail.com" fromSignIn isExisting={false} onFinished={jest.fn()} />,
            );
            expect(screen.getByText(authStrings.googleRoleSubtitle)).toBeInTheDocument();
            expect(screen.queryByText(authStrings.googleRoleSubtitleWithEmail("j@gmail.com"))).toBeNull();
            expect(screen.getByTestId("clariva-role-no-account")).toHaveTextContent("j@gmail.com");
            expect(container.textContent?.split("j@gmail.com")).toHaveLength(2); // exactly one occurrence
        });

        it.each<[boolean | undefined, boolean | undefined]>([
            [true, true],
            [true, undefined],
            [false, false],
            [undefined, false],
            [undefined, undefined],
        ])("fromSignIn %s, isExisting %s keeps the address in the subtitle", (fromSignIn, isExisting) => {
            render(
                <ClarivaGoogleRoleDialog
                    email="j@gmail.com"
                    fromSignIn={fromSignIn}
                    isExisting={isExisting}
                    onFinished={jest.fn()}
                />,
            );
            expect(screen.getByText(authStrings.googleRoleSubtitleWithEmail("j@gmail.com"))).toBeInTheDocument();
        });

        it("'Continue' is NOT the default: a stray Enter cannot create an account; focus is on the preselected 'No'", async () => {
            const onFinished = jest.fn();
            const user = userEvent.setup();
            render(
                <ClarivaGoogleRoleDialog email="j@gmail.com" fromSignIn isExisting={false} onFinished={onFinished} />,
            );

            expect(screen.getByTestId("dialog-primary-button")).not.toHaveFocus();
            expect(screen.getByTestId("clariva-role-no")).toHaveFocus();
            expect(screen.getByTestId("clariva-role-no")).toBeChecked();

            await user.keyboard("{Enter}");
            expect(onFinished).not.toHaveBeenCalled();
            // creating is still one deliberate action away
            await user.click(screen.getByTestId("dialog-primary-button"));
            expect(onFinished).toHaveBeenCalledWith(true, false);
        });

        it.each<[string, boolean | undefined, boolean | undefined]>([
            ["from sign-up (creating is what was asked)", false, false],
            ["an existing account", true, true],
            ["an older server that did not say", true, undefined],
            ["no flow information", undefined, undefined],
        ])("%s: 'Continue' keeps the default focus", (_name, fromSignIn, isExisting) => {
            render(
                <ClarivaGoogleRoleDialog
                    email="j@gmail.com"
                    fromSignIn={fromSignIn}
                    isExisting={isExisting}
                    onFinished={jest.fn()}
                />,
            );
            expect(screen.getByTestId("dialog-primary-button")).toHaveFocus();
        });
    });
});
