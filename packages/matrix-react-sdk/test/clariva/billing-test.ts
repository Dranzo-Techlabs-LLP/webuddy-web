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
    type BillingConfig,
    type BillingDeps,
    type BillingGate,
    type BillingOptOut,
    type BillingUi,
    type BillingWallet,
    NO_BILLING,
    SendBilling,
} from "../../src/clariva/chat/billing";
import { type HoldResult, type PeerWalletInfo } from "../../src/clariva/stores/WalletStore";
import { OPT_OUT_STORAGE_PREFIX, localStorageOptOut } from "../../src/clariva/chat/optOut";
import { CLIENT, CONSULTANT, ME } from "./helpers";

const consultantPeer: PeerWalletInfo = { maxCredits: 50, isConsultant: true, fetchedAt: 0 };
const NETWORK: HoldResult = {
    ok: false,
    status: 0,
    message: "Failed to fetch",
    insufficientCredits: false,
    isNetwork: true,
};
const INSUFFICIENT: HoldResult = {
    ok: false,
    status: 400,
    message: "Insufficient credits: need 50, have 20. Please recharge to start this chat.",
    insufficientCredits: true,
    isNetwork: false,
};

interface Harness {
    billing: SendBilling;
    log: string[];
    wallet: jest.Mocked<BillingWallet> & { isConsultant: boolean | null; userId: string | null };
    ui: jest.Mocked<BillingUi>;
    gate: jest.Mocked<BillingGate>;
    optedOut: Set<string>;
    config: BillingConfig;
}

function harness(over: { config?: Partial<BillingConfig>; peer?: PeerWalletInfo | null } = {}): Harness {
    const log: string[] = [];
    const config: BillingConfig = { holdFirst: true, billConsultantsOnly: true, ...over.config };
    const optedOut = new Set<string>();
    const wallet = {
        userId: ME as string | null,
        isConsultant: false as boolean | null,
        getPeer: jest.fn(async () => (over.peer === undefined ? consultantPeer : over.peer)),
        getCachedHoldExists: jest.fn((): boolean | undefined => undefined),
        checkHoldExists: jest.fn(async (): Promise<boolean | null> => false),
        initiateHold: jest.fn(async (): Promise<HoldResult> => {
            log.push("initiate");
            return { ok: true, skipped: false };
        }),
        refreshBalance: jest.fn(async () => {
            log.push("refresh");
        }),
    } as unknown as Harness["wallet"];
    const ui: jest.Mocked<BillingUi> = {
        confirmNewSession: jest.fn(async (_peerId: string) => {
            log.push("dialog");
            return { proceed: true, neverRemind: false };
        }),
        showInsufficientCredits: jest.fn((_message: string | undefined) => {
            log.push("insufficient");
        }),
    };
    const gate: jest.Mocked<BillingGate> = {
        knownHoldExists: jest.fn((_peerId: string): boolean | null | undefined => undefined),
        noteHoldExists: jest.fn(),
        revalidate: jest.fn(async (_peerId: string) => {
            log.push("revalidate");
        }),
    };
    const optOut: BillingOptOut = {
        isOptedOut: (me, peer) => optedOut.has(`${me}|${peer}`),
        optOut: (me, peer) => void optedOut.add(`${me}|${peer}`),
    };
    const deps: BillingDeps = { wallet, ui, optOut, gate, config: () => config };
    return { billing: new SendBilling(deps), log, wallet, ui, gate, optedOut, config };
}

