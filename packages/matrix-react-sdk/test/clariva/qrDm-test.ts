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

import { mocked, type Mocked } from "jest-mock";
import { type MatrixClient, Preset } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import Modal from "../../src/Modal";
import dis from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import createRoom from "../../src/createRoom";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import * as dm from "../../src/utils/direct-messages";
import { findDMRoom } from "../../src/utils/dm/findDMRoom";
import { createDmLocalRoom } from "../../src/utils/dm/createDmLocalRoom";
import { LocalRoom, LOCAL_ROOM_ID_PREFIX } from "../../src/models/LocalRoom";
import { CLARIVA_DM_CALL_MEMBER_EVENT_TYPES, withClarivaDmPowerLevels } from "../../src/clariva/qr/dmOptions";
import { confirmStartDm, needsStartDmConfirmation } from "../../src/clariva/qr/confirmStartDm";
import { qrStrings } from "../../src/clariva/strings/qr";
import { mockPlatformPeg, stubClient } from "../test-utils";
import { configureClariva, ME } from "./helpers";

jest.mock("../../src/utils/dm/findDMRoom", () => ({ findDMRoom: jest.fn() }));
jest.mock("../../src/utils/dm/createDmLocalRoom", () => ({ createDmLocalRoom: jest.fn() }));
jest.mock("../../src/utils/threepids", () => ({
    resolveThreePids: jest.fn(async (members: dm.Member[]) => members),
}));

const JANE = "@jane:clarivahub.com";
const jane = new dm.DirectoryMember({ user_id: JANE, display_name: "Jane Doe" });

/** Make `Modal.createDialog` answer a dialog with `answer` (the first argument of its `onFinished`). */
function answerDialogWith(answer: boolean): jest.SpyInstance {
    return jest
        .spyOn(Modal, "createDialog")
        .mockImplementation(
            () =>
                ({ finished: Promise.resolve([answer]), close: jest.fn() }) as unknown as ReturnType<
                    typeof Modal.createDialog
                >,
        );
}

