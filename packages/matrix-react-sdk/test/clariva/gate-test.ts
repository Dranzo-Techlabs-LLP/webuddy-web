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

import { type GateInput, decideGate, isBillablePeer } from "../../src/clariva/chat/gate";

const PEER = "@rao:clarivahub.com";

/** A confirmed client chatting with a consultant who charges 50, no hold, balance 20: the one restricting case. */
const base: GateInput = {
    peerId: PEER,
    role: false,
    holdExists: false,
    balance: 20,
    rate: 50,
    peerIsConsultant: true,
    billConsultantsOnly: true,
};

const gate = (over: Partial<GateInput>): ReturnType<typeof decideGate> => decideGate({ ...base, ...over });

describe("decideGate — spec 03 §3.3 decision table", () => {
    describe("rows 1-8", () => {
        it("1: no peer (not a DM / peer gone / loading) never restricts", () => {
            expect(gate({ peerId: null })).toEqual({ restricted: false, reason: "no-peer" });
        });

        it("1b: consultant <-> consultant is restricted (consultants only chat with clients)", () => {
            expect(gate({ role: true, peerIsConsultant: true })).toEqual({
                restricted: true,
                reason: "consultant-peer",
            });
            // whatever the money says: a hold, a balance or a free peer do not lift it
            expect(gate({ role: true, peerIsConsultant: true, holdExists: true, balance: 1000, rate: 0 }).reason).toBe(
                "consultant-peer",
            );
            // ...and with bill_consultants_only off too
            expect(gate({ role: true, peerIsConsultant: true, billConsultantsOnly: false }).restricted).toBe(true);
        });

        it("1b: both roles must be CONFIRMED; an unknown one fails open", () => {
            expect(gate({ role: true, peerIsConsultant: null })).toEqual({ restricted: false, reason: "consultant" });
            expect(gate({ role: null, peerIsConsultant: true })).toEqual({ restricted: false, reason: "role-unknown" });
            expect(gate({ peerId: null, role: true, peerIsConsultant: true }).reason).toBe("no-peer");
        });

        it("2: consultants chatting with clients are never gated, whatever else is true", () => {
            expect(gate({ role: true, peerIsConsultant: false })).toEqual({ restricted: false, reason: "consultant" });
            expect(
                gate({ role: true, peerIsConsultant: false, holdExists: false, balance: 0, rate: 1000 }).restricted,
            ).toBe(false);
        });

        it("a client chatting with a consultant is never hit by the consultant rule", () => {
            expect(gate({ role: false, peerIsConsultant: true, holdExists: true }).reason).toBe("hold-covers");
        });

        it("3: unknown role never restricts (an earlier version flashed the banner for consultants)", () => {
            expect(gate({ role: null })).toEqual({ restricted: false, reason: "role-unknown" });
        });

        it("4: an active hold covers chat AND call whatever the balance", () => {
            expect(gate({ holdExists: true, balance: 0 })).toEqual({ restricted: false, reason: "hold-covers" });
        });

        it("5: unknown hold state never restricts (lesson 93b7510204)", () => {
            expect(gate({ holdExists: null, balance: 0 })).toEqual({ restricted: false, reason: "hold-unknown" });
        });

        it("6: unknown balance or unknown rate fails open", () => {
            expect(gate({ balance: null })).toEqual({ restricted: false, reason: "balance-or-rate-unknown" });
            expect(gate({ rate: null })).toEqual({ restricted: false, reason: "balance-or-rate-unknown" });
            expect(gate({ balance: null, rate: null }).restricted).toBe(false);
        });

        it("7: no hold and balance < rate is the only restricting row", () => {
            expect(gate({})).toEqual({ restricted: true, reason: "insufficient" });
        });

        it("8: no hold but balance >= rate leaves the composer open", () => {
            expect(gate({ balance: 50 })).toEqual({ restricted: false, reason: "sufficient" });
            expect(gate({ balance: 120 })).toEqual({ restricted: false, reason: "sufficient" });
        });
    });

    describe("spec cheat-sheet (client, price 50)", () => {
        it.each([
            ["balance 0, no hold", { balance: 0, holdExists: false }, true],
            ["balance 49, no hold", { balance: 49, holdExists: false }, true],
            ["balance 50, no hold", { balance: 50, holdExists: false }, false],
            ["balance 0, live hold (paid earlier)", { balance: 0, holdExists: true }, false],
            ["hold expired and balance short", { balance: 10, holdExists: false }, true],
            ["hold check errored", { balance: 0, holdExists: null }, false],
        ])("%s", (_name, over, restricted) => {
            expect(gate(over as Partial<GateInput>).restricted).toBe(restricted);
        });
    });

    describe("decimals are compared at 2 dp, not truncated", () => {
        it("49.99 < 50 restricts (Android's truncation would also say 49 < 50)", () => {
            expect(gate({ balance: 49.99, rate: 50 }).restricted).toBe(true);
        });

        it("50.00 vs 50.90 restricts (Android's integer compare would let it through and the server refuses)", () => {
            expect(gate({ balance: 50, rate: 50.9 }).restricted).toBe(true);
        });

        it("50.90 vs 50.90 is enough", () => {
            expect(gate({ balance: 50.9, rate: 50.9 }).restricted).toBe(false);
        });

        it("float noise does not flip the result (0.1 + 0.2 vs 0.3)", () => {
            expect(gate({ balance: 0.1 + 0.2, rate: 0.3 }).restricted).toBe(false);
        });

        it("a sub-cent shortfall is not restricted (2 dp precision of the ledger)", () => {
            expect(gate({ balance: 49.996, rate: 50 }).restricted).toBe(false);
        });
    });

    describe("rate 0 can never restrict", () => {
        it("free consultant", () => {
            expect(gate({ rate: 0, balance: 0 })).toEqual({ restricted: false, reason: "free" });
        });
    });

    describe("bill_consultants_only (decision D5)", () => {
        it("client-to-client chat never restricts", () => {
            expect(gate({ peerIsConsultant: false })).toEqual({ restricted: false, reason: "peer-not-billable" });
        });

        it("an unknown peer role never restricts", () => {
            expect(gate({ peerIsConsultant: null })).toEqual({ restricted: false, reason: "peer-not-billable" });
        });

        it("with the flag off Android's rule applies to every peer (rate decides)", () => {
            expect(gate({ billConsultantsOnly: false, peerIsConsultant: false }).restricted).toBe(true);
            expect(gate({ billConsultantsOnly: false, peerIsConsultant: null }).restricted).toBe(true);
            expect(gate({ billConsultantsOnly: false, peerIsConsultant: false, rate: 0 }).restricted).toBe(false);
        });

        it("the earlier rows still win over the peer rule", () => {
            expect(gate({ peerId: null, peerIsConsultant: null }).reason).toBe("no-peer");
            expect(gate({ role: true, peerIsConsultant: null }).reason).toBe("consultant");
            expect(gate({ role: null, peerIsConsultant: null }).reason).toBe("role-unknown");
        });
    });

    it("never restricts when ANY single input is unknown (fail open, lesson L1)", () => {
        const unknowns: Array<Partial<GateInput>> = [
            { peerId: null },
            { role: null },
            { holdExists: null },
            { balance: null },
            { rate: null },
            { peerIsConsultant: null },
        ];
        for (const unknown of unknowns) {
            expect(gate(unknown).restricted).toBe(false);
        }
    });
});

describe("isBillablePeer", () => {
    it("with bill_consultants_only: only a consultant with a known price > 0", () => {
        expect(isBillablePeer({ isConsultant: true, maxCredits: 50 }, true)).toBe(true);
        expect(isBillablePeer({ isConsultant: true, maxCredits: 0 }, true)).toBe(false);
        expect(isBillablePeer({ isConsultant: true, maxCredits: null }, true)).toBe(false);
        expect(isBillablePeer({ isConsultant: false, maxCredits: 50 }, true)).toBe(false);
        expect(isBillablePeer({ isConsultant: null, maxCredits: 50 }, true)).toBe(false);
        expect(isBillablePeer(null, true)).toBe(false);
        expect(isBillablePeer(undefined, true)).toBe(false);
    });

    it("without it: every peer is billable (Android)", () => {
        expect(isBillablePeer(null, false)).toBe(true);
        expect(isBillablePeer({ isConsultant: false, maxCredits: 0 }, false)).toBe(true);
    });
});
