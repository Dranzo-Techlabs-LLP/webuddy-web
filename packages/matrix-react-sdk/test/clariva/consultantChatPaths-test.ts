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

import { mocked } from "jest-mock";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import Modal from "../../src/Modal";
import ErrorDialog from "../../src/components/views/dialogs/ErrorDialog";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import { getCommand } from "../../src/SlashCommands";
import ContentMessages from "../../src/ContentMessages";
import * as dm from "../../src/utils/direct-messages";
import { startDm } from "../../src/utils/dm/startDm";
import { findDMRoom } from "../../src/utils/dm/findDMRoom";
import { findDMForUser } from "../../src/utils/dm/findDMForUser";
import { LocalRoom, LocalRoomState, LOCAL_ROOM_ID_PREFIX } from "../../src/models/LocalRoom";
import SpaceStore from "../../src/stores/spaces/SpaceStore";
import { MetaSpace } from "../../src/stores/spaces";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { ConsultantChatNotAllowedError } from "../../src/clariva/chat/consultantRule";
import { refuseGroupDm } from "../../src/clariva/chat/groupRooms";
import { chatRestrictionReason } from "../../src/clariva/chat/useChatGate";
import { chatRestrictedTitle, showChatRestrictedNotice } from "../../src/clariva/components/chat/gateDialogs";
import { chatStrings } from "../../src/clariva/strings/chat";
import { filterConsole, mockPlatformPeg, stubClient } from "../test-utils";
import { CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

jest.mock("../../src/utils/dm/findDMRoom", () => ({ findDMRoom: jest.fn() }));
jest.mock("../../src/utils/dm/findDMForUser", () => ({ findDMForUser: jest.fn() }));
jest.mock("../../src/utils/dm/startDm", () => ({ startDm: jest.fn() }));
jest.mock("../../src/utils/threepids", () => ({
    resolveThreePids: jest.fn(async (members: unknown[]) => members),
}));
jest.mock("../../src/clariva/chat/useChatGate", () => ({
    ...jest.requireActual("../../src/clariva/chat/useChatGate"),
    chatRestrictionReason: jest.fn().mockReturnValue(null),
}));

const enc = encodeURIComponent;

function signInAs(me: 0 | 1, peer: 0 | 1): Promise<void> {
    installFakeApi({
        [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: me })),
        [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
            mockResponse(200, walletUser({ Webuddy_name: CONSULTANT, max_credits: "50.00", isConsultant: peer })),
        "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
    });
    WalletStore.instance.start(ME);
    return flush();
}

async function flush(): Promise<void> {
    for (let i = 0; i < 60; i++) await Promise.resolve();
}

function spyDialogs(): jest.SpyInstance {
    return jest
        .spyOn(Modal, "createDialog")
        .mockImplementation(
            () =>
                ({ finished: Promise.resolve([true]), close: jest.fn() }) as unknown as ReturnType<
                    typeof Modal.createDialog
                >,
        );
}

