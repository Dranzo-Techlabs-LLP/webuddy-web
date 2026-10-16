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

import { type Room } from "matrix-js-sdk/src/matrix";

import DMRoomMap from "../../src/utils/DMRoomMap";
import { LocalRoom } from "../../src/models/LocalRoom";
import { getClarivaCallDmPeerId, getClarivaDmPeerId } from "../../src/clariva/chat/dmPeer";

jest.mock("../../src/utils/DMRoomMap");

const ME = "@asha:clarivahub.com";
const PEER = "@rao:clarivahub.com";
const ROOM_ID = "!dm:clarivahub.com";

interface FakeRoomInit {
    roomId?: string;
    myMembership?: string;
    count?: number;
    members?: Array<{ userId: string; membership: string }>;
    name?: string;
    space?: boolean;
    targets?: Array<{ userId: string }>;
}

function fakeRoom(init: FakeRoomInit = {}): Room {
    const members = init.members ?? [
        { userId: ME, membership: "join" },
        { userId: PEER, membership: "join" },
    ];
    const room = {
        roomId: init.roomId ?? ROOM_ID,
        myUserId: ME,
        targets: init.targets,
        getMyMembership: () => init.myMembership ?? "join",
        getInvitedAndJoinedMemberCount: () =>
            init.count ?? members.filter((m) => m.membership === "join" || m.membership === "invite").length,
        getMembersWithMembership: (membership: string) => members.filter((m) => m.membership === membership),
        getMember: (userId: string) => members.find((m) => m.userId === userId) ?? null,
        isSpaceRoom: () => init.space ?? false,
        currentState: {
            getStateEvents: (type: string, key: string) =>
                type === "m.room.name" && key === "" && init.name !== undefined
                    ? { getContent: () => ({ name: init.name }) }
                    : null,
        },
    } as unknown as Room;
    // `isLocalRoom` is an `instanceof LocalRoom` check
    return init.targets ? (Object.assign(Object.create(LocalRoom.prototype), room) as Room) : room;
}

