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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Modal from "../../src/Modal";
import ToastStore from "../../src/stores/ToastStore";
import ErrorDialog from "../../src/components/views/dialogs/ErrorDialog";
import { ClarivaAuthPage } from "../../src/clariva/components/auth/ClarivaAuthPage";
import { ClarivaGoogleRoleDialog } from "../../src/clariva/components/auth/ClarivaGoogleRoleDialog";
import { ClarivaWalletApi } from "../../src/clariva/api/wallet";
import { ClarivaAuthError, clarivaAuth } from "../../src/clariva/session/ClarivaAuthService";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { ClarivaSession } from "../../src/clariva/session/ClarivaSession";
import { EMPTY_CONSULTANT_SETUP } from "../../src/clariva/session/consultantSetup";
import { ifscLookup, type IfscStatus } from "../../src/clariva/wallet/ifsc";
import { configureClariva } from "./helpers";

const serverConfig = { hsUrl: "https://matrix.clarivahub.com", isUrl: "", hsName: "clarivahub.com" };
const credentials = { matrixUserId: "@jane:clarivahub.com", accessToken: "syt_secret", deviceId: "DEV1" };
const user = { id: "u1", isConsultant: 1 as const };
const SBI: IfscStatus = { kind: "found", branch: { bank: "State Bank of India", branch: "Hajiganj", city: "Patna" } };

const submitButton = (): HTMLElement => screen.getByTestId("clariva-auth-submit");
const isDisabled = (el: HTMLElement): boolean =>
    el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;
