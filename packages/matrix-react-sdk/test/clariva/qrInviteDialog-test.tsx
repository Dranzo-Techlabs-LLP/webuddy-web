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
import { type MatrixClient, MatrixError, Room } from "matrix-js-sdk/src/matrix";
import { mocked, type Mocked } from "jest-mock";

import InviteDialog from "../../src/components/views/dialogs/InviteDialog";
import { InviteKind } from "../../src/components/views/dialogs/InviteDialogTypes";
import { clearAllModals, filterConsole, getMockClientWithEventEmitter } from "../test-utils";
import DMRoomMap from "../../src/utils/DMRoomMap";
import SdkConfig from "../../src/SdkConfig";
import Modal from "../../src/Modal";
import { type ValidatedServerConfig } from "../../src/utils/ValidatedServerConfig";
import { SdkContextClass } from "../../src/contexts/SDKContext";
import { DirectoryMember, startDmOnFirstMessage } from "../../src/utils/direct-messages";
import { configureClariva } from "./helpers";

jest.mock("../../src/utils/direct-messages", () => ({
    ...jest.requireActual("../../src/utils/direct-messages"),
    __esModule: true,
    startDmOnFirstMessage: jest.fn(),
}));

const MY_ID = "@bob:clarivahub.com";
const MY_LINK = "https://clarivahub.com/u/%40bob%3Aclarivahub.com";
const MOHAMED = "@mohamed.shimil4:clarivahub.com";