describe("SendBilling.beforeSend", () => {
    it("does nothing without a peer (non-DM room) or a signed-in user", async () => {
        const h = harness();
        expect(await h.billing.beforeSend(null)).toBe(NO_BILLING);
        h.wallet.userId = null;
        expect(await h.billing.beforeSend(CONSULTANT)).toBe(NO_BILLING);
        expect(h.wallet.getPeer).not.toHaveBeenCalled();
        expect(h.wallet.initiateHold).not.toHaveBeenCalled();
    });

    it("consultants skip everything: no lookups, no dialog, no hold", async () => {
        const h = harness();
        h.wallet.isConsultant = true;
        expect(await h.billing.beforeSend(CLIENT)).toBe(NO_BILLING);
        expect(h.wallet.getPeer).not.toHaveBeenCalled();
        expect(h.wallet.checkHoldExists).not.toHaveBeenCalled();
        expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
        expect(h.wallet.initiateHold).not.toHaveBeenCalled();
    });

    it("resolves an unknown own role first, then bills as a client", async () => {
        const h = harness();
        h.wallet.isConsultant = null;
        h.wallet.refreshBalance.mockImplementation(async () => {
            h.wallet.isConsultant = false;
        });
        expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "created", peerId: CONSULTANT });
        expect(h.wallet.refreshBalance).toHaveBeenCalledTimes(1);
    });

    it("an own role that stays unknown fails open: the message is sent unbilled", async () => {
        const h = harness();
        h.wallet.isConsultant = null;
        expect(await h.billing.beforeSend(CONSULTANT)).toBe(NO_BILLING);
        expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
        expect(h.wallet.initiateHold).not.toHaveBeenCalled();
    });

    describe("bill_consultants_only (D5)", () => {
        it.each([
            ["a client peer", { maxCredits: 0, isConsultant: false, fetchedAt: 0 }],
            ["an unknown peer role", { maxCredits: 50, isConsultant: null, fetchedAt: 0 }],
            ["a consultant with price 0", { maxCredits: 0, isConsultant: true, fetchedAt: 0 }],
            ["a consultant with an unknown price", { maxCredits: null, isConsultant: true, fetchedAt: 0 }],
            ["a peer with no wallet row", null],
        ])("%s is never billed (no dialog, no hold)", async (_name, peer) => {
            const h = harness({ peer });
            expect(await h.billing.beforeSend(CLIENT)).toBe(NO_BILLING);
            expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
            expect(h.wallet.checkHoldExists).not.toHaveBeenCalled();
            expect(h.wallet.initiateHold).not.toHaveBeenCalled();
        });

        it("with the flag off, every DM peer is billed like on Android", async () => {
            const h = harness({ config: { billConsultantsOnly: false }, peer: null });
            expect(await h.billing.beforeSend(CLIENT)).toEqual({ kind: "created", peerId: CLIENT });
            expect(h.ui.confirmNewSession).toHaveBeenCalledTimes(1);
        });
    });

    describe("a covering hold", () => {
        it("known true by the gate: send immediately, no network, no dialog", async () => {
            const h = harness();
            h.gate.knownHoldExists.mockReturnValue(true);
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "covered", peerId: CONSULTANT });
            expect(h.wallet.checkHoldExists).not.toHaveBeenCalled();
            expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
            expect(h.wallet.initiateHold).not.toHaveBeenCalled();
        });

        it("known true only from the WalletStore cache counts too", async () => {
            const h = harness();
            h.wallet.getCachedHoldExists.mockReturnValue(true);
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "covered", peerId: CONSULTANT });
        });

        it("a stale `false` is re-checked on the spot: it turned out a hold exists, so no wrong warning (L2)", async () => {
            const h = harness();
            h.gate.knownHoldExists.mockReturnValue(false);
            h.wallet.checkHoldExists.mockResolvedValue(true);
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "covered", peerId: CONSULTANT });
            expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
            expect(h.gate.noteHoldExists).toHaveBeenCalledWith(CONSULTANT, true);
        });
    });

    describe("no hold: the new-session dialog", () => {
        it("shows the dialog, THEN creates the hold, THEN lets the message go (hold-first)", async () => {
            const h = harness();
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "created", peerId: CONSULTANT });
            expect(h.log).toEqual(["dialog", "initiate"]);
            expect(h.gate.noteHoldExists).toHaveBeenCalledWith(CONSULTANT, true);
        });

        it("Cancel aborts: nothing is created, the draft stays", async () => {
            const h = harness();
            h.ui.confirmNewSession.mockResolvedValue({ proceed: false, neverRemind: false });
            expect(await h.billing.beforeSend(CONSULTANT)).toBeNull();
            expect(h.wallet.initiateHold).not.toHaveBeenCalled();
            expect(h.optedOut.size).toBe(0);
        });

        it("'Never remind me again' is persisted per consultant and silences later dialogs for that consultant only", async () => {
            const h = harness();
            h.ui.confirmNewSession.mockResolvedValueOnce({ proceed: true, neverRemind: true });
            await h.billing.beforeSend(CONSULTANT);
            expect(h.optedOut.has(`${ME}|${CONSULTANT}`)).toBe(true);

            h.ui.confirmNewSession.mockClear();
            h.wallet.initiateHold.mockClear();
            const next = await h.billing.beforeSend(CONSULTANT);
            expect(next).toEqual({ kind: "created", peerId: CONSULTANT }); // still hold-first, just no dialog
            expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
            expect(h.wallet.initiateHold).toHaveBeenCalledTimes(1);

            // another consultant still asks
            await h.billing.beforeSend("@other:clarivahub.com");
            expect(h.ui.confirmNewSession).toHaveBeenCalledTimes(1);
        });

        it("'Never remind' ticked but Cancel pressed persists nothing", async () => {
            const h = harness();
            h.ui.confirmNewSession.mockResolvedValue({ proceed: false, neverRemind: true });
            await h.billing.beforeSend(CONSULTANT);
            expect(h.optedOut.size).toBe(0);
        });

        it("an unknown hold state (the check failed) shows NO dialog (L5) and lets idempotent `initiate` decide", async () => {
            const h = harness();
            h.wallet.checkHoldExists.mockResolvedValue(null);
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "created", peerId: CONSULTANT });
            expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
            expect(h.wallet.initiateHold).toHaveBeenCalledTimes(1);
        });
    });

    describe("hold-first outcomes", () => {
        it("insufficient credits: shows the SERVER message, keeps the draft, re-checks the gate", async () => {
            const h = harness();
            h.wallet.initiateHold.mockResolvedValue(INSUFFICIENT);
            expect(await h.billing.beforeSend(CONSULTANT)).toBeNull();
            expect(h.ui.showInsufficientCredits).toHaveBeenCalledWith(
                INSUFFICIENT.ok ? undefined : INSUFFICIENT.message,
            );
            expect(h.gate.revalidate).toHaveBeenCalledWith(CONSULTANT);
        });

        it.each([
            ["a network error", NETWORK],
            [
                "a 5xx",
                {
                    ok: false,
                    status: 503,
                    message: "Service Unavailable",
                    insufficientCredits: false,
                    isNetwork: false,
                } as HoldResult,
            ],
            [
                "'Consultants cannot initiate a chat hold' (we misjudged our role)",
                {
                    ok: false,
                    status: 403,
                    message: "Consultants cannot initiate a chat hold",
                    insufficientCredits: false,
                    isNetwork: false,
                } as HoldResult,
            ],
            [
                "'Consultant not found'",
                {
                    ok: false,
                    status: 404,
                    message: "Consultant x not found",
                    insufficientCredits: false,
                    isNetwork: false,
                } as HoldResult,
            ],
        ])("%s fails OPEN: the message is sent, flagged for a retry", async (_name, result) => {
            const h = harness();
            h.wallet.initiateHold.mockResolvedValue(result);
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "unconfirmed", peerId: CONSULTANT });
            expect(h.ui.showInsufficientCredits).not.toHaveBeenCalled();
        });

        it("a skipped hold (the store says we are a consultant) is not billed", async () => {
            const h = harness();
            h.wallet.initiateHold.mockResolvedValue({ ok: true, skipped: true });
            expect(await h.billing.beforeSend(CONSULTANT)).toBe(NO_BILLING);
        });

        it("hold_first off: Android order — the dialog runs, nothing is created before the send", async () => {
            const h = harness({ config: { holdFirst: false } });
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "unconfirmed", peerId: CONSULTANT });
            expect(h.log).toEqual(["dialog"]);
            expect(h.wallet.initiateHold).not.toHaveBeenCalled();
        });
    });

    describe("single flight", () => {
        it("two quick first sends show the dialog once and race ONE initiate", async () => {
            const h = harness();
            let answer!: (v: { proceed: boolean; neverRemind: boolean }) => void;
            h.ui.confirmNewSession.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
            const first = h.billing.beforeSend(CONSULTANT);
            const second = h.billing.beforeSend(CONSULTANT);
            await new Promise((r) => setTimeout(r, 0));
            answer({ proceed: true, neverRemind: false });
            const [a, b] = await Promise.all([first, second]);
            expect(a).toEqual({ kind: "created", peerId: CONSULTANT });
            expect(b).toBe(a);
            expect(h.ui.confirmNewSession).toHaveBeenCalledTimes(1);
            expect(h.wallet.initiateHold).toHaveBeenCalledTimes(1);
        });

        it("a send after the first settled is a fresh decision", async () => {
            const h = harness();
            await h.billing.beforeSend(CONSULTANT);
            h.gate.knownHoldExists.mockReturnValue(true);
            expect(await h.billing.beforeSend(CONSULTANT)).toEqual({ kind: "covered", peerId: CONSULTANT });
        });
    });
});

