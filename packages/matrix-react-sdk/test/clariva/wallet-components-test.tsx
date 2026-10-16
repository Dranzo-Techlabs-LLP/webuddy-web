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

import SdkConfig from "../../src/SdkConfig";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import { UserTab } from "../../src/components/views/dialogs/UserTab";
import { ClarivaHttpError } from "../../src/clariva/api/http";
import { type WalletTransaction } from "../../src/clariva/api/types";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { WalletChip, chipText } from "../../src/clariva/components/wallet/WalletChip";
import { BalanceHeader, canRecharge } from "../../src/clariva/components/wallet/WalletTab";
import MaxCreditsEditor from "../../src/clariva/components/wallet/MaxCreditsEditor";
import BankDetailsForm, { describeBankError } from "../../src/clariva/components/wallet/BankDetailsForm";
import { TransactionList } from "../../src/clariva/components/wallet/TransactionList";
import TransactionDetailDialog, {
    transactionDetailRows,
} from "../../src/clariva/components/wallet/TransactionDetailDialog";
import { useClarivaWalletTabs } from "../../src/clariva/components/wallet/walletTabs";
import { type HistoryState } from "../../src/clariva/wallet/historyModel";
import { ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

const enc = encodeURIComponent;

/** Compound buttons are disabled with `aria-disabled` (no `disabled` attribute, so they stay keyboard-discoverable). */
const isDisabled = (el: HTMLElement): boolean =>
    el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;

// ───────────────────────────── chip ─────────────────────────────

describe("<WalletChip />", () => {
    beforeEach(() => {
        configureClariva();
        WalletStore.resetForTests();
    });

    afterEach(() => {
        WalletStore.resetForTests();
        jest.restoreAllMocks();
    });

    it("chipText: Loading... until the first balance, never an invented 0", () => {
        expect(chipText(null, false)).toBe("Loading...");
        expect(chipText(0, false)).toBe("Loading...");
        expect(chipText(null, true)).toBe("Loading...");
        expect(chipText(0, true)).toBe("0 credits");
        expect(chipText(1195, true)).toBe("1195 credits");
        expect(chipText(99.99, true)).toBe("99.99 credits");
    });

    it("renders nothing when Clariva is not configured", () => {
        SdkConfig.reset();
        const { container } = render(<WalletChip />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows Loading... and then 'N credits'", async () => {
        let answer: (r: Response) => void = () => {};
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => new Promise<Response>((resolve) => (answer = resolve)),
        });
        WalletStore.instance.start(ME);
        render(<WalletChip />);

        const chip = screen.getByRole("button", { name: /Wallet/ });
        expect(chip).toHaveTextContent("Loading...");

        await act(async () => {
            answer(mockResponse(200, walletUser({ current_hold: "1195.00" })));
        });
        await waitFor(() => expect(chip).toHaveTextContent("1195 credits"));
        expect(chip).toHaveAccessibleName("Wallet, 1195 credits");
    });

    it("every role sees a balance; a consultant's chip says it is the earnings balance", async () => {
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () =>
                mockResponse(200, walletUser({ isConsultant: 1, current_hold: "300.00" })),
            "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
        });
        WalletStore.instance.start(ME);
        render(<WalletChip />);
        const chip = screen.getByTestId("clariva-wallet-chip");
        await waitFor(() => expect(chip).toHaveTextContent("300 credits"));
        expect(chip).toHaveAttribute("title", "Wallet - your earnings balance");
    });

    it("clicking it opens the Wallet tab of the settings dialog", async () => {
        installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()) });
        WalletStore.instance.start(ME);
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<WalletChip />);
        await userEvent.click(screen.getByTestId("clariva-wallet-chip"));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewUserSettings, initialTabId: UserTab.Wallet }),
        );
    });

    it("collapses to an icon (with the full text as its tooltip) in a minimized left panel", async () => {
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ current_hold: "50.00" })),
        });
        WalletStore.instance.start(ME);
        render(<WalletChip isMinimized />);
        const chip = screen.getByTestId("clariva-wallet-chip");
        expect(chip).not.toHaveTextContent(/credits|Loading/);
        await waitFor(() => expect(chip).toHaveAttribute("title", expect.stringContaining("50 credits")));
    });
});