describe("InviteDialog with Clariva configured (Start chat, spec 04 §2.8 / §3.15)", () => {
    let client: Mocked<MatrixClient>;

    filterConsole(
        "boom", // the "start chat failed" test
        "Error retrieving profile for userId", // expected: profile lookups of users that do not exist
        "does not have an m.room.create event", // the bare Room of the "invite to a room" test
    );

    const input = (): HTMLInputElement => screen.getByTestId("invite-dialog-input") as HTMLInputElement;
    const type = (text: string): void => {
        fireEvent.change(input(), { target: { value: text } });
    };
    const advance = async (ms: number): Promise<void> => {
        await act(async () => {
            await jest.advanceTimersByTimeAsync(ms);
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
                if (userId === MOHAMED) return { displayname: "Mohamed" };
                throw new MatrixError({ errcode: "M_NOT_FOUND", error: "Profile not found" });
            }),
            getIdentityServerUrl: jest.fn(),
            searchUserDirectory: jest.fn().mockResolvedValue({ results: [] }),
            lookupThreePid: jest.fn(),
            supportsThreads: jest.fn().mockReturnValue(false),
            isInitialSyncComplete: jest.fn().mockReturnValue(true),
            getClientWellKnown: jest.fn().mockReturnValue({}),
        }) as Mocked<MatrixClient>;
        configureClariva({ user_link_base: "https://clarivahub.com/u/" });
        SdkConfig.add({ validated_server_config: {} as ValidatedServerConfig });
        DMRoomMap.makeShared(client);
        jest.spyOn(DMRoomMap.shared(), "getUniqueRoomsWithIndividuals").mockReturnValue({});
        SdkContextClass.instance.client = client;
        mocked(startDmOnFirstMessage).mockReset();
    });

    afterEach(async () => {
        await clearAllModals();
        SdkContextClass.instance.onLoggedOut();
        SdkContextClass.instance.client = undefined;
        jest.useRealTimers();
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    it("looks like Android's Start chat: title, placeholder, Scan QR code and My QR code", () => {
        render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
        expect(screen.getByRole("heading", { name: "Start chat" })).toBeInTheDocument();
        expect(input()).toHaveAttribute("placeholder", "Search for someone");
        expect(screen.getByRole("button", { name: "Scan QR code" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "My QR code" })).toBeInTheDocument();
    });

    it("hides the QR entries while searching (Android hides the action list)", () => {
        render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
        type("ja");
        expect(screen.queryByRole("button", { name: "Scan QR code" })).not.toBeInTheDocument();
    });

    it("'Scan QR code' closes Start chat and opens the scanner", () => {
        const create = jest
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: new Promise(() => undefined) } as any);
        const onFinished = jest.fn();
        render(<InviteDialog kind={InviteKind.Dm} onFinished={onFinished} />);
        fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
        expect(onFinished).toHaveBeenCalledWith(false);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("offers no QR entries when inviting to a room", () => {
        const room = new Room("!r:clarivahub.com", client, MY_ID);
        client.getRoom.mockReturnValue(room);
        client.getRooms.mockReturnValue([room]);
        render(<InviteDialog kind={InviteKind.Invite} roomId="!r:clarivahub.com" onFinished={jest.fn()} />);
        expect(screen.queryByRole("button", { name: "Scan QR code" })).not.toBeInTheDocument();
    });

    describe("search rules", () => {
        it("asks the server nothing for fewer than 3 characters", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("ab");
            await advance(2000);
            expect(client.searchUserDirectory).not.toHaveBeenCalled();
            expect(client.getProfileInfo).not.toHaveBeenCalled();
        });

        it("debounces 250 ms and asks for at most 10 results", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("abc");
            await advance(249);
            expect(client.searchUserDirectory).not.toHaveBeenCalled();
            await advance(1);
            expect(client.searchUserDirectory).toHaveBeenCalledTimes(1);
            expect(client.searchUserDirectory).toHaveBeenCalledWith({ term: "abc", limit: 10 });
        });

        it("only the last keystroke of a burst reaches the server", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("abc");
            await advance(100);
            type("abcd");
            await advance(100);
            type("abcde");
            await advance(250);
            expect(client.searchUserDirectory).toHaveBeenCalledTimes(1);
            expect(client.searchUserDirectory).toHaveBeenCalledWith({ term: "abcde", limit: 10 });
        });

        it("shows directory results", async () => {
            // (a name that does not contain the search term, so that the dialog's match highlighting does not split it)
            client.searchUserDirectory.mockResolvedValue({
                results: [{ user_id: "@zed:clarivahub.com", display_name: "Zed Zimmer" }],
                limited: false,
            });
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("amy");
            await advance(250);
            expect(screen.getByText("Zed Zimmer")).toBeInTheDocument();
        });

        it("a bare username becomes @username:<my server> when that profile exists", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("Mohamed.Shimil4");
            await advance(250);
            expect(client.getProfileInfo).toHaveBeenCalledWith(MOHAMED);
            expect(screen.getByText("Mohamed")).toBeInTheDocument();
        });

        it("selecting the derived row adds the user as the chat target", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("mohamed.shimil4");
            await advance(250);
            fireEvent.click(screen.getByText("Mohamed"));
            expect(screen.getByText("Mohamed", { selector: ".mx_InviteDialog_userTile_name" })).toBeInTheDocument();
        });

        it("a username without a profile gives no row, just 'No results'", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("nobody.here");
            await advance(250);
            expect(client.getProfileInfo).toHaveBeenCalledWith("@nobody.here:clarivahub.com");
            expect(screen.getByText("No results")).toBeInTheDocument();
        });

        it("shows a spinner, not 'No results', while the lookups are pending", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("nobody.here");
            expect(screen.queryByText("No results")).not.toBeInTheDocument();
            await advance(250);
            expect(screen.getByText("No results")).toBeInTheDocument();
        });

        it("warns about an explicit Matrix id whose profile cannot be found", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("@ghost:clarivahub.com");
            await advance(250);
            expect(
                screen.getByText("This Matrix ID can't be found, so the invite might not be received."),
            ).toBeInTheDocument();
        });

        it("does not warn about an explicit id that resolves", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type(MOHAMED);
            await advance(250);
            expect(screen.getByText("Mohamed")).toBeInTheDocument();
            expect(screen.queryByText(/can't be found/)).not.toBeInTheDocument();
        });

        it("a pasted Clariva user link finds that user", async () => {
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("https://clarivahub.com/u/%40mohamed.shimil4%3Aclarivahub.com");
            await advance(250);
            expect(client.getProfileInfo).toHaveBeenCalledWith(MOHAMED);
            expect(screen.getByText("Mohamed")).toBeInTheDocument();
        });

        it("never offers me as a result", async () => {
            client.searchUserDirectory.mockResolvedValue({
                results: [{ user_id: MY_ID, display_name: "Bob (me)" }],
                limited: false,
            });
            render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
            type("bob");
            await advance(250);
            expect(screen.queryByText("Bob (me)")).not.toBeInTheDocument();
            expect(client.getProfileInfo).not.toHaveBeenCalled(); // "bob" would derive my own id: no lookup, no row
        });
    });

    describe("starting the chat", () => {
        const target = new DirectoryMember({ user_id: MOHAMED, display_name: "Mohamed" });

        const pickMohamed = async (): Promise<void> => {
            type("mohamed.shimil4");
            await advance(250);
            fireEvent.click(screen.getByText("Mohamed"));
        };

        it("closes the dialog once the chat is started", async () => {
            mocked(startDmOnFirstMessage).mockResolvedValue("!local:clarivahub.com");
            const onFinished = jest.fn();
            render(<InviteDialog kind={InviteKind.Dm} onFinished={onFinished} />);
            await pickMohamed();
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Go" }));
            });
            expect(startDmOnFirstMessage).toHaveBeenCalledWith(client, [
                expect.objectContaining({ userId: target.userId }),
            ]);
            expect(onFinished).toHaveBeenCalledWith(true);
        });

        it("reports a failure with Android's wording and lets the user try again", async () => {
            mocked(startDmOnFirstMessage).mockRejectedValueOnce(new Error("boom"));
            const onFinished = jest.fn();
            render(<InviteDialog kind={InviteKind.Dm} onFinished={onFinished} />);
            await pickMohamed();
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Go" }));
            });
            expect(screen.getByText("An error occurred when trying to start a chat")).toBeInTheDocument();
            expect(onFinished).not.toHaveBeenCalled();

            mocked(startDmOnFirstMessage).mockResolvedValueOnce("!local:clarivahub.com");
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Go" }));
            });
            expect(onFinished).toHaveBeenCalledWith(true);
        });

        it("stays open when the user cancels 'Send invite?'", async () => {
            mocked(startDmOnFirstMessage).mockResolvedValue(null);
            const onFinished = jest.fn();
            render(<InviteDialog kind={InviteKind.Dm} onFinished={onFinished} />);
            await pickMohamed();
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "Go" }));
            });
            expect(startDmOnFirstMessage).toHaveBeenCalledTimes(1);
            expect(onFinished).not.toHaveBeenCalled();
            // and Go works again
            expect(screen.getByRole("button", { name: "Go" })).not.toHaveAttribute("aria-disabled", "true");
        });
    });

    it("shares the Clariva link (same as My QR code) in the footer", () => {
        render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
        expect(screen.getByText(MY_LINK)).toBeInTheDocument();
    });
});