describe("SendBilling.afterSend", () => {
    it("none: no calls at all", async () => {
        const h = harness();
        await h.billing.afterSend(NO_BILLING, Promise.resolve());
        expect(h.log).toEqual([]);
        expect(h.gate.revalidate).not.toHaveBeenCalled();
    });

    it("created: no second initiate; balance refreshed, then hold/rate re-checked", async () => {
        const h = harness();
        await h.billing.afterSend({ kind: "created", peerId: CONSULTANT }, Promise.resolve());
        expect(h.log).toEqual(["refresh", "revalidate"]);
    });

    it("covered: re-posts the idempotent initiate (Android parity) and awaits it BEFORE refreshing the balance (L4)", async () => {
        const h = harness();
        await h.billing.afterSend({ kind: "covered", peerId: CONSULTANT }, Promise.resolve());
        expect(h.log).toEqual(["initiate", "refresh", "revalidate"]);
    });

    it("unconfirmed: this is the single background retry of the failed hold-first initiate", async () => {
        const h = harness();
        await h.billing.afterSend({ kind: "unconfirmed", peerId: CONSULTANT }, Promise.resolve());
        expect(h.wallet.initiateHold).toHaveBeenCalledTimes(1);
        expect(h.gate.noteHoldExists).toHaveBeenCalledWith(CONSULTANT, true);
    });

    it("waits for the send promise before posting the hold", async () => {
        const h = harness();
        let release!: () => void;
        const sent = new Promise<void>((resolve) => (release = resolve));
        const done = h.billing.afterSend({ kind: "unconfirmed", peerId: CONSULTANT }, sent);
        await new Promise((r) => setTimeout(r, 0));
        expect(h.wallet.initiateHold).not.toHaveBeenCalled();
        release();
        await done;
        expect(h.wallet.initiateHold).toHaveBeenCalledTimes(1);
    });

    it("an undelivered message does not start a NEW hold, but balance and gate are still refreshed", async () => {
        const h = harness();
        await h.billing.afterSend(
            { kind: "unconfirmed", peerId: CONSULTANT },
            Promise.reject(new Error("send failed")),
        );
        expect(h.wallet.initiateHold).not.toHaveBeenCalled();
        expect(h.log).toEqual(["refresh", "revalidate"]);
    });

    it("a failing retry is only logged: never throws", async () => {
        const h = harness();
        h.wallet.initiateHold.mockResolvedValue(NETWORK);
        await expect(h.billing.afterSend({ kind: "unconfirmed", peerId: CONSULTANT })).resolves.toBeUndefined();
        expect(h.gate.noteHoldExists).not.toHaveBeenCalled();
        expect(h.log).toEqual(["refresh", "revalidate"]);
    });

    it("never throws even if the wallet throws", async () => {
        const h = harness();
        h.wallet.initiateHold.mockRejectedValue(new Error("boom"));
        await expect(h.billing.afterSend({ kind: "covered", peerId: CONSULTANT })).resolves.toBeUndefined();
        expect(h.gate.revalidate).toHaveBeenCalled();
    });
});