const set = (testId: string, value: string): void => {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

describe("sign-up: optional payout setup for a consultant (Android 7e8f3c3e10 / 093714e02a)", () => {
    let onLoggedIn: jest.Mock;

    beforeEach(() => {
        configureClariva(); // no Google client id: the e-mail form only
        ClarivaSession.resetForTests();
        ToastStore.sharedInstance().reset();
        onLoggedIn = jest.fn().mockResolvedValue(undefined);
        jest.spyOn(clarivaAuth, "isUsernameAvailable").mockResolvedValue({ available: true });
        jest.spyOn(clarivaAuth, "isEmailAvailable").mockResolvedValue({ available: true });
        jest.spyOn(ifscLookup, "lookup").mockResolvedValue(SBI);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        ToastStore.sharedInstance().reset();
    });

    const renderSignUp = (): void => {
        render(<ClarivaAuthPage serverConfig={serverConfig} onLoggedIn={onLoggedIn} initialMode="signUp" />);
        set("clariva-auth-name", "Jane Doe");
        set("clariva-auth-email", "jane@example.com");
        set("clariva-auth-password", "12345678");
        set("clariva-auth-username", "jane");
    };
    const fillBank = (): void => {
        set("clariva-signup-account-holder", "Jane Doe");
        set("clariva-signup-bank-name", "State Bank of India");
        set("clariva-signup-account-number", "123456789012");
        set("clariva-signup-ifsc", "sbin0001234");
    };

    it("is revealed only by 'I am a consultant', and typed values survive switching it off and on", async () => {
        renderSignUp();
        expect(screen.queryByText("Set up payouts")).toBeNull();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        expect(screen.getByText("Set up payouts")).toBeInTheDocument();
        expect(screen.getByText("Optional")).toBeInTheDocument();
        // the name typed above is the account holder placeholder
        expect(screen.getByTestId("clariva-signup-account-holder")).toHaveAttribute("placeholder", "Jane Doe");

        set("clariva-signup-max-credits", "50");
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        expect(screen.queryByText("Set up payouts")).toBeNull();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        expect(screen.getByTestId("clariva-signup-max-credits")).toHaveValue("50");
    });

    it("a half-filled bank account or an invalid max credits blocks 'Create account', and says why", async () => {
        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        expect(isDisabled(submitButton())).toBe(false);

        set("clariva-signup-account-number", "123456789");
        expect(screen.getByTestId("clariva-signup-bank-incomplete")).toHaveTextContent(
            "Fill in all the bank fields (branch is optional), or leave them all empty.",
        );
        expect(isDisabled(submitButton())).toBe(true);
        set("clariva-signup-account-number", "");
        expect(isDisabled(submitButton())).toBe(false);

        set("clariva-signup-max-credits", "0");
        expect(screen.getByText("Enter a whole number from 1 to 100000")).toBeInTheDocument();
        expect(isDisabled(submitButton())).toBe(true);

        // a client never has the setup checked
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        expect(isDisabled(submitButton())).toBe(false);
    });

    it("an unknown IFSC blocks 'Create account' until the code is fixed", async () => {
        jest.spyOn(ifscLookup, "lookup").mockResolvedValue({ kind: "notFound" });
        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        fillBank();
        expect(
            await screen.findByText("No bank branch found for this IFSC. Please check the code."),
        ).toBeInTheDocument();
        expect(isDisabled(submitButton())).toBe(true);
    });

    it("a found IFSC fills in the bank and branch without overwriting what was typed", async () => {
        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        set("clariva-signup-bank-name", "SBI");
        set("clariva-signup-ifsc", "SBIN0001234");
        expect(await screen.findByText("State Bank of India · Hajiganj, Patna")).toBeInTheDocument();
        expect(screen.getByTestId("clariva-signup-bank-name")).toHaveValue("SBI");
        expect(screen.getByTestId("clariva-signup-branch")).toHaveValue("Hajiganj");
    });

    it("'Skip for now' hides the fields with a note, and 'Add now' brings them back", async () => {
        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        set("clariva-signup-account-number", "123"); // half typed: would block
        fireEvent.click(screen.getByTestId("clariva-signup-setup-skip"));
        expect(screen.getByTestId("clariva-signup-setup-skipped")).toHaveTextContent(
            "Payout setup skipped. You can add your chat rate and bank details later in Settings › Billing and payments.",
        );
        expect(isDisabled(submitButton())).toBe(false);
        fireEvent.click(screen.getByTestId("clariva-signup-setup-resume"));
        expect(screen.getByTestId("clariva-signup-account-number")).toHaveValue("");
    });

    it("after the account exists: saves the rate and the bank account in parallel, and signs in regardless", async () => {
        jest.spyOn(clarivaAuth, "signUpWithEmail").mockImplementation(async () => {
            ClarivaSession.instance.setAuthenticated("jwt-signup", user);
            return { credentials, user };
        });
        const updateUser = jest.spyOn(ClarivaWalletApi, "updateUser").mockResolvedValue({} as never);
        const saveBank = jest.spyOn(ClarivaWalletApi, "saveMyBankDetails").mockResolvedValue({} as never);
        const refresh = jest.spyOn(WalletStore.instance, "refreshBalance").mockResolvedValue(undefined);

        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        set("clariva-signup-max-credits", "50");
        fillBank();
        await waitFor(() => expect(isDisabled(submitButton())).toBe(false)); // the IFSC lookup answered
        expect(refresh).not.toHaveBeenCalled();
        fireEvent.click(submitButton());

        await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
        expect(updateUser).toHaveBeenCalledWith("@jane:clarivahub.com", { max_credits: 50 }, { timeoutMs: 10_000 });
        expect(saveBank).toHaveBeenCalledWith(
            "jwt-signup",
            {
                accountHolderName: "Jane Doe",
                bankName: "State Bank of India",
                accountNumber: "123456789012",
                ifscCode: "SBIN0001234",
                branchName: "Hajiganj", // filled in by the IFSC lookup
            },
            { timeoutMs: 10_000 },
        );
        // the JWT only existed to open the session (and to save the bank account, captured before)
        expect(ClarivaSession.instance.jwt).toBeNull();
        // the saved rate is re-read into the wallet store (its first read may predate the save)
        await waitFor(() => expect(refresh).toHaveBeenCalled());
        expect(ToastStore.sharedInstance().getToasts()).toHaveLength(0);
    });

    describe("the account was created but opening the session failed (status 0)", () => {
        const signUpThenNetworkFailure = (): void => {
            jest.spyOn(clarivaAuth, "signUpWithEmail").mockImplementation(async () => {
                ClarivaSession.instance.setAuthenticated("jwt-signup", user);
                throw new ClarivaAuthError("network", 0);
            });
        };
        const submitConsultant = async (): Promise<void> => {
            renderSignUp();
            fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
            set("clariva-signup-max-credits", "50");
            fillBank();
            await waitFor(() => expect(isDisabled(submitButton())).toBe(false));
            fireEvent.click(submitButton());
        };

        it("the automatic retry signs in AND saves the setup with the sign-up JWT", async () => {
            signUpThenNetworkFailure();
            jest.spyOn(clarivaAuth, "resumeMatrixSession").mockResolvedValue({ credentials, user });
            const updateUser = jest.spyOn(ClarivaWalletApi, "updateUser").mockResolvedValue({} as never);
            const saveBank = jest.spyOn(ClarivaWalletApi, "saveMyBankDetails").mockResolvedValue({} as never);

            await submitConsultant();

            await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
            expect(updateUser).toHaveBeenCalledWith("@jane:clarivahub.com", { max_credits: 50 }, { timeoutMs: 10_000 });
            expect(saveBank).toHaveBeenCalledWith(
                "jwt-signup",
                expect.objectContaining({ accountNumber: "123456789012" }),
                { timeoutMs: 10_000 },
            );
        });

        it("when the retry fails too, the sign-in dialog says the setup was not saved", async () => {
            signUpThenNetworkFailure();
            jest.spyOn(clarivaAuth, "resumeMatrixSession").mockRejectedValue(new ClarivaAuthError("still offline", 0));
            const createDialog = jest
                .spyOn(Modal, "createDialog")
                .mockImplementation((() => ({ finished: new Promise(() => {}), close: jest.fn() })) as never);

            await submitConsultant();

            await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
            const { container } = render(<>{createDialog.mock.calls[0][1]!.description}</>);
            expect(container.textContent).toContain("Your account was created. Please sign in to continue.");
            expect(container.textContent).toContain(
                "Account created, but your chat rate and bank details weren't saved. Please add them again later.",
            );
            expect(onLoggedIn).not.toHaveBeenCalled();
        });
    });

    it("a failed save never blocks signing in; it is reported once the user is in the app", async () => {
        jest.spyOn(clarivaAuth, "signUpWithEmail").mockImplementation(async () => {
            ClarivaSession.instance.setAuthenticated("jwt-signup", user);
            return { credentials, user };
        });
        jest.spyOn(ClarivaWalletApi, "updateUser").mockRejectedValue(new Error("offline"));
        jest.spyOn(ClarivaWalletApi, "saveMyBankDetails").mockResolvedValue({} as never);
        const refresh = jest.spyOn(WalletStore.instance, "refreshBalance").mockResolvedValue(undefined);

        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        set("clariva-signup-max-credits", "50");
        fillBank();
        await waitFor(() => expect(isDisabled(submitButton())).toBe(false));
        fireEvent.click(submitButton());

        await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
        await waitFor(() => expect(ToastStore.sharedInstance().getToasts()).toHaveLength(1));
        expect(ToastStore.sharedInstance().getToasts()[0].props?.description).toBe(
            "Account created, but your chat rate wasn't saved. Set it in Settings › Billing and payments.",
        );
        // a rate that was not saved has nothing new for the wallet store
        expect(refresh).not.toHaveBeenCalled();
    });

    it("opening the session fails after the save started (JWT already dropped): the dialog says what was not saved", async () => {
        jest.spyOn(clarivaAuth, "signUpWithEmail").mockImplementation(async () => {
            ClarivaSession.instance.setAuthenticated("jwt-signup", user);
            return { credentials, user };
        });
        jest.spyOn(ClarivaWalletApi, "updateUser").mockRejectedValue(new Error("offline"));
        onLoggedIn.mockRejectedValue(new Error("Could not start the client"));
        const createDialog = jest
            .spyOn(Modal, "createDialog")
            .mockImplementation((() => ({ finished: new Promise(() => {}), close: jest.fn() })) as never);

        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        set("clariva-signup-max-credits", "50");
        fireEvent.click(submitButton());

        await waitFor(() => expect(createDialog).toHaveBeenCalledWith(ErrorDialog, expect.anything()));
        // complete() dropped the JWT, so this is not the half-sign-up path: the plain failure dialog
        expect(ClarivaSession.instance.jwt).toBeNull();
        const { container } = render(<>{createDialog.mock.calls[0][1]!.description}</>);
        expect(container.textContent).toContain("Could not start the client");
        expect(container.textContent).toContain(
            "Account created, but your chat rate wasn't saved. Set it in Settings › Billing and payments.",
        );
        // the client never started: the dialog carries it, not a toast
        expect(ToastStore.sharedInstance().getToasts()).toHaveLength(0);
    });

    it("nothing is saved for a client, or when the setup was skipped", async () => {
        const signUp = jest.spyOn(clarivaAuth, "signUpWithEmail").mockResolvedValue({ credentials, user });
        const updateUser = jest.spyOn(ClarivaWalletApi, "updateUser");
        const saveBank = jest.spyOn(ClarivaWalletApi, "saveMyBankDetails");
        renderSignUp();
        fireEvent.click(screen.getByTestId("clariva-auth-consultant"));
        set("clariva-signup-max-credits", "50");
        fireEvent.click(screen.getByTestId("clariva-auth-consultant")); // a client after all
        fireEvent.click(submitButton());
        await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
        expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ isConsultant: false }));
        expect(updateUser).not.toHaveBeenCalled();
        expect(saveBank).not.toHaveBeenCalled();
    });
});