describe("InviteDialog without Clariva configuration", () => {
    let client: Mocked<MatrixClient>;

    beforeEach(() => {
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
            getProfileInfo: jest.fn().mockRejectedValue(new Error("nope")),
            getIdentityServerUrl: jest.fn(),
            searchUserDirectory: jest.fn().mockResolvedValue({ results: [] }),
            lookupThreePid: jest.fn(),
            supportsThreads: jest.fn().mockReturnValue(false),
            isInitialSyncComplete: jest.fn().mockReturnValue(true),
            getClientWellKnown: jest.fn().mockReturnValue({}),
        }) as Mocked<MatrixClient>;
        SdkConfig.reset();
        SdkConfig.add({ validated_server_config: {} as ValidatedServerConfig });
        DMRoomMap.makeShared(client);
        jest.spyOn(DMRoomMap.shared(), "getUniqueRoomsWithIndividuals").mockReturnValue({});
        SdkContextClass.instance.client = client;
    });

    afterEach(async () => {
        await clearAllModals();
        SdkContextClass.instance.onLoggedOut();
        SdkContextClass.instance.client = undefined;
        jest.restoreAllMocks();
    });

    it("is stock Element Web: no QR entries, stock title and footer, stock lookup rules", async () => {
        render(<InviteDialog kind={InviteKind.Dm} onFinished={jest.fn()} />);
        expect(screen.queryByRole("button", { name: "Scan QR code" })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Start chat" })).not.toBeInTheDocument();
        expect(screen.getByTestId("invite-dialog-input")).not.toHaveAttribute("placeholder");
        expect(screen.getByText(/matrix\.to/)).toBeInTheDocument();

        // the stock dialog searches the directory even for a 2 character term, after 150 ms
        fireEvent.change(screen.getByTestId("invite-dialog-input"), { target: { value: "ab" } });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
        });
        expect(client.searchUserDirectory).toHaveBeenCalledWith({ term: "ab" });
    });
});
