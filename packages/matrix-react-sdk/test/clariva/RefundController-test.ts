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
import { type PendingHoldStatus } from "../../src/clariva/api/types";
import {
    RefundController,
    RefundControllerEvent,
    canRequestRefund,
    showRefundBanner,
    type RefundApi,
    type RefundControllerDeps,
    type RefundToast,
} from "../../src/clariva/refund/RefundController";
import { type RefundMessageContent } from "../../src/clariva/refund/messages";
import { CLIENT, CONSULTANT, ME } from "./helpers";

/* eslint-disable camelcase */

const HOUR = 15_000;

/** Let queued promise continuations run (the controller chains several awaits per poll). */
const flush = async (rounds = 30): Promise<void> => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
};

const NO_HOLD: PendingHoldStatus = {
    exists: false,
    pendingHoldId: null,
    refund_status: "none",
    clientId: null,
    consultantId: null,
    amount: null,
    refundRequestId: null,
    pendingAutoApprovalNotification: null,
};

/** A live hold of 50 credits paid by ME to CONSULTANT, as `GET /v1/pending-holds/status` reports it. */
const hold = (overrides: Partial<PendingHoldStatus> = {}): PendingHoldStatus => ({
    exists: true,
    pendingHoldId: 17,
    refund_status: "none",
    clientId: ME,
    consultantId: CONSULTANT,
    amount: 50,
    refundRequestId: null,
    pendingAutoApprovalNotification: null,
    ...overrides,
});

const notification = (overrides: Record<string, unknown> = {}): PendingHoldStatus["pendingAutoApprovalNotification"] =>
    ({ refundRequestId: 9, amount: 50, clientId: ME, consultantId: CONSULTANT, ...overrides }) as any;

const httpError = (status: number, serverMessage?: string): ClarivaHttpError =>
    new ClarivaHttpError(status, serverMessage ?? `HTTP ${status}`, "http", serverMessage);
const networkError = (): ClarivaHttpError => new ClarivaHttpError(0, "Failed to fetch", "network");

interface Harness {
    controller: RefundController;
    api: { [K in keyof RefundApi]: jest.Mock };
    deps: RefundControllerDeps;
    sendMessage: jest.Mock;
    isConsultant: jest.Mock;
    refreshPendingRefunds: jest.Mock;
    toasts: RefundToast[];
}

function makeHarness(
    options: {
        me?: string;
        peer?: string;
        aliases?: Array<string | null>;
        billConsultantsOnly?: boolean;
        isConsultant?: boolean | null;
    } = {},
): Harness {
    const api = {
        holdStatus: jest.fn().mockResolvedValue(NO_HOLD),
        requestRefund: jest.fn().mockResolvedValue({ message: "Refund requested successfully", refundRequestId: 9 }),
        approveRefund: jest.fn().mockResolvedValue({
            message: "Refund approved and amount returned to client",
            amount: "50.00",
            toConsultant: 0,
            isAutomatic: false,
        }),
        rejectRefund: jest
            .fn()
            .mockResolvedValue({ message: "Refund rejected; funds will transfer to consultant after hold expiry" }),
        claimAutoApprovalNotification: jest.fn().mockResolvedValue({ claimed: false }),
    };
    const sendMessage = jest.fn().mockResolvedValue({ event_id: "$e" });
    const isConsultant = jest.fn().mockResolvedValue(options.isConsultant === undefined ? true : options.isConsultant);
    const refreshPendingRefunds = jest.fn().mockResolvedValue(undefined);
    const deps: RefundControllerDeps = {
        api: api as unknown as RefundApi,
        myUserId: options.me ?? ME,
        getOwnAliases: () => options.aliases ?? [],
        peerId: options.peer ?? CONSULTANT,
        sendMessage,
        isConsultant,
        refreshPendingRefunds,
        getPollIntervalMs: () => HOUR,
        billConsultantsOnly: () => options.billConsultantsOnly ?? true,
    };
    const controller = new RefundController(deps);
    const toasts: RefundToast[] = [];
    controller.on(RefundControllerEvent.Toast, (t) => toasts.push(t));
    return { controller, api, deps, sendMessage, isConsultant, refreshPendingRefunds, toasts };
}

