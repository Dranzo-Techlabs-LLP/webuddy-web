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
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type MatrixClient, MatrixError } from "matrix-js-sdk/src/matrix";
import { mocked, type Mocked } from "jest-mock";

import InviteDialog from "../../src/components/views/dialogs/InviteDialog";
import { InviteKind } from "../../src/components/views/dialogs/InviteDialogTypes";
import { clearAllModals, filterConsole, getMockClientWithEventEmitter } from "../test-utils";
import DMRoomMap from "../../src/utils/DMRoomMap";
import SdkConfig from "../../src/SdkConfig";
import { type ValidatedServerConfig } from "../../src/utils/ValidatedServerConfig";
import { SdkContextClass } from "../../src/contexts/SDKContext";
import { startDmOnFirstMessage } from "../../src/utils/direct-messages";
import { configureClariva } from "./helpers";

jest.mock("../../src/utils/direct-messages", () => ({
    ...jest.requireActual("../../src/utils/direct-messages"),
    __esModule: true,
    startDmOnFirstMessage: jest.fn(),
}));

const MY_ID = "@bob:clarivahub.com";
const PROFILES: Record<string, string> = {
    "@mohamed:clarivahub.com": "Mohamed",
    "@jane:clarivahub.com": "Jane",
};

describe("Start chat picks ONE user while group rooms are off (Android SelectionMode.Single)", () => {
    let client: Mocked<MatrixClient>;

    filterConsole("Error retrieving profile for userId");

    const input = (): HTMLInputElement => screen.getByTestId("invite-dialog-input") as HTMLInputElement;
    const pick = async (id: string): Promise<void> => {
        fireEvent.change(input(), { target: { value: id } });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(250);
        });
        fireEvent.click(screen.getByText(PROFILES[id]));
    };
    const go = async (): Promise<void> => {
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Go" }));
        });
    };

    beforeEach(() => {
        jest.useFakeTimers();
        client = getMockClientWithEventEmitter({
            getUserId: jest.fn().mockReturnValue(MY_ID),
            getSafeUserId: jest.fn().mockReturnValue(MY_ID),
            isGuest: jest.fn().mockReturnValue(false),
            getVisibleRooms: jest.fn().mockReturnValue([]),
            getRoom: jest.fn().mockReturnValue(null),
            getRooms: jest.fn().mockReturnValue([]),
            getAccountData: jest.fn(),
            getPushActionsForEvent: jest.fn(),
            mxcUrlToHttp: jest.fn().mockReturnValue(""),
            isRoomEncrypted: jest.fn().mockReturnValue(false),
            getProfileInfo: jest.fn().mockImplementation(async (userId: string) => {
                if (PROFILES[userId]) return { displayname: PROFILES[userId] };
                throw new MatrixError({ errcode: "M_NOT_FOUND", error: "Profile not found" });
            }),
            getIdentityServerUrl: jest.fn(),
            searchUserDirectory: jest.fn().mockResolvedValue({ results: [] }),
            lookupThreePid: jest.fn(),
            supportsThreads: jest.fn().mockReturnValue(false),
            isInitialSyncComplete: jest.fn().mockReturnValue(true),
            getClientWellKnown: jest.fn().mockReturnValue({}),
        }) as Mocked<MatrixClient>;
        SdkContextClass.instance.client = client;
        DMRoomMap.makeShared(client);
        jest.spyOn(DMRoomMap.shared(), "getUniqueRoomsWithIndividuals").mockReturnValue({});
        mocked(startDmOnFirstMessage).mockReset().mockResolvedValue("!local:clarivahub.com");
    });

    afterEach(async () => {
        await clearAllModals();
        SdkContextClass.instance.onLoggedOut();
        SdkContextClass.instance.client = undefined;
        jest.useRealTimers();
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    const configure = (extra: Record<string, unknown> = {}): void => {
        configureClariva(extra);
        SdkConfig.add({ validated_server_config: {} as ValidatedServerConfig });
    };

    it("picking a second user replaces the first", async () => {
        configure();
        render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
        await pick("@mohamed:clarivahub.com");
        await pick("@jane:clarivahub.com");
        await go();
        expect(startDmOnFirstMessage).toHaveBeenCalledWith(client, [
            expect.objectContaining({ userId: "@jane:clarivahub.com" }),
        ]);
    });

    it("keeps the stock multi-selection when group rooms are on", async () => {
        configure({ features: { group_rooms: true } });
        render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
        await pick("@mohamed:clarivahub.com");
        await pick("@jane:clarivahub.com");
        await go();
        expect(mocked(startDmOnFirstMessage).mock.calls[0][1]).toHaveLength(2);
    });
});