// ───────────────────────────── Wallet tab: Recharge visibility ─────────────────────────────

describe("<BalanceHeader /> role rules (spec 02 section 3.1 / 6.6)", () => {
    const base = { credits: 120, loaded: true, balanceFailed: false, onRecharge: jest.fn(), onRetry: jest.fn() };

    it("canRecharge: hidden only when the role is CONFIRMED consultant", () => {
        expect(canRecharge(false)).toBe(true);
        expect(canRecharge(null)).toBe(true); // unknown: shown, like Android
        expect(canRecharge(true)).toBe(false);
    });

    it("a client sees 'Add credits'", async () => {
        const onRecharge = jest.fn();
        render(<BalanceHeader {...base} isConsultant={false} onRecharge={onRecharge} />);
        await userEvent.click(screen.getByRole("button", { name: "Add credits" }));
        expect(onRecharge).toHaveBeenCalledTimes(1);
    });

    it("a consultant NEVER sees Add credits, but still sees the balance", () => {
        render(<BalanceHeader {...base} isConsultant={true} />);
        expect(screen.queryByRole("button", { name: /Recharge|Add credits/ })).not.toBeInTheDocument();
        expect(screen.getByText("Current Balance")).toBeInTheDocument();
        expect(screen.getByText("120 credits")).toBeInTheDocument();
    });

    it("an unknown role still shows the button (fail open) until the role is known", () => {
        render(<BalanceHeader {...base} credits={null} loaded={false} isConsultant={null} />);
        expect(screen.getByRole("button", { name: "Add credits" })).toBeInTheDocument();
        expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("a failed first load says so (with Retry) instead of showing 0 credits", async () => {
        const onRetry = jest.fn();
        render(
            <BalanceHeader
                {...base}
                credits={null}
                loaded={false}
                balanceFailed={true}
                isConsultant={false}
                onRetry={onRetry}
            />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent("Balance unavailable");
        expect(screen.queryByText(/0 credits/)).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("keeps showing the last good balance when a later refresh failed", () => {
        render(<BalanceHeader {...base} balanceFailed={true} isConsultant={false} />);
        expect(screen.getByText("120 credits")).toBeInTheDocument();
        expect(screen.queryByText("Balance unavailable")).not.toBeInTheDocument();
    });

    it('adds a quiet hint under the balance: the rate for a client, "earnings" for a consultant, nothing while unknown', () => {
        const { rerender } = render(<BalanceHeader {...base} isConsultant={false} />);
        expect(screen.getByText("1 credit = ₹1")).toBeInTheDocument();
        rerender(<BalanceHeader {...base} isConsultant={true} />);
        expect(screen.getByText("Your earnings balance")).toBeInTheDocument();
        expect(screen.queryByText("1 credit = ₹1")).not.toBeInTheDocument();
        rerender(<BalanceHeader {...base} isConsultant={null} />);
        expect(screen.queryByText("Your earnings balance")).not.toBeInTheDocument();
        expect(screen.queryByText("1 credit = ₹1")).not.toBeInTheDocument();
    });

    it("formats a large balance with grouping", () => {
        render(<BalanceHeader {...base} credits={1234567} isConsultant={false} />);
        expect(screen.getByText(/1,234,567 credits|1.234.567 credits|12,34,567 credits/)).toBeInTheDocument();
    });
});

// ───────────────────────────── settings tabs ─────────────────────────────

describe("useClarivaWalletTabs", () => {
    function Probe(): JSX.Element {
        const tabs = useClarivaWalletTabs();
        return (
            <ul>
                {tabs.map((t) => (
                    <li key={t.id}>{t.id}</li>
                ))}
            </ul>
        );
    }

    beforeEach(() => {
        configureClariva();
        WalletStore.resetForTests();
    });

    afterEach(() => WalletStore.resetForTests());

    it("adds nothing when Clariva is not configured", () => {
        SdkConfig.reset();
        const { container } = render(<Probe />);
        expect(container.querySelectorAll("li")).toHaveLength(0);
    });

    it("Wallet for everyone; Billing and Payments hidden while the role is unknown", () => {
        installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => new Promise<Response>(() => {}) });
        WalletStore.instance.start(ME);
        render(<Probe />);
        expect(screen.getByText(UserTab.Wallet)).toBeInTheDocument();
        expect(screen.queryByText(UserTab.Billing)).not.toBeInTheDocument();
    });

    it("a client never gets Billing and Payments", async () => {
        installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: 0 })) });
        WalletStore.instance.start(ME);
        render(<Probe />);
        await waitFor(() => expect(WalletStore.instance.isConsultant).toBe(false));
        expect(screen.queryByText(UserTab.Billing)).not.toBeInTheDocument();
    });

    it("a confirmed consultant gets Billing and Payments, as soon as the role is known", async () => {
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: 1 })),
            "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
        });
        WalletStore.instance.start(ME);
        render(<Probe />);
        expect(await screen.findByText(UserTab.Billing)).toBeInTheDocument();
        expect(screen.getByText(UserTab.Wallet)).toBeInTheDocument();
    });
});