/** A harness that already polled once and sees `status`. */
async function polled(status: PendingHoldStatus, options: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
    const h = makeHarness(options);
    h.api.holdStatus.mockResolvedValue(status);
    await h.controller.pollNow();
    return h;
}

describe("RefundController", () => {
    let hidden = false;
    const setHidden = (value: boolean): void => {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
    };
    const controllers: RefundController[] = [];

    beforeEach(() => {
        jest.useFakeTimers();
        hidden = false;
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    });

    afterEach(() => {
        controllers.splice(0).forEach((c) => c.dispose());
        delete (document as any).hidden;
        jest.useRealTimers();
    });

    const started = (h: Harness): Harness => {
        controllers.push(h.controller);
        h.controller.start();
        return h;
    };

    describe("poll loop", () => {
        it("polls immediately, then every hold_status_ms, asking for (me, peer) with an abort signal", async () => {
            const h = started(makeHarness());
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
            expect(h.api.holdStatus).toHaveBeenCalledWith(ME, CONSULTANT, { signal: expect.any(AbortSignal) });

            jest.advanceTimersByTime(HOUR - 1);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(1);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(2);
            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(3);
        });

        it("waits for a slow poll before scheduling the next one (rounds cannot pile up)", async () => {
            const h = makeHarness();
            let resolveSlow!: (s: PendingHoldStatus) => void;
            h.api.holdStatus.mockReturnValueOnce(new Promise<PendingHoldStatus>((r) => (resolveSlow = r)));
            started(h);
            await flush();
            jest.advanceTimersByTime(HOUR * 3);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1); // still waiting for the first answer

            resolveSlow(NO_HOLD);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(2);
        });

        it("is idempotent: a second start() does not start a second loop", async () => {
            const h = started(makeHarness());
            h.controller.start();
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(2);
        });

        it("pauses while the tab is hidden and polls again immediately when it comes back", async () => {
            const h = started(makeHarness());
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);

            setHidden(true);
            jest.advanceTimersByTime(HOUR * 10);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);

            setHidden(false);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(2); // immediately, not after the interval
            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(3);
        });

        it("does not poll at all when it starts in a hidden tab, until it becomes visible", async () => {
            hidden = true;
            const h = started(makeHarness());
            await flush();
            jest.advanceTimersByTime(HOUR * 2);
            await flush();
            expect(h.api.holdStatus).not.toHaveBeenCalled();
            setHidden(false);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
        });

        it("a poll that is still in flight when the tab is hidden does not schedule another", async () => {
            const h = makeHarness();
            let resolveSlow!: (s: PendingHoldStatus) => void;
            h.api.holdStatus.mockReturnValueOnce(new Promise<PendingHoldStatus>((r) => (resolveSlow = r)));
            started(h);
            await flush();
            setHidden(true);
            resolveSlow(NO_HOLD);
            await flush();
            jest.advanceTimersByTime(HOUR * 5);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
        });

        it("is cancelled on dispose: no more polls and the in-flight request is aborted", async () => {
            const h = started(makeHarness());
            await flush();
            const signal = h.api.holdStatus.mock.calls[0][2].signal as AbortSignal;
            h.controller.dispose();
            expect(signal.aborted).toBe(true);
            jest.advanceTimersByTime(HOUR * 5);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
            // and it no longer reacts to visibility changes
            setHidden(true);
            setHidden(false);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(1);
        });

        it("swallows errors, keeps the previous UI state and keeps polling", async () => {
            const h = makeHarness();
            h.api.holdStatus
                .mockResolvedValueOnce(
                    hold({ refund_status: "requested", refundRequestId: 9, consultantId: ME, clientId: CLIENT }),
                )
                .mockRejectedValueOnce(networkError())
                .mockRejectedValueOnce(httpError(500, "boom"))
                .mockResolvedValue(NO_HOLD);
            started(h);
            await flush();
            const before = h.controller.state;
            expect(showRefundBanner(before)).toBe(true);

            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(2);
            expect(h.controller.state).toBe(before); // untouched

            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.controller.state).toBe(before);

            jest.advanceTimersByTime(HOUR);
            await flush();
            expect(h.api.holdStatus).toHaveBeenCalledTimes(4);
            expect(showRefundBanner(h.controller.state)).toBe(false); // the next good answer applies
        });
    });

    describe("state derivation", () => {
        it("client with a live, un-requested hold: the request button shows", async () => {
            const h = await polled(hold());
            expect(h.controller.state).toEqual({
                isConsultantInThisRoom: false,
                refundStatus: "none",
                pendingHoldId: "17",
                refundRequestId: null,
                refundHeldAmount: 50,
                isRefundButtonVisible: true,
                isRequestInProgress: false,
            });
            expect(canRequestRefund(h.controller.state)).toBe(true);
            expect(showRefundBanner(h.controller.state)).toBe(false);
        });

        it("client whose request is already open: no button, no banner", async () => {
            const h = await polled(hold({ refund_status: "requested", refundRequestId: 9 }));
            expect(canRequestRefund(h.controller.state)).toBe(false);
            expect(showRefundBanner(h.controller.state)).toBe(false);
            expect(h.controller.state.refundRequestId).toBe("9");
        });

        it("consultant of the room: the banner shows only while the request is open", async () => {
            const h = await polled(hold({ clientId: CLIENT, consultantId: ME, refund_status: "none" }));
            expect(h.controller.state.isConsultantInThisRoom).toBe(true);
            expect(showRefundBanner(h.controller.state)).toBe(false);
            expect(canRequestRefund(h.controller.state)).toBe(false); // the consultant never requests

            h.api.holdStatus.mockResolvedValue(
                hold({
                    clientId: CLIENT,
                    consultantId: ME,
                    refund_status: "requested",
                    refundRequestId: 9,
                    amount: "12.50",
                }),
            );
            await h.controller.pollNow();
            expect(showRefundBanner(h.controller.state)).toBe(true);
            expect(h.controller.state.refundHeldAmount).toBe(12.5); // DECIMAL strings are parsed
            expect(h.controller.state.pendingHoldId).toBe("17");
        });

        it("compares the hold's consultant against BOTH the Matrix ID and the own Webuddy_name", async () => {
            const h = await polled(
                hold({
                    consultantId: "legacy-webuddy",
                    clientId: CLIENT,
                    refund_status: "requested",
                    refundRequestId: 4,
                }),
                {
                    aliases: [null, "legacy-webuddy"],
                    peer: CLIENT,
                },
            );
            expect(h.controller.state.isConsultantInThisRoom).toBe(true);
            expect(showRefundBanner(h.controller.state)).toBe(true);
        });

        it("exists:false resets everything, including isConsultantInThisRoom", async () => {
            const h = await polled(
                hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }),
                { peer: CLIENT },
            );
            expect(h.controller.state.isConsultantInThisRoom).toBe(true);

            h.api.holdStatus.mockResolvedValue(NO_HOLD);
            await h.controller.pollNow();
            expect(h.controller.state).toEqual({
                isConsultantInThisRoom: false,
                refundStatus: null,
                pendingHoldId: null,
                refundRequestId: null,
                refundHeldAmount: null,
                isRefundButtonVisible: false,
                isRequestInProgress: false,
            });
        });

        it("emits an update only when something actually changed", async () => {
            const h = makeHarness();
            const onUpdate = jest.fn();
            h.controller.on(RefundControllerEvent.Update, onUpdate);
            h.api.holdStatus.mockResolvedValue(hold());
            await h.controller.pollNow();
            expect(onUpdate).toHaveBeenCalledTimes(1);
            await h.controller.pollNow();
            expect(onUpdate).toHaveBeenCalledTimes(1);
        });

        describe("decision D5 (bill_consultants_only)", () => {
            it("hides the refund UI when the payee is known NOT to be a consultant", async () => {
                const h = await polled(hold(), { isConsultant: false });
                expect(h.isConsultant).toHaveBeenCalledWith(CONSULTANT);
                expect(h.controller.state.isRefundButtonVisible).toBe(false);
                expect(canRequestRefund(h.controller.state)).toBe(false);
                expect(h.controller.state.pendingHoldId).toBeNull();
            });

            it("hides the consultant banner too when I am the payee but not a consultant", async () => {
                const h = await polled(
                    hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }),
                    { peer: CLIENT, isConsultant: false },
                );
                expect(h.isConsultant).toHaveBeenCalledWith(ME);
                expect(showRefundBanner(h.controller.state)).toBe(false);
            });

            it("shows it when the payee is a consultant", async () => {
                const h = await polled(hold(), { isConsultant: true });
                expect(canRequestRefund(h.controller.state)).toBe(true);
            });

            it("fails open when the role is unknown (null) or the lookup throws", async () => {
                const unknown = await polled(hold(), { isConsultant: null });
                expect(canRequestRefund(unknown.controller.state)).toBe(true);

                const h = makeHarness();
                h.isConsultant.mockRejectedValue(new Error("boom"));
                h.api.holdStatus.mockResolvedValue(hold());
                await h.controller.pollNow();
                expect(canRequestRefund(h.controller.state)).toBe(true);
            });

            it("does not even ask when the switch is off, or when no hold exists", async () => {
                const off = await polled(hold(), { billConsultantsOnly: false, isConsultant: false });
                expect(off.isConsultant).not.toHaveBeenCalled();
                expect(canRequestRefund(off.controller.state)).toBe(true);

                const none = await polled(NO_HOLD);
                expect(none.isConsultant).not.toHaveBeenCalled();
            });
        });
    });

    describe("requestRefund", () => {
        it("posts (hold's client, hold's consultant, hold id), flips to requested at once, toasts and announces", async () => {
            const h = await polled(hold());
            const result = await h.controller.requestRefund();

            expect(h.api.requestRefund).toHaveBeenCalledWith({
                clientId: ME,
                consultantId: CONSULTANT,
                pendingHoldId: "17",
            });
            expect(result).toEqual({ ok: true, message: "Refund request sent" });
            expect(h.controller.state.refundStatus).toBe("requested");
            expect(canRequestRefund(h.controller.state)).toBe(false);
            expect(h.controller.state.isRequestInProgress).toBe(false);
            expect(h.toasts.map((t) => [t.text, t.kind])).toEqual([["Refund request sent", "success"]]);

            expect(h.sendMessage).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).toHaveBeenCalledWith({
                "msgtype": "m.text",
                "body": "Refund requested for the held credits",
                "m.mentions": {},
                "com.clariva.refund": { event: "requested", refund_request_id: 9 },
            });
        });

        it("treats any 2xx as success, even with an empty body (no `success` field: lesson L10)", async () => {
            const h = await polled(hold());
            h.api.requestRefund.mockResolvedValue(undefined);
            expect(await h.controller.requestRefund()).toEqual({ ok: true, message: "Refund request sent" });
            expect(h.controller.state.refundStatus).toBe("requested");
            // no id known -> the marker simply has no refund_request_id
            expect((h.sendMessage.mock.calls[0][0] as RefundMessageContent)["com.clariva.refund"]).toEqual({
                event: "requested",
            });
        });

        it("surfaces the SERVER message on failure and changes nothing", async () => {
            const h = await polled(hold());
            h.api.requestRefund.mockRejectedValue(httpError(400, "Refund has already been requested"));
            const result = await h.controller.requestRefund();
            expect(result).toEqual({ ok: false, message: "Refund has already been requested" });
            expect(h.controller.state.refundStatus).toBe("none");
            expect(canRequestRefund(h.controller.state)).toBe(true); // the button stays
            expect(h.controller.state.isRequestInProgress).toBe(false);
            expect(h.sendMessage).not.toHaveBeenCalled();
            expect(h.toasts.map((t) => [t.text, t.kind])).toEqual([["Refund has already been requested", "error"]]);
        });

        it("falls back to the generic `Error` when the failure carries no server message", async () => {
            const h = await polled(hold());
            h.api.requestRefund.mockRejectedValue(networkError());
            expect(await h.controller.requestRefund()).toEqual({ ok: false, message: "Error" });
            h.api.requestRefund.mockRejectedValue(new Error("anything"));
            expect(await h.controller.requestRefund()).toEqual({ ok: false, message: "Error" });
        });

        it("is ignored without a live hold", async () => {
            const h = await polled(NO_HOLD);
            const result = await h.controller.requestRefund();
            expect(result).toEqual({ ok: false, message: "", ignored: true });
            expect(h.api.requestRefund).not.toHaveBeenCalled();
            expect(h.toasts).toEqual([]);
        });

        it("a failed Matrix announcement never rolls back or fails the refund", async () => {
            const h = await polled(hold());
            h.sendMessage.mockRejectedValue(new Error("M_FORBIDDEN"));
            expect(await h.controller.requestRefund()).toEqual({ ok: true, message: "Refund request sent" });
            await flush();
            expect(h.controller.state.refundStatus).toBe("requested");

            const h2 = await polled(hold());
            h2.sendMessage.mockImplementation(() => {
                throw new Error("sync throw");
            });
            expect((await h2.controller.requestRefund()).ok).toBe(true);
        });
    });

    describe("approve", () => {
        const consultantRequested = (): PendingHoldStatus =>
            hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9, amount: 50 });

        it("FULL: omits refundAmount, flips state, toasts, refreshes the pills and announces", async () => {
            const h = await polled(consultantRequested(), { peer: CLIENT });
            const result = await h.controller.approve();

            expect(result).toEqual({ ok: true, message: "Refund approved" });
            expect(h.api.approveRefund).toHaveBeenCalledTimes(1);
            const body = h.api.approveRefund.mock.calls[0][0];
            expect(body).toEqual({ refundRequestId: "9", pendingHoldId: "17" });
            expect(Object.keys(body)).toEqual(["refundRequestId", "pendingHoldId"]); // really omitted

            expect(h.controller.state.refundStatus).toBe("approved");
            expect(h.controller.state.isRefundButtonVisible).toBe(false);
            expect(showRefundBanner(h.controller.state)).toBe(false);
            expect(h.toasts.map((t) => t.text)).toEqual(["Refund approved"]);
            expect(h.refreshPendingRefunds).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).toHaveBeenCalledWith({
                "msgtype": "m.text",
                "body": "Your refund was approved — credits returned to your wallet",
                "m.mentions": {},
                "com.clariva.refund": { event: "approved", refund_request_id: 9 },
            });
        });

        it("PARTIAL: sends the rounded amount and the message states what the server says was returned", async () => {
            const h = await polled(consultantRequested(), { peer: CLIENT });
            h.api.approveRefund.mockResolvedValue({ message: "ok", amount: "12.50", toConsultant: "37.50" });
            expect((await h.controller.approve(12.5)).ok).toBe(true);
            expect(h.api.approveRefund.mock.calls[0][0]).toEqual({
                refundRequestId: "9",
                pendingHoldId: "17",
                refundAmount: 12.5,
            });
            expect((h.sendMessage.mock.calls[0][0] as RefundMessageContent).body).toBe(
                "Your refund was approved — 12.5 credits returned to your wallet",
            );
        });

        it("PARTIAL: whole amounts print as integers; falls back to the typed amount when the response has none", async () => {
            const h = await polled(consultantRequested(), { peer: CLIENT });
            h.api.approveRefund.mockResolvedValue({ message: "ok" }); // no amount
            await h.controller.approve(20);
            expect((h.sendMessage.mock.calls[0][0] as RefundMessageContent).body).toBe(
                "Your refund was approved — 20 credits returned to your wallet",
            );
        });

        it("PARTIAL: rounds to 2 decimals like the server before sending", async () => {
            const h = await polled(consultantRequested(), { peer: CLIENT });
            h.api.approveRefund.mockResolvedValue(undefined);
            await h.controller.approve(1.234);
            expect(h.api.approveRefund.mock.calls[0][0].refundAmount).toBe(1.23);
            expect((h.sendMessage.mock.calls[0][0] as RefundMessageContent).body).toBe(
                "Your refund was approved — 1.23 credits returned to your wallet",
            );
        });

        it("refuses a non-positive partial amount without calling the API", async () => {
            const h = await polled(consultantRequested(), { peer: CLIENT });
            for (const bad of [0, -5, 0.004, NaN]) {
                const result = await h.controller.approve(bad);
                expect(result).toEqual({ ok: false, message: "Enter an amount greater than 0." });
            }
            expect(h.api.approveRefund).not.toHaveBeenCalled();
            expect(h.controller.state.isRequestInProgress).toBe(false);
        });

        it("surfaces the server message when another device decided first", async () => {
            const h = await polled(consultantRequested(), { peer: CLIENT });
            h.api.approveRefund.mockRejectedValue(
                httpError(400, "Refund is not awaiting a decision (current status: approved)."),
            );
            const result = await h.controller.approve();
            expect(result).toEqual({
                ok: false,
                message: "Refund is not awaiting a decision (current status: approved).",
            });
            expect(h.controller.state.refundStatus).toBe("requested"); // unchanged: the next poll reconciles
            expect(h.sendMessage).not.toHaveBeenCalled();
            expect(h.refreshPendingRefunds).not.toHaveBeenCalled();
            expect(h.toasts.map((t) => [t.text, t.kind])).toEqual([
                ["Refund is not awaiting a decision (current status: approved).", "error"],
            ]);
        });

        it("is ignored without a refund request id", async () => {
            const h = await polled(hold({ clientId: CLIENT, consultantId: ME }), { peer: CLIENT }); // status none
            expect(await h.controller.approve()).toEqual({ ok: false, message: "", ignored: true });
            expect(h.api.approveRefund).not.toHaveBeenCalled();
        });
    });

    describe("reject", () => {
        it("rejects by request id, flips state, toasts, refreshes the pills and announces", async () => {
            const h = await polled(
                hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }),
                { peer: CLIENT },
            );
            const result = await h.controller.reject();
            expect(result).toEqual({ ok: true, message: "Refund rejected" });
            expect(h.api.rejectRefund).toHaveBeenCalledWith("9");
            expect(h.controller.state.refundStatus).toBe("rejected");
            expect(showRefundBanner(h.controller.state)).toBe(false);
            expect(h.toasts.map((t) => t.text)).toEqual(["Refund rejected"]);
            expect(h.refreshPendingRefunds).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).toHaveBeenCalledWith({
                "msgtype": "m.text",
                "body": "Your refund was rejected by the consultant",
                "m.mentions": {},
                "com.clariva.refund": { event: "rejected", refund_request_id: 9 },
            });
        });

        it("surfaces the server message on failure", async () => {
            const h = await polled(
                hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }),
                { peer: CLIENT },
            );
            h.api.rejectRefund.mockRejectedValue(httpError(404, "Refund request not found"));
            expect(await h.controller.reject()).toEqual({ ok: false, message: "Refund request not found" });
            expect(h.controller.state.refundStatus).toBe("requested");
            expect(h.sendMessage).not.toHaveBeenCalled();
        });
    });

    describe("the single in-flight guard", () => {
        it("ignores a second tap (of any action) while one is running, then frees the guard", async () => {
            const h = await polled(
                hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }),
                {
                    peer: CLIENT,
                },
            );
            let finish!: (v: unknown) => void;
            h.api.rejectRefund.mockReturnValue(new Promise((r) => (finish = r)));

            const first = h.controller.reject();
            expect(h.controller.state.isRequestInProgress).toBe(true);

            expect(await h.controller.reject()).toEqual({ ok: false, message: "", ignored: true });
            expect(await h.controller.approve()).toEqual({ ok: false, message: "", ignored: true });
            expect(await h.controller.requestRefund()).toEqual({ ok: false, message: "", ignored: true });
            expect(h.api.rejectRefund).toHaveBeenCalledTimes(1);
            expect(h.api.approveRefund).not.toHaveBeenCalled();

            finish({ message: "ok" });
            expect((await first).ok).toBe(true);
            expect(h.controller.state.isRequestInProgress).toBe(false);
        });

        it("frees the guard after a failure too", async () => {
            const h = await polled(hold());
            h.api.requestRefund.mockRejectedValueOnce(httpError(500, "boom"));
            await h.controller.requestRefund();
            expect(h.controller.state.isRequestInProgress).toBe(false);
            h.api.requestRefund.mockResolvedValue({ refundRequestId: 9 });
            expect((await h.controller.requestRefund()).ok).toBe(true);
        });
    });

    describe("a poll racing an action", () => {
        it("cannot resurrect the state the action just replaced", async () => {
            const h = await polled(
                hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }),
                { peer: CLIENT },
            );
            // a poll is in flight (it will still report the OLD state: the server answered before the approval) ...
            let answerStale!: (s: PendingHoldStatus) => void;
            h.api.holdStatus.mockReturnValueOnce(new Promise<PendingHoldStatus>((r) => (answerStale = r)));
            const racing = h.controller.pollNow();

            // ... the consultant approves meanwhile ...
            await h.controller.approve();
            expect(showRefundBanner(h.controller.state)).toBe(false);

            // ... and the stale answer arrives afterwards
            answerStale(hold({ clientId: CLIENT, consultantId: ME, refund_status: "requested", refundRequestId: 9 }));
            await racing;
            expect(showRefundBanner(h.controller.state)).toBe(false);
            expect(h.controller.state.refundStatus).toBe("approved");

            // the next poll reconciles with the server
            h.api.holdStatus.mockResolvedValue(NO_HOLD);
            await h.controller.pollNow();
            expect(h.controller.state.refundStatus).toBeNull();
        });
    });

    describe("24 h auto-approval claim protocol (spec 03 §3.7)", () => {
        const AUTO_BODY = "Refund auto-approved after 24h with no response — credits returned to the client";

        it("claims with (request id, me); only the winner announces, once", async () => {
            const h = makeHarness();
            h.api.holdStatus.mockResolvedValue({ ...NO_HOLD, pendingAutoApprovalNotification: notification() });
            h.api.claimAutoApprovalNotification.mockResolvedValue({ claimed: true });
            await h.controller.pollNow();

            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledWith(9, ME);
            expect(h.sendMessage).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).toHaveBeenCalledWith({
                "msgtype": "m.text",
                "body": AUTO_BODY,
                "m.mentions": {},
                "com.clariva.refund": { event: "auto_approved", refund_request_id: 9 },
            });

            // the same notification on every following tick: no re-claim, no second message
            await h.controller.pollNow();
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).toHaveBeenCalledTimes(1);
        });

        it("claimed:false (someone else won): no message, and it is not asked again", async () => {
            const h = makeHarness();
            h.api.holdStatus.mockResolvedValue({ ...NO_HOLD, pendingAutoApprovalNotification: notification() });
            h.api.claimAutoApprovalNotification.mockResolvedValue({ claimed: false });
            await h.controller.pollNow();
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).not.toHaveBeenCalled();
        });

        it("a network error or a 5xx is NOT a definitive answer: retried on the next tick, then announced once", async () => {
            const h = makeHarness();
            h.api.holdStatus.mockResolvedValue({ ...NO_HOLD, pendingAutoApprovalNotification: notification() });
            h.api.claimAutoApprovalNotification
                .mockRejectedValueOnce(networkError())
                .mockRejectedValueOnce(httpError(503, "unavailable"))
                .mockResolvedValue({ claimed: true });

            await h.controller.pollNow();
            expect(h.sendMessage).not.toHaveBeenCalled();
            await h.controller.pollNow();
            expect(h.sendMessage).not.toHaveBeenCalled();
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(3);
            expect(h.sendMessage).toHaveBeenCalledTimes(1);
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(3);
        });

        it("a 4xx answer is definitive (it can never succeed): not retried, nothing sent", async () => {
            const h = makeHarness();
            h.api.holdStatus.mockResolvedValue({ ...NO_HOLD, pendingAutoApprovalNotification: notification() });
            h.api.claimAutoApprovalNotification.mockRejectedValue(httpError(404, "not found"));
            await h.controller.pollNow();
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).not.toHaveBeenCalled();
        });

        it("a different notification id is claimed separately", async () => {
            const h = makeHarness();
            h.api.claimAutoApprovalNotification.mockResolvedValue({ claimed: true });
            h.api.holdStatus.mockResolvedValue({
                ...NO_HOLD,
                pendingAutoApprovalNotification: notification({ refundRequestId: 9 }),
            });
            await h.controller.pollNow();
            h.api.holdStatus.mockResolvedValue({
                ...NO_HOLD,
                pendingAutoApprovalNotification: notification({ refundRequestId: 10 }),
            });
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification.mock.calls.map((c) => c[0])).toEqual([9, 10]);
            expect(h.sendMessage).toHaveBeenCalledTimes(2);
        });

        it("the consultant branch does not use up the claim (Android quirk NOT copied)", async () => {
            const h = makeHarness({ me: CONSULTANT, peer: CLIENT });
            h.api.claimAutoApprovalNotification.mockResolvedValue({ claimed: true });
            // the consultant sees the open request while the chat is open ...
            h.api.holdStatus.mockResolvedValue(
                hold({ clientId: CLIENT, consultantId: CONSULTANT, refund_status: "requested", refundRequestId: 9 }),
            );
            await h.controller.pollNow();
            expect(showRefundBanner(h.controller.state)).toBe(true);
            // ... 24 h later the cron auto-approved it: the very same request id arrives as a notification
            h.api.holdStatus.mockResolvedValue({
                ...NO_HOLD,
                pendingAutoApprovalNotification: notification({
                    clientId: CLIENT,
                    consultantId: CONSULTANT,
                    refundRequestId: 9,
                }),
            });
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledWith(9, CONSULTANT);
            expect(h.sendMessage).toHaveBeenCalledTimes(1);
        });

        it("claims with the identifier the row carries when it is one of my aliases", async () => {
            const h = makeHarness({ aliases: ["legacy-webuddy"] });
            h.api.holdStatus.mockResolvedValue({
                ...NO_HOLD,
                pendingAutoApprovalNotification: notification({ clientId: "legacy-webuddy" }),
            });
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledWith(9, "legacy-webuddy");
        });

        it("runs inside the poll loop, independently of the hold (which the cron already deleted)", async () => {
            const h = makeHarness();
            h.api.holdStatus.mockResolvedValue({ ...NO_HOLD, pendingAutoApprovalNotification: notification() });
            h.api.claimAutoApprovalNotification.mockResolvedValue({ claimed: true });
            started(h);
            await flush();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(1);
            expect(h.sendMessage).toHaveBeenCalledTimes(1);
            expect(h.controller.state.isRefundButtonVisible).toBe(false);
        });

        it("a failed announcement is swallowed (the claim is spent either way)", async () => {
            const h = makeHarness();
            h.sendMessage.mockRejectedValue(new Error("offline"));
            h.api.holdStatus.mockResolvedValue({ ...NO_HOLD, pendingAutoApprovalNotification: notification() });
            h.api.claimAutoApprovalNotification.mockResolvedValue({ claimed: true });
            await expect(h.controller.pollNow()).resolves.toBeUndefined();
            await h.controller.pollNow();
            expect(h.api.claimAutoApprovalNotification).toHaveBeenCalledTimes(1);
        });
    });
});
