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
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClarivaHttpError } from "../../src/clariva/api/http";
import RechargeDialog, { viewFor } from "../../src/clariva/components/wallet/RechargeDialog";
import { INITIAL_RECHARGE_STATE } from "../../src/clariva/wallet/rechargeMachine";
import { RechargeFlow } from "../../src/clariva/wallet/rechargeFlow";
import { FakeRazorpay, harness, type Harness } from "./rechargeHarness";

const isDisabled = (el: HTMLElement): boolean =>
    el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;

describe("<RechargeDialog />", () => {
    let h: Harness;
    let onFinished: jest.Mock;

    beforeEach(() => {
        FakeRazorpay.last = undefined;
        FakeRazorpay.all = [];
        FakeRazorpay.onOpen = undefined;
        h = harness();
        onFinished = jest.fn();
    });

    const renderDialog = (): void => {
        render(<RechargeDialog onFinished={onFinished} createFlow={() => new RechargeFlow(h.deps)} />);
    };
    const amount = (): HTMLInputElement => screen.getByLabelText("Amount");
    const rechargeButton = (): HTMLElement => screen.getByRole("button", { name: "Recharge" });

    it("viewFor maps the machine to the four bodies of the dialog", () => {
        expect(viewFor(INITIAL_RECHARGE_STATE)).toBe("form");
        expect(viewFor({ ...INITIAL_RECHARGE_STATE, phase: "checkoutOpen" })).toBe("form");
        expect(viewFor({ ...INITIAL_RECHARGE_STATE, phase: "cancelled" })).toBe("form");
        expect(viewFor({ ...INITIAL_RECHARGE_STATE, phase: "verifying" })).toBe("verifying");
        expect(viewFor({ ...INITIAL_RECHARGE_STATE, phase: "verifyFailed" })).toBe("verifyFailed");
        expect(viewFor({ ...INITIAL_RECHARGE_STATE, phase: "success" })).toBe("success");
    });

    it("shows the Android copy and the website's quick amounts", () => {
        renderDialog();
        expect(screen.getByText("Recharge Wallet")).toBeInTheDocument();
        expect(screen.getByText("Enter the number of credits to purchase.")).toBeInTheDocument();
        expect(amount()).toHaveAttribute("placeholder", "e.g. 500");
        for (const chip of ["100", "500", "1,000", "2,000"]) {
            expect(screen.getByRole("button", { name: chip })).toBeInTheDocument();
        }
        expect(screen.getByText("Secured by Razorpay · charged in INR")).toBeInTheDocument();
    });

    it("quick-pick chips fill the amount; Recharge is enabled only for a valid amount", async () => {
        renderDialog();
        expect(isDisabled(rechargeButton())).toBe(true);
        await userEvent.click(screen.getByRole("button", { name: "1,000" }));
        expect(amount()).toHaveValue("1000");
        expect(screen.getByRole("button", { name: "1,000" })).toHaveAttribute("aria-pressed", "true");
        expect(isDisabled(rechargeButton())).toBe(false);
    });

    it("the dialog keeps its markup: a labelled dialog, a group of toggle chips that are pressed one at a time", async () => {
        renderDialog();
        // BaseDialog: role=dialog named by its title, described by the lead line (restyled, not re-marked)
        const dialog = screen.getByRole("dialog", { name: "Recharge Wallet" });
        expect(dialog).toHaveAttribute("aria-describedby", "mx_ClarivaRecharge_desc");
        const group = screen.getByRole("group", { name: "Quick amounts" });
        const chips = within(group).getAllByRole("button");
        expect(chips.map((c) => c.textContent)).toEqual(["100", "500", "1,000", "2,000"]);
        // nothing is selected before the user picks (aria-pressed is "false", never missing)
        for (const chip of chips) {
            expect(chip).toHaveAttribute("aria-pressed", "false");
            expect(chip).not.toHaveClass("mx_ClarivaRecharge_chip_selected");
        }
        await userEvent.click(chips[1]);
        expect(chips[1]).toHaveAttribute("aria-pressed", "true");
        expect(chips[1]).toHaveClass("mx_ClarivaRecharge_chip_selected");
        await userEvent.click(chips[3]);
        expect(chips[1]).toHaveAttribute("aria-pressed", "false");
        expect(chips[1]).not.toHaveClass("mx_ClarivaRecharge_chip_selected");
        expect(chips[3]).toHaveAttribute("aria-pressed", "true");
        // typing a different amount deselects every chip
        await userEvent.clear(amount());
        await userEvent.type(amount(), "750");
        for (const chip of chips) expect(chip).toHaveAttribute("aria-pressed", "false");
    });

    it("the chips are 44px keyboard buttons: Tab reaches them and Space picks one", async () => {
        renderDialog();
        const chip = screen.getByRole("button", { name: "500" });
        chip.focus();
        await userEvent.keyboard(" ");
        expect(amount()).toHaveValue("500");
        expect(chip).toHaveAttribute("aria-pressed", "true");
    });

    it("the chips lock with the form while a payment is in flight", async () => {
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        await screen.findByText("Complete the payment in the Razorpay window.");
        for (const name of ["100", "500", "1,000", "2,000"]) {
            expect(screen.getByRole("button", { name })).toBeDisabled();
        }
        // the pill that takes the primary button's place is a status, not a button
        const progress = screen.getByText("Processing recharge...").closest(".mx_ClarivaRecharge_progress");
        expect(progress).toHaveAttribute("role", "status");
        expect(progress?.tagName).toBe("SPAN");
    });

    it("the success view is the animated seal in a status region, with the Done / Recharge again actions", async () => {
        h.verifyPayment.mockResolvedValue({ success: true, newBalance: 620 });
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        await screen.findByText("Complete the payment in the Razorpay window.");
        act(() => FakeRazorpay.last!.succeed());
        await screen.findByTestId("clariva-recharge-success");
        expect(screen.getByTestId("clariva-success")).toHaveAttribute("role", "status");
        expect(screen.getByTestId("clariva-success-seal")).toHaveClass("mx_ClarivaSuccess_seal_animate");
        await userEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it("accepts digits only and explains an amount outside 1 .. 100000", async () => {
        renderDialog();
        await userEvent.type(amount(), "1a0b");
        expect(amount()).toHaveValue("10");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();

        await userEvent.clear(amount());
        await userEvent.type(amount(), "0");
        expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount between ₹1 and ₹1,00,000.");
        expect(isDisabled(rechargeButton())).toBe(true);

        await userEvent.clear(amount());
        await userEvent.type(amount(), "100001");
        expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount between ₹1 and ₹1,00,000.");
        expect(isDisabled(rechargeButton())).toBe(true);
        expect(h.createOrder).not.toHaveBeenCalled();
    });

    it("Recharge creates one order, opens Razorpay and locks the form while it is open", async () => {
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());

        expect(await screen.findByText("Complete the payment in the Razorpay window.")).toBeInTheDocument();
        expect(h.createOrder).toHaveBeenCalledTimes(1);
        expect(h.createOrder).toHaveBeenCalledWith(500);
        expect(FakeRazorpay.last!.open).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Processing recharge...")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Recharge" })).not.toBeInTheDocument(); // replaced by the progress text
        expect(amount()).toBeDisabled();
    });

    it("pressing Enter twice quickly still creates a single order", async () => {
        renderDialog();
        await userEvent.type(amount(), "500{Enter}{Enter}");
        await screen.findByText("Complete the payment in the Razorpay window.");
        expect(h.createOrder).toHaveBeenCalledTimes(1);
    });

    it("closing the Razorpay window is a quiet info message, not an error", async () => {
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        await screen.findByText("Complete the payment in the Razorpay window.");

        act(() => FakeRazorpay.last!.options.modal.ondismiss());
        expect(await screen.findByTestId("clariva-recharge-cancelled")).toHaveTextContent(
            "Payment cancelled — you can try again.",
        );
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(isDisabled(rechargeButton())).toBe(false); // can try again
    });

    it("a declined payment is reported as a failure once the window is closed", async () => {
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        await screen.findByText("Complete the payment in the Razorpay window.");

        act(() => FakeRazorpay.last!.handlers["payment.failed"]({ error: { description: "Card declined" } }));
        expect(await screen.findByText("Recharge failed: Card declined")).toBeInTheDocument();
        act(() => FakeRazorpay.last!.options.modal.ondismiss());
        expect(await screen.findByTestId("clariva-recharge-failed")).toHaveTextContent(
            "Recharge failed: Card declined",
        );
    });

    it("an order that cannot be created shows the server's message", async () => {
        h.createOrder.mockRejectedValue(new ClarivaHttpError(404, "HTTP 404", "http", "User not found"));
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        expect(await screen.findByTestId("clariva-recharge-failed")).toHaveTextContent(
            "Recharge failed: User not found",
        );
        expect(FakeRazorpay.last).toBeUndefined();
    });

    it("a successful payment ends in 'Credits added' with the new balance", async () => {
        h.verifyPayment.mockResolvedValue({ success: true, newBalance: "620.00" }); // the string shape
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        await screen.findByText("Complete the payment in the Razorpay window.");

        act(() => FakeRazorpay.last!.succeed());
        expect(await screen.findByTestId("clariva-recharge-success")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Credits added" })).toBeInTheDocument();
        expect(screen.getByText("500 credits are now in your Clariva wallet.")).toBeInTheDocument();
        expect(screen.getByText("New balance: 620 credits")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Recharge again" }));
        expect(amount()).toHaveValue("");
        await userEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
        expect(onFinished).toHaveBeenCalled();
    });

    it("'payment went through but verification failed' offers a retry that does not create a second order", async () => {
        h.verifyPayment.mockRejectedValue(new ClarivaHttpError(400, "HTTP 400", "http", "Order ID mismatch"));
        renderDialog();
        await userEvent.type(amount(), "500");
        await userEvent.click(rechargeButton());
        await screen.findByText("Complete the payment in the Razorpay window.");

        act(() => FakeRazorpay.last!.succeed());
        const failed = await screen.findByTestId("clariva-recharge-verify-failed");
        expect(failed).toHaveTextContent("Payment went through, but confirmation didn’t complete.");
        expect(failed).toHaveTextContent("payment id pay_123");

        h.verifyPayment.mockReset();
        h.verifyPayment.mockResolvedValue({ success: true, newBalance: 700 });
        await userEvent.click(screen.getByRole("button", { name: "Retry confirmation" }));
        expect(await screen.findByText("New balance: 700 credits")).toBeInTheDocument();
        expect(h.createOrder).toHaveBeenCalledTimes(1);
        expect(FakeRazorpay.all).toHaveLength(1);
    });

    it("Cancel closes the dialog", async () => {
        renderDialog();
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onFinished).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(h.createOrder).not.toHaveBeenCalled());
    });
});
