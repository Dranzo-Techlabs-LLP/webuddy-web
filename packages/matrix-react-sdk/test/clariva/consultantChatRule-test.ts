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
import QuestionDialog from "../../src/components/views/dialogs/QuestionDialog";
import createRoom from "../../src/createRoom";
import * as dm from "../../src/utils/direct-messages";
import { startDm } from "../../src/utils/dm/startDm";
import { findDMRoom } from "../../src/utils/dm/findDMRoom";
import { findDMForUser } from "../../src/utils/dm/findDMForUser";
import { createDmLocalRoom } from "../../src/utils/dm/createDmLocalRoom";
import { LocalRoom, LOCAL_ROOM_ID_PREFIX } from "../../src/models/LocalRoom";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import {
    ConsultantChatNotAllowedError,
    consultantRulePeer,
    createDmUnlessRefused,
    isConsultantToConsultant,
    refuseConsultantDm,
} from "../../src/clariva/chat/consultantRule";
import { chatStrings } from "../../src/clariva/strings/chat";
import { mockPlatformPeg, stubClient } from "../test-utils";
import { CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

jest.mock("../../src/utils/dm/findDMRoom", () => ({ findDMRoom: jest.fn() }));
jest.mock("../../src/utils/dm/findDMForUser", () => ({ findDMForUser: jest.fn() }));
jest.mock("../../src/utils/dm/createDmLocalRoom", () => ({ createDmLocalRoom: jest.fn() }));
jest.mock("../../src/utils/threepids", () => ({
    resolveThreePids: jest.fn(async (members: dm.Member[]) => members),
}));
jest.mock("../../src/createRoom", () => ({
    __esModule: true,
    default: jest.fn().mockResolvedValue("!new:clarivahub.com"),
    canEncryptToAllUsers: jest.fn().mockResolvedValue(true),
}));

const enc = encodeURIComponent;
const rao = new dm.DirectoryMember({ user_id: CONSULTANT, display_name: "Dr Rao" });

interface Roles {
    me: 0 | 1 | "error";
    peer: 0 | 1 | "error";
}

let fetchMock: jest.Mock;

function installApi(roles: Roles): void {
    fetchMock = installFakeApi({
        [`GET /v1/users/${enc(ME)}`]: () =>
            roles.me === "error"
                ? mockResponse(500, { message: "boom" })
                : mockResponse(200, walletUser({ isConsultant: roles.me })),
        [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
            roles.peer === "error"
                ? mockResponse(500, { message: "boom" })
                : mockResponse(
                      200,
                      walletUser({ Webuddy_name: CONSULTANT, max_credits: "50.00", isConsultant: roles.peer }),
                  ),
        "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
    });
}

const peerLookups = (): number =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(`/v1/users/${enc(CONSULTANT)}`)).length;

const flush = async (): Promise<void> => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
};

async function signIn(roles: Roles): Promise<void> {
    installApi(roles);
    WalletStore.instance.start(ME);
    await flush();
}

/** Answer every dialog with `answer`; the spy records which dialogs were opened. */
function answerDialogsWith(answer: boolean): jest.SpyInstance {
    return jest
        .spyOn(Modal, "createDialog")
        .mockImplementation(
            () =>
                ({ finished: Promise.resolve([answer]), close: jest.fn() }) as unknown as ReturnType<
                    typeof Modal.createDialog
                >,
        );
}

