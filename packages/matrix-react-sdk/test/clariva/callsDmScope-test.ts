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

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "events";
import { renderHook } from "@testing-library/react-hooks";
import { type Room } from "matrix-js-sdk/src/matrix";
import { createElement } from "react";
import { render } from "@testing-library/react";

import DMRoomMap from "../../src/utils/DMRoomMap";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { NO_BILLING } from "../../src/clariva/chat/billing";
import { ClarivaBilling } from "../../src/clariva/chat/ClarivaBilling";
import {
    evaluateChatGate,
    isChatRestricted,
    safeCallDmPeerId,
    safeDmPeerId,
    useClarivaCallDmPeerId,
    useClarivaDmPeerId,
} from "../../src/clariva/chat/useChatGate";
import { defaultIntentForRoom, isClarivaDmCall } from "../../src/clariva/calls/elementCallWidget";
import { resetClarivaCallsConfigForTests } from "../../src/clariva/calls/config";
import { useClarivaDmCalls } from "../../src/clariva/calls/hooks";
import { ClarivaRefundPill } from "../../src/clariva/components/refund/ClarivaRefundPill";
import { ME, configureClariva } from "./helpers";

jest.mock("../../src/utils/DMRoomMap");

/**
 * "Is this a 1:1 chat?" has two answers on purpose. Billing, the chat gate, refunds and the chats list only ever trust
 * `m.direct` (Android bills real DMs only); calls also recognise an unlisted, unnamed two-member private room, so an
 * incoming call in a chat the invitee's client never recorded still rings. These tests pin the split with the REAL
 * helpers (only `DMRoomMap` is faked), and fence the modules on each side so a later edit cannot mix them up.
 */

const PEER = "@rao:clarivahub.com";

/** An unnamed private room with exactly two members, me and the peer, and nothing in `m.direct`. */
function unlistedRoom(): Room {
    const members = [
        { userId: ME, membership: "join" },
        { userId: PEER, membership: "join" },
    ];
    return Object.assign(new EventEmitter(), {
        roomId: "!unlisted:clarivahub.com",
        myUserId: ME,
        client: new EventEmitter(),
        getMyMembership: () => "join",
        getInvitedAndJoinedMemberCount: () => 2,
        getMembersWithMembership: (membership: string) => members.filter((m) => m.membership === membership),
        getMember: (userId: string) => members.find((m) => m.userId === userId) ?? null,
        isSpaceRoom: () => false,
        currentState: Object.assign(new EventEmitter(), {
            getStateEvents: (type: string) => (type === "m.room.name" ? null : []),
        }),
    }) as unknown as Room;
}