describe("SendBilling.afterVoiceSend", () => {
    it("a client voice message to a consultant: hold + balance refresh, NO dialog", async () => {
        const h = harness();
        await h.billing.afterVoiceSend(CONSULTANT, Promise.resolve());
        expect(h.ui.confirmNewSession).not.toHaveBeenCalled();
        expect(h.log).toEqual(["initiate", "refresh", "revalidate"]);
    });

    it("consultants, client peers, non-DM rooms: nothing", async () => {
        const consultant = harness();
        consultant.wallet.isConsultant = true;
        await consultant.billing.afterVoiceSend(CLIENT);
        expect(consultant.log).toEqual([]);

        const toClient = harness({ peer: { maxCredits: 0, isConsultant: false, fetchedAt: 0 } });
        await toClient.billing.afterVoiceSend(CLIENT);
        expect(toClient.log).toEqual([]);

        const noPeer = harness();
        await noPeer.billing.afterVoiceSend(null);
        expect(noPeer.log).toEqual([]);
    });

    it("an unknown own role is resolved first; if it stays unknown nothing is billed", async () => {
        const h = harness();
        h.wallet.isConsultant = null;
        await h.billing.afterVoiceSend(CONSULTANT);
        expect(h.wallet.initiateHold).not.toHaveBeenCalled();
    });
});