// ───────────────────────────── Max Credits editor ─────────────────────────────

describe("<MaxCreditsEditor />", () => {
    const field = (): HTMLInputElement => screen.getByRole("textbox", { name: "Max Credits" });
    const save = (): HTMLElement | null => screen.queryByRole("button", { name: /^Sav/ });

    it("shows the saved value; Save/Cancel appear ONLY when the draft is dirty", async () => {
        render(<MaxCreditsEditor saved={100} save={jest.fn()} />);
        expect(field()).toHaveValue("100");
        expect(save()).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

        await userEvent.type(field(), "5");
        expect(field()).toHaveValue("1005");
        expect(save()).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

        await userEvent.clear(field());
        expect(save()).not.toBeInTheDocument(); // empty field hides Save/Cancel (Android)
        await userEvent.type(field(), "100");
        expect(save()).not.toBeInTheDocument(); // typed the saved value again: not dirty
    });

    it("accepts digits only", async () => {
        render(<MaxCreditsEditor saved={100} save={jest.fn()} />);
        await userEvent.clear(field());
        await userEvent.type(field(), "1a2-b3.");
        expect(field()).toHaveValue("123");
    });

    it("shows a spinner instead of the field while the saved value is unknown", () => {
        render(<MaxCreditsEditor saved={null} save={jest.fn()} />);
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(screen.getByText("Max Credits")).toBeInTheDocument();
    });

    it("Cancel restores the saved value and hides the buttons", async () => {
        render(<MaxCreditsEditor saved={100} save={jest.fn()} />);
        await userEvent.type(field(), "9");
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(field()).toHaveValue("100");
        expect(save()).not.toBeInTheDocument();
    });

    it("a poll (new saved value) never clobbers a dirty draft - the Android bug", async () => {
        const { rerender } = render(<MaxCreditsEditor saved={100} save={jest.fn()} />);
        await userEvent.clear(field());
        await userEvent.type(field(), "150");
        expect(field()).toHaveValue("150");

        rerender(<MaxCreditsEditor saved={120} save={jest.fn()} />); // the 15 s balance poll brought another value
        expect(field()).toHaveValue("150");
        expect(save()).toBeInTheDocument();

        rerender(<MaxCreditsEditor saved={150} save={jest.fn()} />); // ... or the server caught up
        expect(field()).toHaveValue("150");
        expect(save()).not.toBeInTheDocument();
    });

    it("an untouched field follows the polled value", () => {
        const { rerender } = render(<MaxCreditsEditor saved={100} save={jest.fn()} />);
        rerender(<MaxCreditsEditor saved={130} save={jest.fn()} />);
        expect(field()).toHaveValue("130");
    });

    it("Save sends the number, shows 'Max credits saved', and clears the success line when editing again", async () => {
        const doSave = jest.fn(async () => undefined);
        const { rerender } = render(<MaxCreditsEditor saved={100} save={doSave} />);
        await userEvent.clear(field());
        await userEvent.type(field(), "250");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(doSave).toHaveBeenCalledTimes(1);
        expect(doSave).toHaveBeenCalledWith(250);
        expect(await screen.findByText("Max credits saved")).toBeInTheDocument();

        rerender(<MaxCreditsEditor saved={250} save={doSave} />); // the store now reports the saved price
        expect(field()).toHaveValue("250");
        await userEvent.type(field(), "1");
        expect(screen.queryByText("Max credits saved")).not.toBeInTheDocument();
    });

    it("a failed save shows the error, keeps the draft and the Save button so the user can retry", async () => {
        const doSave = jest.fn(async () => {
            throw new ClarivaHttpError(500, "HTTP 500", "http");
        });
        render(<MaxCreditsEditor saved={100} save={doSave} />);
        await userEvent.clear(field());
        await userEvent.type(field(), "250");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(await screen.findByText("Couldn't save max credits. Please try again.")).toBeInTheDocument();
        expect(field()).toHaveValue("250");
        expect(isDisabled(screen.getByRole("button", { name: "Save" }))).toBe(false);

        await userEvent.type(field(), "0"); // editing clears the result line
        expect(screen.queryByText("Couldn't save max credits. Please try again.")).not.toBeInTheDocument();
    });

    it("shows 'Saving…' and ignores a second click while the request is in flight", async () => {
        let finish: () => void = () => {};
        const doSave = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
        render(<MaxCreditsEditor saved={100} save={doSave} />);
        await userEvent.type(field(), "1");
        const button = screen.getByRole("button", { name: "Save" });
        await userEvent.click(button);
        expect(isDisabled(await screen.findByRole("button", { name: "Saving…" }))).toBe(true);
        await userEvent.click(screen.getByRole("button", { name: "Saving…" }));
        expect(doSave).toHaveBeenCalledTimes(1);
        expect(isDisabled(screen.getByRole("button", { name: "Cancel" }))).toBe(true);
        finish();
        await waitFor(() => expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument());
    });

    it("the largest storable number (8 digits) can be saved", async () => {
        render(<MaxCreditsEditor saved={100} save={jest.fn()} />);
        await userEvent.clear(field());
        await userEvent.type(field(), "99999999999"); // the input stops at 8 digits, the largest the column can hold
        expect(field()).toHaveValue("99999999");
        expect(isDisabled(screen.getByRole("button", { name: "Save" }))).toBe(false);
    });
});