describe("DM-ness: billing and gating vs. calls", () => {
    let direct: string | undefined;
    let room: Room;

    beforeEach(() => {
        direct = undefined;
        jest.mocked(DMRoomMap.shared).mockImplementation(
            () => ({ getUserIdForRoomId: () => direct }) as unknown as DMRoomMap,
        );
        configureClariva({ features: { calls: true } });
        resetClarivaCallsConfigForTests();
        WalletStore.resetForTests();
        room = unlistedRoom();
    });

    afterEach(() => {
        WalletStore.resetForTests();
        resetClarivaCallsConfigForTests();
        jest.restoreAllMocks();
    });

    describe("an unlisted, unnamed two-member room (m.direct says nothing about it)", () => {
        it("is not a DM for the chat gate, so it is never restricted, gated or priced", () => {
            expect(safeDmPeerId(room)).toBeNull();
            expect(evaluateChatGate(room)).toMatchObject({ peerId: null, restricted: false, reason: "no-peer" });
            expect(isChatRestricted(room)).toBe(false);
        });

        it("is not billed when a message is sent", async () => {
            await expect(ClarivaBilling.beforeSend(room)).resolves.toBe(NO_BILLING);
            await expect(ClarivaBilling.beforeSendRichText(room, "hello")).resolves.toBe(NO_BILLING);
        });

        it("gets no refund pill, even when the peer has an open refund request and I am a consultant", () => {
            jest.spyOn(WalletStore.instance, "isConsultant", "get").mockReturnValue(true);
            jest.spyOn(WalletStore.instance, "pendingRefundClients", "get").mockReturnValue(new Set([PEER]));

            const unlisted = render(createElement(ClarivaRefundPill, { room }));
            expect(unlisted.container.querySelector(".mx_ClarivaRefundPill")).toBeNull();
            unlisted.unmount();

            // the same room once m.direct lists it: the pill is there (so the test above is not vacuous)
            direct = PEER;
            const listed = render(createElement(ClarivaRefundPill, { room }));
            expect(listed.container.querySelector(".mx_ClarivaRefundPill")).not.toBeNull();
        });

        it("has no peer for the chats list (rate label) either", () => {
            expect(renderHook(() => useClarivaDmPeerId(room, false)).result.current).toBeNull();
        });

        it("IS a 1:1 chat for calls: the call peer, the controls decision, the intent and Notifier's legacy-toast rule", () => {
            expect(safeCallDmPeerId(room)).toBe(PEER);
            expect(renderHook(() => useClarivaCallDmPeerId(room)).result.current).toBe(PEER);
            expect(renderHook(() => useClarivaDmCalls(room)).result.current).toBe(true);
            expect(isClarivaDmCall(room)).toBe(true);
            expect(defaultIntentForRoom(room)).toBe("start_call_dm");
        });

        it("every call decision agrees: one ring, one set of controls, no legacy toast on top", () => {
            const answers = [
                !!safeCallDmPeerId(room), // the ring and the outgoing call (runtime host)
                renderHook(() => useClarivaDmCalls(room)).result.current, // the header's controls
                isClarivaDmCall(room), // Notifier suppresses Element's legacy toast, placeCall routes
                defaultIntentForRoom(room).includes("_dm"), // the widget's intent
            ];
            expect(new Set(answers).size).toBe(1);
            expect(answers[0]).toBe(true);
        });

        it("calls stay Element's own while the calls feature is off", () => {
            configureClariva();
            resetClarivaCallsConfigForTests();
            expect(isClarivaDmCall(room)).toBe(false);
            expect(renderHook(() => useClarivaDmCalls(room)).result.current).toBe(false);
        });
    });

    describe("a room that m.direct lists", () => {
        it("is a DM for everybody: billing, gating and calls agree", () => {
            direct = PEER;
            expect(safeDmPeerId(room)).toBe(PEER);
            expect(safeCallDmPeerId(room)).toBe(PEER);
            expect(isClarivaDmCall(room)).toBe(true);
            expect(evaluateChatGate(room).peerId).toBe(PEER);
        });
    });

    describe("module fences", () => {
        const SRC = path.resolve(__dirname, "../../src");
        const read = (file: string): string => fs.readFileSync(path.join(SRC, file), "utf8");
        const filesIn = (dir: string, ext: RegExp): string[] =>
            fs
                .readdirSync(path.join(SRC, dir))
                .filter((f) => ext.test(f))
                .map((f) => `${dir}/${f}`);

        /** Code, not comments: a doc comment may name the other helper to say what it is NOT. */
        const codeOf = (file: string): string =>
            read(file)
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/^\s*\/\/.*$/gm, "");

        const BILLING_PEER =
            /\b(getClarivaDmPeerId|safeDmPeerId|useClarivaDmPeerId|evaluateChatGate|isChatRestricted)\b/;
        const CALL_PEER = /\b(getClarivaCallDmPeerId|safeCallDmPeerId|useClarivaCallDmPeerId|isClarivaDmCall)\b/;

        it("call code never asks the billing peer", () => {
            const callFiles = [...filesIn("clariva/calls", /\.ts$/), ...filesIn("clariva/components/calls", /\.tsx$/)];
            expect(callFiles.length).toBeGreaterThan(20);
            const offenders = callFiles.filter((file) => BILLING_PEER.test(codeOf(file)));
            expect(offenders).toEqual([]);
        });

        it("billing, gating, refund and chats-list code never asks the call peer", () => {
            const billingFiles = [
                "clariva/chat/ClarivaBilling.ts",
                "clariva/chat/ChatGateController.ts",
                "clariva/chat/billing.ts",
                "clariva/chat/gate.ts",
                "clariva/hooks/useRefundState.ts",
                "clariva/components/refund/ClarivaRefundPill.tsx",
                "clariva/components/chat/RoomTileRate.tsx",
                "clariva/components/chat/ComposerGate.tsx",
            ];
            const offenders = billingFiles.filter((file) => CALL_PEER.test(codeOf(file)));
            expect(offenders).toEqual([]);
        });

        it("the refund pill and refund state read the plain m.direct helper", () => {
            expect(codeOf("clariva/hooks/useRefundState.ts")).toMatch(/getClarivaDmPeerId\(/);
            expect(codeOf("clariva/components/refund/ClarivaRefundPill.tsx")).toMatch(/getClarivaDmPeerId\(/);
        });

        it("the upstream call hooks decide through the Clariva call helpers only", () => {
            // Notifier (legacy call.notify toast), placeCall (every placed call) and the room header (controls)
            expect(codeOf("Notifier.ts")).toMatch(/isClarivaDmCall\(/);
            expect(codeOf("utils/room/placeCall.ts")).toMatch(/isClarivaDmCall\(/);
            expect(codeOf("components/views/rooms/RoomHeader.tsx")).toMatch(/useClarivaDmCalls\(/);
            for (const file of ["Notifier.ts", "utils/room/placeCall.ts", "components/views/rooms/RoomHeader.tsx"]) {
                expect(codeOf(file)).not.toMatch(/\b(getClarivaDmPeerId|safeDmPeerId|useClarivaDmPeerId)\b/);
            }
        });
    });
});