describe("consultants may only chat with clients (Android ee053dc156)", () => {
    mockPlatformPeg();

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        configureClariva();
        WalletStore.resetForTests();
    });

    afterEach(() => {
        WalletStore.resetForTests();
        jest.restoreAllMocks();
        jest.useRealTimers();
        SdkConfig.reset();
    });

    it("keeps Android's exact wording", () => {
        expect(chatStrings.consultantChatNotAllowedTitle).toBe("Can't start chat");
        expect(chatStrings.consultantChatNotAllowedMessage).toBe(
            "You can't chat with other consultants. Consultants can only chat with clients.",
        );
        expect(new ConsultantChatNotAllowedError().message).toBe(chatStrings.consultantChatNotAllowedMessage);
        expect(new ConsultantChatNotAllowedError()).toBeInstanceOf(ConsultantChatNotAllowedError);
    });

    describe("consultantRulePeer", () => {
        it("applies to exactly one Matrix user other than me", () => {
            expect(consultantRulePeer(ME, [CONSULTANT])).toBe(CONSULTANT);
            expect(consultantRulePeer(ME, [ME])).toBeNull();
            expect(consultantRulePeer(ME, ["a@b.co"])).toBeNull();
            expect(consultantRulePeer(ME, [CONSULTANT, "@other:clarivahub.com"])).toBeNull();
            expect(consultantRulePeer(ME, [])).toBeNull();
        });

        it("never applies without Clariva configuration", () => {
            SdkConfig.reset();
            expect(consultantRulePeer(ME, [CONSULTANT])).toBeNull();
        });
    });

    describe("isConsultantToConsultant", () => {
        it("is true only when both roles are confirmed consultants", async () => {
            await signIn({ me: 1, peer: 1 });
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(true);
        });

        it("a consultant may chat with a client", async () => {
            await signIn({ me: 1, peer: 0 });
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(false);
        });

        it("a client never looks the peer up", async () => {
            await signIn({ me: 0, peer: 1 });
            fetchMock.mockClear();
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(false);
            expect(peerLookups()).toBe(0);
        });

        it("an unknown role fails open (mine or the peer's)", async () => {
            await signIn({ me: "error", peer: 1 });
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(false);
            WalletStore.resetForTests();
            await signIn({ me: 1, peer: "error" });
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(false);
        });

        it("signed out: false, no request", async () => {
            installApi({ me: 1, peer: 1 });
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(false);
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("re-reads my role once when it is still unknown", async () => {
            installApi({ me: 1, peer: 1 });
            WalletStore.instance.start(ME); // no flush: the role is still unknown
            expect(WalletStore.instance.isConsultant).toBeNull();
            expect(await isConsultantToConsultant(CONSULTANT)).toBe(true);
        });
    });

    describe("startDmOnFirstMessage (Start chat, Spotlight, user info 'Message')", () => {
        let client: MatrixClient;
        let localRoom: LocalRoom;

        beforeEach(() => {
            client = stubClient();
            jest.spyOn(client, "getUserId").mockReturnValue(ME);
            localRoom = new LocalRoom(LOCAL_ROOM_ID_PREFIX + "x", client, ME);
            mocked(createDmLocalRoom).mockResolvedValue(localRoom);
            mocked(findDMRoom).mockReturnValue(null);
        });

        it("consultant -> consultant: warns 'Can't start chat' (no retry, no 'Send invite?') and starts nothing", async () => {
            await signIn({ me: 1, peer: 1 });
            const dialogs = answerDialogsWith(true);
            expect(await dm.startDmOnFirstMessage(client, [rao])).toBeNull();
            expect(dialogs).toHaveBeenCalledTimes(1);
            expect(dialogs.mock.calls[0][0]).toBe(ErrorDialog);
            expect(dialogs.mock.calls[0][1]).toEqual({
                title: "Can't start chat",
                description: "You can't chat with other consultants. Consultants can only chat with clients.",
            });
            expect(createDmLocalRoom).not.toHaveBeenCalled();
        });

        it("consultant -> client: the usual 'Send invite?' step", async () => {
            await signIn({ me: 1, peer: 0 });
            const dialogs = answerDialogsWith(true);
            expect(await dm.startDmOnFirstMessage(client, [rao])).toBe(localRoom.roomId);
            expect(dialogs).toHaveBeenCalledTimes(1);
            expect(dialogs.mock.calls[0][0]).toBe(QuestionDialog);
        });

        it("an EXISTING consultant <-> consultant DM still opens (its composer shows the bar instead)", async () => {
            await signIn({ me: 1, peer: 1 });
            mocked(findDMRoom).mockReturnValue({ roomId: "!dm:clarivahub.com" } as any);
            const dialogs = answerDialogsWith(true);
            expect(await dm.startDmOnFirstMessage(client, [rao])).toBe("!dm:clarivahub.com");
            expect(dialogs).not.toHaveBeenCalled();
        });

        it("a client is never refused (and the peer is not even looked up)", async () => {
            await signIn({ me: 0, peer: 1 });
            fetchMock.mockClear();
            answerDialogsWith(true);
            expect(await dm.startDmOnFirstMessage(client, [rao])).toBe(localRoom.roomId);
            expect(peerLookups()).toBe(0);
        });
    });

    describe("startDm (creates the room: first message of a local room, e-mail invites)", () => {
        let client: MatrixClient;

        beforeEach(() => {
            client = stubClient();
            jest.spyOn(client, "getUserId").mockReturnValue(ME);
            mocked(findDMForUser).mockReturnValue(undefined);
        });

        it("refuses to create a consultant <-> consultant DM", async () => {
            await signIn({ me: 1, peer: 1 });
            const dialogs = answerDialogsWith(true);
            await expect(startDm(client, [rao], false)).rejects.toBeInstanceOf(ConsultantChatNotAllowedError);
            expect(createRoom).not.toHaveBeenCalled();
            expect(dialogs.mock.calls[0][0]).toBe(ErrorDialog);
        });

        it("creates a consultant -> client DM as before", async () => {
            await signIn({ me: 1, peer: 0 });
            expect(await startDm(client, [rao], false)).toBe("!new:clarivahub.com");
            expect(createRoom).toHaveBeenCalledWith(client, expect.objectContaining({ dmUserId: CONSULTANT }));
        });
    });

    describe("createDmUnlessRefused (the #/user/<id>/chat link)", () => {
        it("runs synchronously when the rule cannot apply (stock Element Web)", () => {
            SdkConfig.reset();
            const create = jest.fn();
            createDmUnlessRefused(ME, [CONSULTANT], create);
            expect(create).toHaveBeenCalledTimes(1);
        });

        it("does not create a consultant <-> consultant DM", async () => {
            await signIn({ me: 1, peer: 1 });
            answerDialogsWith(true);
            const create = jest.fn();
            createDmUnlessRefused(ME, [CONSULTANT], create);
            await flush();
            expect(create).not.toHaveBeenCalled();
        });

        it("creates it otherwise", async () => {
            await signIn({ me: 1, peer: 0 });
            const create = jest.fn();
            createDmUnlessRefused(ME, [CONSULTANT], create);
            await flush();
            expect(create).toHaveBeenCalledTimes(1);
        });
    });

    it("refuseConsultantDm shows the warning only when it refuses", async () => {
        await signIn({ me: 1, peer: 0 });
        const dialogs = answerDialogsWith(true);
        expect(await refuseConsultantDm(ME, [CONSULTANT])).toBe(false);
        expect(dialogs).not.toHaveBeenCalled();
    });
});