// ───────────────────────────── Bank details ─────────────────────────────

describe("<BankDetailsForm />", () => {
    const fill = async (): Promise<void> => {
        await userEvent.type(screen.getByLabelText("Bank Name"), "State Bank of India");
        await userEvent.type(screen.getByLabelText("Account Number"), "123456789012");
        await userEvent.type(screen.getByLabelText("IFSC Code"), "sbin0001234");
        await userEvent.type(screen.getByLabelText("Account Holder Name"), "A. Consultant");
        await userEvent.type(screen.getByLabelText("Branch Name"), "Main");
    };
    const saveButton = (): HTMLElement => screen.getByRole("button", { name: /Save Details|Saving…/ });

    it("has the five labelled fields, starts empty and cannot be saved", () => {
        render(<BankDetailsForm expertId={ME} save={jest.fn()} />);
        for (const label of ["Bank Name", "Account Number", "IFSC Code", "Account Holder Name", "Branch Name"]) {
            expect(screen.getByLabelText(label)).toHaveValue("");
        }
        expect(isDisabled(saveButton())).toBe(true);
    });

    it("sends the Matrix id as expertId with normalised values and reports success only on success", async () => {
        const save = jest.fn(async () => ({}));
        render(<BankDetailsForm expertId={ME} save={save} />);
        await fill();
        expect(isDisabled(saveButton())).toBe(false);
        await userEvent.click(saveButton());

        expect(save).toHaveBeenCalledWith({
            expertId: ME,
            bankName: "State Bank of India",
            accountNumber: "123456789012",
            ifscCode: "SBIN0001234",
            accountHolderName: "A. Consultant",
            branchName: "Main",
        });
        expect(await screen.findByTestId("clariva-bank-saved")).toHaveTextContent("Saved changes");
        // a double save would insert another row on the server: disabled until something changes
        expect(isDisabled(saveButton())).toBe(true);
        await userEvent.type(screen.getByLabelText("Branch Name"), "x");
        expect(isDisabled(saveButton())).toBe(false);
        expect(screen.queryByTestId("clariva-bank-saved")).not.toBeInTheDocument();
    });

    it("shows the server's message when it refuses (e.g. no experts row) and never pretends success", async () => {
        const message = `Expert with ID ${ME} not found`;
        const save = jest.fn(async () => {
            throw new ClarivaHttpError(404, `HTTP 404`, "http", message);
        });
        render(<BankDetailsForm expertId={ME} save={save} />);
        await fill();
        await userEvent.click(saveButton());

        expect(await screen.findByTestId("clariva-bank-error")).toHaveTextContent(`Error: ${message}`);
        expect(screen.queryByTestId("clariva-bank-saved")).not.toBeInTheDocument();
        expect(isDisabled(saveButton())).toBe(false); // the user can retry
    });

    it("describeBankError prefers the server message", () => {
        expect(describeBankError(new ClarivaHttpError(404, "HTTP 404", "http", "Expert not found"))).toBe(
            "Expert not found",
        );
        expect(describeBankError(new ClarivaHttpError(502, "HTTP 502 Bad Gateway", "http"))).toBe(
            "HTTP 502 Bad Gateway",
        );
        expect(describeBankError(new Error("boom"))).toBe("boom");
    });

    it("flags a malformed IFSC / account number after the field was visited", async () => {
        render(<BankDetailsForm expertId={ME} save={jest.fn()} />);
        await userEvent.type(screen.getByLabelText("IFSC Code"), "BAD");
        await userEvent.tab();
        expect(await screen.findByText(/IFSC codes are 11 characters/)).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText("Account Number"), "12ab");
        await userEvent.tab();
        expect(await screen.findByText("Account numbers contain digits only.")).toBeInTheDocument();
    });
});