describe("Clariva DM creation (spec 04 §3.16, §5.7)", () => {
    mockPlatformPeg();

    beforeEach(() => {
        jest.clearAllMocks(); // the module mocks above keep their call history between tests otherwise
    });

    afterEach(() => {
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    describe("power levels", () => {
        it("lets both members publish call membership and keeps Synapse's default event levels", () => {
            const result = withClarivaDmPowerLevels(undefined, { "m.room.name": 50, "m.room.power_levels": 100 });
            expect(result.events).toEqual({
                "m.room.name": 50,
                "m.room.power_levels": 100,
                "m.call.member": 0,
                "org.matrix.msc3401.call.member": 0,
            });
            expect(CLARIVA_DM_CALL_MEMBER_EVENT_TYPES).toEqual(["m.call.member", "org.matrix.msc3401.call.member"]);
        });

        it("keeps what the caller already set (and does not mutate it)", () => {
            const existing = { events: { "m.room.name": 75, "m.call.member": 100 }, users_default: 5 };
            const result = withClarivaDmPowerLevels(existing, { "m.room.name": 50, "m.room.topic": 50 });
            expect(result).toEqual({
                users_default: 5,
                events: {
                    "m.room.name": 75,
                    "m.room.topic": 50,
                    "m.call.member": 0,
                    "org.matrix.msc3401.call.member": 0,
                },
            });
            expect(existing).toEqual({ events: { "m.room.name": 75, "m.call.member": 100 }, users_default: 5 });
        });
    });

    describe("createRoom({ dmUserId })", () => {
        let client: Mocked<MatrixClient>;

        beforeEach(() => {
            stubClient();
            client = mocked(MatrixClientPeg.safeGet());
        });

        const createOptsOf = (): Record<string, any> => client.createRoom.mock.calls[0][0] as Record<string, any>;

        it("applies the Android DM parameters when Clariva is configured", async () => {
            configureClariva();
            await createRoom(client, { dmUserId: JANE, spinner: false, andView: false, encryption: true });
            const opts = createOptsOf();
            expect(opts).toMatchObject({
                preset: Preset.TrustedPrivateChat,
                visibility: "private",
                is_direct: true,
                invite: [JANE],
            });
            expect(opts.name).toBeUndefined();
            expect(opts.power_level_content_override.events).toMatchObject({
                "m.call.member": 0,
                "org.matrix.msc3401.call.member": 0,
                "m.room.power_levels": 100,
                "m.room.encryption": 100,
            });
            expect(opts.initial_state).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: "m.room.encryption",
                        content: { algorithm: "m.megolm.v1.aes-sha2" },
                    }),
                ]),
            );
        });

        it("never calls the Wallet-API: creating a DM debits nothing", async () => {
            configureClariva();
            const realFetch = (global as any).fetch;
            const fetchSpy = jest.fn();
            (global as any).fetch = fetchSpy;
            try {
                await createRoom(client, { dmUserId: JANE, spinner: false, andView: false });
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                (global as any).fetch = realFetch;
            }
        });

        it("leaves stock Element Web behaviour alone when Clariva is not configured", async () => {
            SdkConfig.reset();
            await createRoom(client, { dmUserId: JANE, spinner: false, andView: false });
            expect(createOptsOf().power_level_content_override).toBeUndefined();
        });

        it("does not touch ordinary (non-DM) rooms", async () => {
            configureClariva();
            await createRoom(client, { spinner: false, andView: false });
            expect(createOptsOf().power_level_content_override).toBeUndefined();
        });
    });

    describe("encryption is unconditional for 1:1 chats", () => {
        let client: MatrixClient;
        let getUserDeviceInfo: jest.Mock;

        beforeEach(() => {
            client = stubClient();
            // the other user has not uploaded any device keys yet
            getUserDeviceInfo = jest.fn().mockResolvedValue(new Map([[JANE, new Map()]]));
            jest.spyOn(client, "getCrypto").mockReturnValue({ getUserDeviceInfo } as any);
        });

        it("Clariva: encrypted without probing the recipient's device keys", async () => {
            configureClariva();
            expect(await dm.determineCreateRoomEncryptionOption(client, [jane])).toBe(true);
            expect(getUserDeviceInfo).not.toHaveBeenCalled();
        });

        it("stock: still depends on the recipient's device keys", async () => {
            SdkConfig.reset();
            expect(await dm.determineCreateRoomEncryptionOption(client, [jane])).toBe(false);
            expect(getUserDeviceInfo).toHaveBeenCalledWith([JANE], true);

            getUserDeviceInfo.mockResolvedValue(new Map([[JANE, new Map([["DEV", {}]])]]));
            expect(await dm.determineCreateRoomEncryptionOption(client, [jane])).toBe(true);
        });

        it("Clariva: an e-mail invite keeps the stock rule", async () => {
            configureClariva();
            expect(await dm.determineCreateRoomEncryptionOption(client, [new dm.ThreepidMember("a@b.co")])).toBe(true); // stock: single 3pid
            expect(await dm.determineCreateRoomEncryptionOption(client, [jane, new dm.ThreepidMember("a@b.co")])).toBe(
                false,
            );
        });
    });

    describe("'Send invite?' confirmation", () => {
        let client: MatrixClient;
        let localRoom: LocalRoom;

        beforeEach(() => {
            client = stubClient();
            jest.spyOn(client, "getUserId").mockReturnValue(ME);
            localRoom = new LocalRoom(LOCAL_ROOM_ID_PREFIX + "x", client, ME);
            mocked(createDmLocalRoom).mockResolvedValue(localRoom);
            mocked(findDMRoom).mockReturnValue(null);
            jest.spyOn(dis, "dispatch");
            configureClariva();
        });

        it("asks with the Android wording before a DM that does not exist yet", async () => {
            const create = answerDialogWith(true);
            await dm.startDmOnFirstMessage(client, [jane]);
            expect(create).toHaveBeenCalledTimes(1);
            expect(create.mock.calls[0][1]).toMatchObject({
                title: "Send invite?",
                description: "Would you like to start a chat with Jane Doe?",
                button: "Send invite",
                cancelButton: "Cancel",
            });
            expect(qrStrings.sendInviteBody("Jane Doe")).toBe("Would you like to start a chat with Jane Doe?");
        });

        it("Send invite -> the chat is started (local room, nothing is created or debited yet)", async () => {
            answerDialogWith(true);
            const roomId = await dm.startDmOnFirstMessage(client, [jane]);
            expect(roomId).toBe(localRoom.roomId);
            expect(dis.dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.ViewRoom, room_id: roomId }),
            );
        });

        it("Cancel -> nothing is started and null is returned", async () => {
            answerDialogWith(false);
            expect(await dm.startDmOnFirstMessage(client, [jane])).toBeNull();
            expect(createDmLocalRoom).not.toHaveBeenCalled();
            expect(dis.dispatch).not.toHaveBeenCalled();
        });

        it("is skipped when the DM exists (it is simply opened)", async () => {
            mocked(findDMRoom).mockReturnValue({ roomId: "!dm:clarivahub.com" } as any);
            const create = answerDialogWith(false);
            expect(await dm.startDmOnFirstMessage(client, [jane])).toBe("!dm:clarivahub.com");
            expect(create).not.toHaveBeenCalled();
        });

        it("is skipped without Clariva configuration (stock behaviour)", async () => {
            SdkConfig.reset();
            const create = answerDialogWith(false);
            expect(await dm.startDmOnFirstMessage(client, [jane])).toBe(localRoom.roomId);
            expect(create).not.toHaveBeenCalled();
        });

        it("applies to a single Matrix user only (not to yourself, e-mail invites or group chats)", () => {
            expect(needsStartDmConfirmation(ME, [jane])).toBe(true);
            expect(needsStartDmConfirmation(ME, [new dm.DirectoryMember({ user_id: ME })])).toBe(false);
            expect(needsStartDmConfirmation(ME, [new dm.ThreepidMember("a@b.co")])).toBe(false);
            expect(needsStartDmConfirmation(ME, [jane, jane])).toBe(false);
            expect(needsStartDmConfirmation(ME, [])).toBe(false);
        });

        it("confirmStartDm falls back to the user id when the member has no name", async () => {
            const create = answerDialogWith(true);
            expect(await confirmStartDm(client, [new dm.DirectoryMember({ user_id: JANE })])).toBe(true);
            expect(create.mock.calls[0][1]).toMatchObject({
                description: `Would you like to start a chat with ${JANE}?`,
            });
        });
    });
});