describe("localStorageOptOut", () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => jest.restoreAllMocks());

    it("persists per own Matrix ID and per consultant, and survives a reload (new read)", () => {
        expect(localStorageOptOut.isOptedOut(ME, CONSULTANT)).toBe(false);
        localStorageOptOut.optOut(ME, CONSULTANT);
        localStorageOptOut.optOut(ME, CONSULTANT); // idempotent
        expect(localStorageOptOut.isOptedOut(ME, CONSULTANT)).toBe(true);
        expect(localStorageOptOut.isOptedOut(ME, "@other:clarivahub.com")).toBe(false);
        expect(localStorageOptOut.isOptedOut(CLIENT, CONSULTANT)).toBe(false); // other account, same browser
        expect(JSON.parse(window.localStorage.getItem(`${OPT_OUT_STORAGE_PREFIX}${ME}`)!)).toEqual([CONSULTANT]);
    });

    it("ignores corrupt stored data", () => {
        window.localStorage.setItem(`${OPT_OUT_STORAGE_PREFIX}${ME}`, "{not json");
        expect(localStorageOptOut.isOptedOut(ME, CONSULTANT)).toBe(false);
        window.localStorage.setItem(`${OPT_OUT_STORAGE_PREFIX}${ME}`, JSON.stringify({ a: 1 }));
        expect(localStorageOptOut.isOptedOut(ME, CONSULTANT)).toBe(false);
    });

    it("never throws when storage is unavailable", () => {
        jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("denied");
        });
        jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("quota");
        });
        expect(localStorageOptOut.isOptedOut(ME, CONSULTANT)).toBe(false);
        expect(() => localStorageOptOut.optOut(ME, CONSULTANT)).not.toThrow();
    });
});