describe("Google sign-up payout step (Android ClarivaGooglePayoutDialog)", () => {
    beforeEach(() => {
        configureClariva();
        jest.spyOn(ifscLookup, "lookup").mockResolvedValue(SBI);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const toPayoutStep = async (onFinished: jest.Mock, props: Record<string, unknown> = {}): Promise<void> => {
        render(<ClarivaGoogleRoleDialog email="j@gmail.com" name="Jane G" onFinished={onFinished} {...props} />);
        await userEvent.click(screen.getByTestId("clariva-role-yes"));
        await userEvent.click(screen.getByTestId("dialog-primary-button"));
    };

    it("asks for the same optional fields, with Google's name as the holder hint", async () => {
        const onFinished = jest.fn();
        await toPayoutStep(onFinished);
        expect(screen.getByText("Set up payouts")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Signing up j@gmail.com as a consultant. Add your chat rate and the bank account you're paid into, or skip and do it later in Settings.",
            ),
        ).toBeInTheDocument();
        expect(screen.getByTestId("clariva-signup-account-holder")).toHaveAttribute("placeholder", "Jane G");
        // its own Skip sits next to Continue; there is no inline one
        expect(screen.queryByTestId("clariva-signup-setup-skip")).toBeNull();
        expect(screen.getByTestId("dialog-cancel-button")).toHaveTextContent("Skip for now");
    });

    it("Back returns to the role question with 'Yes' still selected, creating nothing", async () => {
        const onFinished = jest.fn();
        await toPayoutStep(onFinished);
        await userEvent.click(screen.getByTestId("clariva-google-payout-back"));
        expect(screen.getByText("Are you a consultant?")).toBeInTheDocument();
        expect(screen.getByTestId("clariva-role-yes")).toBeChecked();
        expect(onFinished).not.toHaveBeenCalled();
    });

    it("Escape on the payout step is Back: the role question again, 'Yes' kept, nothing created", async () => {
        const onFinished = jest.fn();
        await toPayoutStep(onFinished);
        fireEvent.keyDown(screen.getByTestId("clariva-signup-max-credits"), { key: "Escape" });
        expect(screen.getByText("Are you a consultant?")).toBeInTheDocument();
        expect(screen.getByTestId("clariva-role-yes")).toBeChecked();
        expect(onFinished).not.toHaveBeenCalled();
    });

    it("Skip for now creates the consultant without payout details", async () => {
        const onFinished = jest.fn();
        await toPayoutStep(onFinished);
        await userEvent.click(screen.getByTestId("dialog-cancel-button"));
        expect(onFinished).toHaveBeenCalledWith(true, true, null);
    });

    it("Continue is disabled for a half-filled account, and hands back what was typed when valid", async () => {
        const onFinished = jest.fn();
        await toPayoutStep(onFinished);
        set("clariva-signup-account-number", "123456789");
        expect(isDisabled(screen.getByTestId("dialog-primary-button"))).toBe(true);
        set("clariva-signup-account-holder", "Jane G");
        set("clariva-signup-bank-name", "SBI");
        set("clariva-signup-ifsc", "SBIN0001234");
        set("clariva-signup-max-credits", "75");
        await waitFor(() => expect(isDisabled(screen.getByTestId("dialog-primary-button"))).toBe(false));
        await userEvent.click(screen.getByTestId("dialog-primary-button"));
        expect(onFinished).toHaveBeenCalledWith(
            true,
            true,
            expect.objectContaining({
                maxCredits: "75",
                accountNumber: "123456789",
                bankName: "SBI",
                branchName: "Hajiganj",
            }),
        );
    });

    it("values typed on the e-mail form carry over, and a 'skipped' left over from it does not hide the fields", async () => {
        const onFinished = jest.fn();
        await toPayoutStep(onFinished, {
            initialSetup: { ...EMPTY_CONSULTANT_SETUP, isSkipped: true, maxCredits: "20" },
        });
        expect(screen.getByTestId("clariva-signup-max-credits")).toHaveValue("20");
    });

    it("a client is never asked about payouts", async () => {
        const onFinished = jest.fn();
        render(<ClarivaGoogleRoleDialog onFinished={onFinished} />);
        await userEvent.click(screen.getByTestId("dialog-primary-button"));
        expect(onFinished).toHaveBeenCalledWith(true, false);
    });
});