describe("DM peer helpers", () => {
    let direct: string | undefined | null | "throw";

    beforeEach(() => {
        direct = undefined;
        jest.mocked(DMRoomMap.shared).mockImplementation(
            () =>
                ({
                    getUserIdForRoomId: () => {
                        if (direct === "throw") throw new Error("DMRoomMap is not ready");
                        return direct;
                    },
                }) as unknown as DMRoomMap,
        );
    });

    /** Rooms `m.direct` lists: both helpers must answer the same, so a billed DM is always a call DM too. */
    describe.each([
        ["getClarivaDmPeerId", getClarivaDmPeerId],
        ["getClarivaCallDmPeerId", getClarivaCallDmPeerId],
    ])("%s on a room that m.direct lists", (_name, peerOf) => {
        it("is a DM with the listed peer", () => {
            direct = PEER;
            expect(peerOf(fakeRoom())).toBe(PEER);
        });

        it("is not one with three active members, a peer who left, or a listing of myself", () => {
            direct = PEER;
            expect(peerOf(fakeRoom({ count: 3 }))).toBeNull();
            expect(
                peerOf(
                    fakeRoom({
                        members: [
                            { userId: ME, membership: "join" },
                            { userId: PEER, membership: "leave" },
                        ],
                    }),
                ),
            ).toBeNull();
            direct = ME;
            expect(peerOf(fakeRoom())).toBeNull();
        });

        it("an invited peer already counts", () => {
            direct = PEER;
            const room = fakeRoom({
                members: [
                    { userId: ME, membership: "join" },
                    { userId: PEER, membership: "invite" },
                ],
            });
            expect(peerOf(room)).toBe(PEER);
        });

        it("m.direct wins over the implicit rules (a named two-person room that is listed stays a DM)", () => {
            direct = PEER;
            expect(peerOf(fakeRoom({ name: "Dr Rao" }))).toBe(PEER);
        });

        it("a not-yet-created DM (LocalRoom) is a DM with its single target, never with myself", () => {
            expect(peerOf(fakeRoom({ roomId: "local+abc", targets: [{ userId: PEER }] }))).toBe(PEER);
            expect(peerOf(fakeRoom({ roomId: "local+abc", targets: [{ userId: ME }] }))).toBeNull();
            expect(peerOf(fakeRoom({ roomId: "local+abc", targets: [] }))).toBeNull();
        });

        it("no room, no peer", () => {
            expect(peerOf(null)).toBeNull();
            expect(peerOf(undefined)).toBeNull();
        });
    });

    /**
     * The billing helper (chat gate, send billing, refund pill and state, chat list rate) must never guess: Android
     * bills real DMs only, and an unlisted, unnamed two-person private room is not one.
     */
    describe("getClarivaDmPeerId on a room that m.direct says nothing about", () => {
        it("is NOT a DM, however much it looks like one (unnamed, two active members)", () => {
            expect(getClarivaDmPeerId(fakeRoom())).toBeNull();
            direct = null;
            expect(getClarivaDmPeerId(fakeRoom())).toBeNull();
        });

        it("not even with an invited peer, or with an empty room name", () => {
            const invited = fakeRoom({
                members: [
                    { userId: ME, membership: "join" },
                    { userId: PEER, membership: "invite" },
                ],
            });
            expect(getClarivaDmPeerId(invited)).toBeNull();
            expect(getClarivaDmPeerId(fakeRoom({ name: "" }))).toBeNull();
        });

        it("does not fall back while DMRoomMap is not ready: it throws as it always did (callers read that as no peer)", () => {
            direct = "throw";
            expect(() => getClarivaDmPeerId(fakeRoom())).toThrow("DMRoomMap is not ready");
        });
    });

    describe("getClarivaCallDmPeerId on a room that m.direct says nothing about", () => {
        it("falls back to the other member when exactly two members are active", () => {
            expect(getClarivaCallDmPeerId(fakeRoom())).toBe(PEER);
            direct = null;
            expect(getClarivaCallDmPeerId(fakeRoom())).toBe(PEER);
        });

        it("the other member may still be invited", () => {
            const room = fakeRoom({
                members: [
                    { userId: ME, membership: "join" },
                    { userId: PEER, membership: "invite" },
                ],
            });
            expect(getClarivaCallDmPeerId(room)).toBe(PEER);
        });

        it("also when DMRoomMap is not ready yet, and it never throws", () => {
            direct = "throw";
            expect(getClarivaCallDmPeerId(fakeRoom())).toBe(PEER);
            expect(getClarivaCallDmPeerId(fakeRoom({ count: 3 }))).toBeNull();
        });

        it("is not a DM with more or fewer than two active members", () => {
            expect(getClarivaCallDmPeerId(fakeRoom({ count: 3 }))).toBeNull();
            expect(
                getClarivaCallDmPeerId(fakeRoom({ count: 1, members: [{ userId: ME, membership: "join" }] })),
            ).toBeNull();
            expect(
                getClarivaCallDmPeerId(
                    fakeRoom({
                        members: [
                            { userId: ME, membership: "join" },
                            { userId: PEER, membership: "leave" },
                        ],
                    }),
                ),
            ).toBeNull();
        });

        it("is not a DM when I am not joined, in a space, or in a room with a name of its own", () => {
            expect(getClarivaCallDmPeerId(fakeRoom({ myMembership: "invite" }))).toBeNull();
            expect(getClarivaCallDmPeerId(fakeRoom({ myMembership: "leave" }))).toBeNull();
            expect(getClarivaCallDmPeerId(fakeRoom({ space: true }))).toBeNull();
            expect(getClarivaCallDmPeerId(fakeRoom({ name: "Project X" }))).toBeNull();
        });

        it("an empty name does not make it a group", () => {
            expect(getClarivaCallDmPeerId(fakeRoom({ name: "" }))).toBe(PEER);
        });

        it("is not a DM when the two active members cannot be told apart (members not loaded yet)", () => {
            // the summary says two, but only one member is loaded
            expect(
                getClarivaCallDmPeerId(fakeRoom({ count: 2, members: [{ userId: ME, membership: "join" }] })),
            ).toBeNull();
            // two others, none of them me
            expect(
                getClarivaCallDmPeerId(
                    fakeRoom({
                        count: 2,
                        members: [
                            { userId: "@a:clarivahub.com", membership: "join" },
                            { userId: "@b:clarivahub.com", membership: "join" },
                        ],
                    }),
                ),
            ).toBeNull();
        });
    });

    it("an unlisted, unnamed two-member room is a call DM but not a billed DM (the helpers part ways only here)", () => {
        const room = fakeRoom();
        expect(getClarivaCallDmPeerId(room)).toBe(PEER);
        expect(getClarivaDmPeerId(room)).toBeNull();

        // ...and once m.direct lists it, they agree again
        direct = PEER;
        expect(getClarivaCallDmPeerId(room)).toBe(PEER);
        expect(getClarivaDmPeerId(room)).toBe(PEER);
    });
});