// ───────────────────────────── transaction list + details ─────────────────────────────

describe("<TransactionList />", () => {
    const row = (overrides: Partial<WalletTransaction> = {}): WalletTransaction => ({
        id: "1",
        amount: "500.00",
        type: "CREDIT",
        source: "RECHARGE",
        status: "PAID",
        createdAt: "2026-06-12T08:31:02.000Z",
        providerOrderId: "order_X",
        providerPaymentId: "pay_Y",
        currency: "INR",
        provider: "RAZORPAY",
        ...overrides,
    });
    const state = (overrides: Partial<HistoryState> = {}): HistoryState => ({
        status: "ready",
        items: [],
        page: 1,
        totalPages: 1,
        error: null,
        errorWhileLoadingMore: false,
        ...overrides,
    });
    const handlers = (): { onLoadMore: jest.Mock; onRetry: jest.Mock; onSelect: jest.Mock } => ({
        onLoadMore: jest.fn(),
        onRetry: jest.fn(),
        onSelect: jest.fn(),
    });

    it("renders a list of rows with the label, date, signed amount and status chip rules", () => {
        const items = [
            row({ id: "3", type: "DEBIT", source: "HOLD", amount: "200.00" }),
            row({ id: "2", source: "HOLD_SETTLED", amount: "12.50" }),
            row({ id: "1", status: "FAILED" }),
        ];
        render(<TransactionList state={state({ items })} {...handlers()} />);
        expect(screen.getByRole("list")).toBeInTheDocument();
        expect(screen.getAllByRole("listitem")).toHaveLength(3);
        const rows = screen.getAllByTestId("clariva-txn-row");
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByText("Chat hold")).toBeInTheDocument();
        expect(within(rows[0]).getByText("200 cr")).toBeInTheDocument();
        expect(within(rows[0]).getByText("Debit")).toBeInTheDocument(); // accessible direction
        expect(rows[0].querySelector(".mx_ClarivaTxn_date")).toHaveTextContent(/2026/); // the date is part of the row
        expect(within(rows[1]).getByText("Earnings")).toBeInTheDocument();
        expect(within(rows[1]).getByText("12.50 cr")).toBeInTheDocument();
        expect(within(rows[1]).getByText("Credit")).toBeInTheDocument();
        expect(within(rows[2]).getByText("Failed")).toHaveClass("mx_ClarivaTxn_status_critical");
        expect(within(rows[1]).getByText("Paid")).toHaveClass("mx_ClarivaTxn_status_success");
    });

    it("signs the amount in text as well as colour (+ for money in, a minus for money out)", () => {
        const items = [
            row({ id: "2", type: "DEBIT", source: "HOLD", amount: "150.00" }),
            row({ id: "1", amount: "1195.00" }),
        ];
        render(<TransactionList state={state({ items })} {...handlers()} />);
        const [debit, credit] = screen.getAllByTestId("clariva-txn-row");
        expect(debit.querySelector(".mx_ClarivaTxn_sign")).toHaveTextContent("−");
        expect(debit.querySelector(".mx_ClarivaTxn_amount")).toHaveClass("mx_ClarivaTxn_amount_debit");
        expect(credit.querySelector(".mx_ClarivaTxn_sign")).toHaveTextContent("+");
        expect(credit.querySelector(".mx_ClarivaTxn_amount")).toHaveClass("mx_ClarivaTxn_amount_credit");
    });

    it("credit and debit differ without colour: a glyph tile, a hidden direction word and the sign", () => {
        const items = [
            row({ id: "2", type: "DEBIT", source: "HOLD", amount: "150.00" }),
            row({ id: "1", amount: "1195.00" }),
        ];
        render(<TransactionList state={state({ items })} {...handlers()} />);
        const [debit, credit] = screen.getAllByTestId("clariva-txn-row");
        // the icon tile carries the colour class AND a word for assistive technology
        expect(debit.querySelector(".mx_ClarivaTxn_icon")).toHaveClass("mx_ClarivaTxn_debit");
        expect(credit.querySelector(".mx_ClarivaTxn_icon")).toHaveClass("mx_ClarivaTxn_credit");
        expect(within(debit).getByText("Debit")).toHaveClass("mx_ClarivaVisuallyHidden");
        expect(within(credit).getByText("Credit")).toHaveClass("mx_ClarivaVisuallyHidden");
        // the sign is decorative for a screen reader (the amount text and the direction word say it) but visible on screen
        expect(debit.querySelector(".mx_ClarivaTxn_sign")).toHaveAttribute("aria-hidden", "true");
        expect(credit.querySelector(".mx_ClarivaTxn_sign")).toHaveAttribute("aria-hidden", "true");
        expect(credit.querySelector(".mx_ClarivaTxn_amount")).toHaveTextContent("+1195 cr");
        expect(debit.querySelector(".mx_ClarivaTxn_amount")).toHaveTextContent("−150 cr");
        // each row is ONE native button (one tab stop), titled for the details it opens
        expect(debit.tagName).toBe("BUTTON");
        expect(debit).toHaveAttribute("title", "View details");
    });

    it("the amount, the date and the label are three separate elements, so the stylesheet can right-align the numbers", () => {
        render(<TransactionList state={state({ items: [row()] })} {...handlers()} />);
        const r = screen.getByTestId("clariva-txn-row");
        expect(r.querySelector(".mx_ClarivaTxn_main .mx_ClarivaTxn_label")).not.toBeNull();
        expect(r.querySelector(".mx_ClarivaTxn_main .mx_ClarivaTxn_date")).not.toBeNull();
        expect(r.querySelector(".mx_ClarivaTxn_side .mx_ClarivaTxn_amount")).not.toBeNull();
        expect(r.querySelector(".mx_ClarivaTxn_side .mx_ClarivaTxn_status")).not.toBeNull();
    });

    it("the loading skeleton is the shared Skeleton primitive (the pulse comes from .cg-pulse), hidden from assistive technology", () => {
        render(<TransactionList state={state({ status: "loading" })} {...handlers()} />);
        const blocks = screen.getAllByTestId("clariva-skeleton");
        expect(blocks.length).toBeGreaterThanOrEqual(9); // 3 rows x (icon, label, date... + amount)
        for (const block of blocks) {
            expect(block).toHaveClass("cg-skeleton", "cg-pulse", "mx_ClarivaSkel");
            expect(block).toHaveAttribute("aria-hidden", "true");
        }
        // the list around them is hidden too, so a screen reader hears one "Loading..." and nothing else
        expect(screen.getByTestId("clariva-txns-loading").querySelector("ul")).toHaveAttribute("aria-hidden", "true");
        expect(screen.getByTestId("clariva-txns-loading").closest(".mx_ClarivaTxns")).toHaveAttribute(
            "aria-busy",
            "true",
        );
    });

    it("the empty state is an inline illustration (decorative) with a title and one line that invites the next step", () => {
        render(<TransactionList state={state()} {...handlers()} isConsultant={false} />);
        const empty = screen.getByTestId("clariva-txns-empty");
        expect(within(empty).getByTestId("clariva-empty-art")).toHaveAttribute("aria-hidden", "true");
        expect(within(empty).getByText("No transactions yet")).toHaveClass("mx_ClarivaTxns_emptyTitle");
        expect(empty.querySelector(".mx_ClarivaTxns_emptyHint")).toHaveTextContent(
            "Recharge your wallet to start chatting with consultants.",
        );
    });

    it("clicking (or pressing Enter on) a row selects it for the details dialog", async () => {
        const h = handlers();
        const items = [row({ id: "7" })];
        render(<TransactionList state={state({ items })} {...h} />);
        await userEvent.click(screen.getByTestId("clariva-txn-row"));
        expect(h.onSelect).toHaveBeenCalledWith(items[0]);
        screen.getByTestId("clariva-txn-row").focus();
        await userEvent.keyboard("{Enter}");
        expect(h.onSelect).toHaveBeenCalledTimes(2);
    });

    it("shows a spinner while the first page loads, not 'No transactions yet'", () => {
        render(<TransactionList state={state({ status: "loading" })} {...handlers()} />);
        expect(screen.getByTestId("clariva-txns-loading")).toBeInTheDocument();
        expect(screen.queryByText("No transactions yet")).not.toBeInTheDocument();
    });

    it("'No transactions yet' only for a successful, truly empty first page", () => {
        render(<TransactionList state={state()} {...handlers()} />);
        expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    });

    it("the empty state guides the user, with wording for the role", () => {
        const { rerender } = render(<TransactionList state={state()} {...handlers()} isConsultant={false} />);
        expect(screen.getByText("Recharge your wallet to start chatting with consultants.")).toBeInTheDocument();
        rerender(<TransactionList state={state()} {...handlers()} isConsultant={true} />);
        expect(screen.getByText("Earnings from your chats will show up here.")).toBeInTheDocument();
        rerender(<TransactionList state={state()} {...handlers()} isConsultant={null} />);
        expect(screen.getByText("Your recharges, chat holds and earnings will show up here.")).toBeInTheDocument();
    });

    it("the first load shows skeleton rows with an accessible status, not a blank card", () => {
        render(<TransactionList state={state({ status: "loading" })} {...handlers()} />);
        const loading = screen.getByTestId("clariva-txns-loading");
        expect(loading).toHaveAttribute("role", "status");
        expect(loading).toHaveTextContent("Loading...");
        expect(loading.querySelectorAll(".mx_ClarivaSkel").length).toBeGreaterThan(0);
    });

    it("a failed first load shows an error with Retry, never the empty text", async () => {
        const h = handlers();
        render(
            <TransactionList state={state({ status: "error", error: "Couldn't load your transactions." })} {...h} />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your transactions.");
        expect(screen.queryByText("No transactions yet")).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(h.onRetry).toHaveBeenCalledTimes(1);
    });

    it("offers 'Load more' only while another page exists, and hides it while loading", async () => {
        const h = handlers();
        const items = [row()];
        const { rerender } = render(<TransactionList state={state({ items, page: 1, totalPages: 3 })} {...h} />);
        await userEvent.click(screen.getByRole("button", { name: "Load more" }));
        expect(h.onLoadMore).toHaveBeenCalledTimes(1);

        rerender(<TransactionList state={state({ items, page: 1, totalPages: 3, status: "loadingMore" })} {...h} />);
        expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
        expect(screen.getByTestId("clariva-txns-loading-more")).toBeInTheDocument();

        rerender(<TransactionList state={state({ items, page: 3, totalPages: 3 })} {...h} />);
        expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("keeps the rows and adds an error with Retry when 'Load more' fails", () => {
        const items = [row()];
        render(
            <TransactionList
                state={state({
                    items,
                    page: 1,
                    totalPages: 3,
                    status: "error",
                    error: "offline",
                    errorWhileLoadingMore: true,
                })}
                {...handlers()}
            />,
        );
        expect(screen.getAllByTestId("clariva-txn-row")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("offline");
    });

    it("hides abandoned CREATED recharges and flags young ones as awaiting payment", () => {
        const now = Date.parse("2026-06-12T12:00:00.000Z");
        const items = [
            row({ id: "3", status: "CREATED", createdAt: new Date(now - 5 * 60_000).toISOString() }),
            row({ id: "2", status: "CREATED", createdAt: new Date(now - 3 * 3600_000).toISOString() }),
            row({ id: "1" }),
        ];
        render(<TransactionList state={state({ items })} {...handlers()} now={now} />);
        expect(screen.getAllByTestId("clariva-txn-row")).toHaveLength(2);
        expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
    });
});

describe("<TransactionDetailDialog />", () => {
    const txn: WalletTransaction = {
        id: "164",
        userId: "uuid",
        amount: "500.00",
        currency: "INR",
        type: "CREDIT",
        source: "RECHARGE",
        status: "PAID",
        provider: "RAZORPAY",
        providerOrderId: "order_ABC",
        providerPaymentId: "pay_XYZ",
        createdAt: "2026-06-12T08:31:02.000Z",
    };

    it("lists every ledger field the server sent, skipping the ones it did not", () => {
        const labels = transactionDetailRows(txn).map((r) => r.label);
        expect(labels).toEqual([
            "Transaction ID",
            "Date and time",
            "Date and time (UTC)",
            "Type",
            "Direction",
            "Source",
            "Amount",
            "Currency",
            "Status",
            "Payment provider",
            "Provider order ID",
            "Provider payment ID",
        ]);
        const sparse = transactionDetailRows({ amount: "5.00", type: "DEBIT", source: "HOLD", status: "PAID" });
        expect(sparse.map((r) => r.label)).toEqual(["Type", "Direction", "Source", "Amount", "Status"]);
        expect(transactionDetailRows(txn).find((r) => r.label === "Date and time (UTC)")?.value).toBe(
            "2026-06-12T08:31:02.000Z",
        );
    });

    it("renders the details, with copy buttons for the ids, and closes", async () => {
        const onFinished = jest.fn();
        render(<TransactionDetailDialog transaction={txn} onFinished={onFinished} />);
        const list = screen.getByTestId("clariva-txn-detail");
        expect(within(list).getByText("order_ABC")).toBeInTheDocument();
        expect(within(list).getByText("pay_XYZ")).toBeInTheDocument();
        expect(within(list).getByText("500 cr")).toBeInTheDocument();
        expect(within(list).getByText("Recharge")).toBeInTheDocument();
        expect(within(list).getByText("Paid")).toHaveClass("mx_ClarivaTxn_status_success");
        expect(within(list).getAllByRole("button", { name: "Copy" })).toHaveLength(3); // id, order id, payment id
        await userEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
        expect(onFinished).toHaveBeenCalled();
    });
});