describe("consultant chat rule and hidden group rooms: the other paths (review fixes)", () => {
    mockPlatformPeg();
    filterConsole("Error creating DM for local room");

    let client: MatrixClient;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        configureClariva();
        WalletStore.resetForTests();
        client = stubClient();
        jest.spyOn(client, "getUserId").mockReturnValue(ME);
        client.sendTextMessage = jest.fn().mockResolvedValue({ event_id: "$e" });
        mocked(findDMForUser).mockReturnValue(undefined);
        mocked(findDMRoom).mockReturnValue(null);
    });

    afterEach(() => {
        WalletStore.resetForTests();
        jest.restoreAllMocks();
        jest.useRealTimers();
        SdkConfig.reset();
    });

    describe("/msg and /query (ensureDMExists)", () => {
        it("/msg to another consultant creates no room, sends nothing and shows only 'Can't start chat'", async () => {
            await signInAs(1, 1);
            const dialogs = spyDialogs();
            const command = getCommand(`/msg ${CONSULTANT} hi`);
            const result = command.cmd!.run(client, "!client-dm:clarivahub.com", null, command.args);
            await expect(result.promise).resolves.toBeUndefined(); // no stock "Command error" on top
            expect(client.createRoom).not.toHaveBeenCalled();
            expect(client.sendTextMessage).not.toHaveBeenCalled();
            expect(dialogs).toHaveBeenCalledTimes(1);
            expect(dialogs.mock.calls[0][0]).toBe(ErrorDialog);
            expect(dialogs.mock.calls[0][1]).toEqual(expect.objectContaining({ title: "Can't start chat" }));
        });

        it("/query to another consultant is refused the same way", async () => {
            await signInAs(1, 1);
            const dialogs = spyDialogs();
            const command = getCommand(`/query ${CONSULTANT}`);
            await expect(command.cmd!.run(client, "!r:clarivahub.com", null, command.args).promise).resolves.toBe(
                undefined,
            );
            expect(client.createRoom).not.toHaveBeenCalled();
            expect(dialogs).toHaveBeenCalledTimes(1);
        });

        it("an EXISTING consultant <-> consultant DM is still used", async () => {
            await signInAs(1, 1);
            mocked(findDMForUser).mockReturnValue({ roomId: "!dm:clarivahub.com" } as any);
            const dialogs = spyDialogs();
            const command = getCommand(`/msg ${CONSULTANT} hi`);
            await command.cmd!.run(client, "!r:clarivahub.com", null, command.args).promise;
            expect(client.sendTextMessage).toHaveBeenCalledWith("!dm:clarivahub.com", "hi");
            expect(dialogs).not.toHaveBeenCalled();
        });
    });

    describe("createRoomFromLocalRoom: a late refusal (roles confirmed by the first send)", () => {
        let localRoom: LocalRoom;

        beforeEach(() => {
            localRoom = new LocalRoom(LOCAL_ROOM_ID_PREFIX + "x", client, ME);
            localRoom.targets = [new dm.DirectoryMember({ user_id: CONSULTANT })];
        });

        it("discards the local room instead of leaving it in ERROR with a Retry", async () => {
            mocked(startDm).mockRejectedValue(new ConsultantChatNotAllowedError());
            const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
            await dm.createRoomFromLocalRoom(client, localRoom);
            expect(localRoom.state).not.toBe(LocalRoomState.ERROR);
            expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewHomePage });
        });

        it("any other failure keeps the stock ERROR state (Retry)", async () => {
            mocked(startDm).mockRejectedValue(new Error("boom"));
            const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
            await dm.createRoomFromLocalRoom(client, localRoom);
            expect(localRoom.state).toBe(LocalRoomState.ERROR);
            expect(dispatch).not.toHaveBeenCalledWith({ action: Action.ViewHomePage });
        });
    });

    describe("no group chats while group rooms are off", () => {
        const two = ["@a:clarivahub.com", "@b:clarivahub.com"];

        it("refuseGroupDm throws only for several targets with group rooms off", () => {
            expect(() => refuseGroupDm(two)).toThrow();
            expect(() => refuseGroupDm([two[0]])).not.toThrow();
            configureClariva({ features: { group_rooms: true } });
            expect(() => refuseGroupDm(two)).not.toThrow();
            SdkConfig.reset();
            expect(() => refuseGroupDm(two)).not.toThrow();
        });

        it("startDmOnFirstMessage refuses a multi-person DM (a consultant cannot bundle another consultant in)", async () => {
            await signInAs(0, 0);
            const members = two.map((id) => new dm.DirectoryMember({ user_id: id }));
            await expect(dm.startDmOnFirstMessage(client, members)).rejects.toThrow("group chats");
        });

        it("no space can become the active one (a restored selection stays on Home)", () => {
            jest.spyOn(SpaceStore.instance, "matrixClient", "get").mockReturnValue(client);
            const getRoom = jest.spyOn(client, "getRoom");
            getRoom.mockClear();
            SpaceStore.instance.setActiveSpace("!space:clarivahub.com", false);
            expect(SpaceStore.instance.activeSpace).toBe(MetaSpace.Home);
            expect(getRoom).not.toHaveBeenCalledWith("!space:clarivahub.com");
        });
    });

    describe("guards without a composer bar word a consultant <-> consultant DM like the bar", () => {
        it("titles", () => {
            expect(chatRestrictedTitle("consultant-peer")).toBe("You can't chat with other consultants.");
            expect(chatRestrictedTitle("insufficient")).toBe(chatStrings.gateRestricted);
            expect(chatRestrictedTitle(null)).toBe(chatStrings.gateRestricted);
        });

        it("an attachment in a consultant <-> consultant DM shows the consultant wording, not 'recharge'", async () => {
            mocked(chatRestrictionReason).mockReturnValue("consultant-peer");
            const dialogs = spyDialogs();
            const upload = jest.spyOn(client, "uploadContent");
            await ContentMessages.sharedInstance().sendContentListToRoom(
                [new File(["x"], "a.txt")],
                "!dm:clarivahub.com",
                undefined,
                client,
            );
            expect(upload).not.toHaveBeenCalled();
            expect(dialogs).toHaveBeenCalledWith(ErrorDialog, {
                title: "You can't chat with other consultants.",
                description: "Consultants can only chat with clients.",
                button: chatStrings.sessionInsufficientClose,
            });
        });

        it("the wallet wording stays for a client who must recharge", () => {
            const dialogs = spyDialogs();
            showChatRestrictedNotice("insufficient");
            expect(dialogs).toHaveBeenCalledWith(ErrorDialog, {
                title: chatStrings.gateRestricted,
                description: undefined,
                button: chatStrings.sessionInsufficientClose,
            });
        });
    });
});
