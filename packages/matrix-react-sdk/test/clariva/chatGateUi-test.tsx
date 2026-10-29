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
import { EventEmitter } from "events";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import { WalletStore } from "../../src/clariva/stores/WalletStore";
import { getClarivaDmPeerId } from "../../src/clariva/chat/dmPeer";
import { ChatRestrictedBar } from "../../src/clariva/components/chat/ChatRestrictedBar";
import { ClarivaComposerGate } from "../../src/clariva/components/chat/ComposerGate";
import { NewSessionDialog } from "../../src/clariva/components/chat/NewSessionDialog";
import { ClarivaRoomTileRate, resetRateLookupsForTests } from "../../src/clariva/components/chat/RoomTileRate";
import { chatStrings } from "../../src/clariva/strings/chat";
import { CLIENT, CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

jest.mock("../../src/clariva/chat/dmPeer", () => ({ getClarivaDmPeerId: jest.fn() }));

const mockPeer = getClarivaDmPeerId as jest.Mock;
const enc = encodeURIComponent;

describe("ChatRestrictedBar", () => {
    it("shows the exact Android copy and the current / required line", () => {
        render(<ChatRestrictedBar credits={20} required={50} />);
        expect(screen.getByText("Chat restricted. Please recharge your wallet to continue.")).toBeInTheDocument();
        expect(screen.getByText("Current: 20 | Required: 50")).toBeInTheDocument();
    });

    it("keeps decimals when the balance has cents", () => {
        render(<ChatRestrictedBar credits={49.5} required={50} />);
        expect(screen.getByText("Current: 49.50 | Required: 50")).toBeInTheDocument();
    });

    it("omits the second line unless BOTH numbers are known", () => {
        const { rerender } = render(<ChatRestrictedBar credits={null} required={50} />);
        expect(screen.queryByText(/Current:/)).toBeNull();
        rerender(<ChatRestrictedBar credits={20} required={null} />);
        expect(screen.queryByText(/Current:/)).toBeNull();
        expect(screen.getByText(chatStrings.gateRestricted)).toBeInTheDocument();
    });

    it("the Recharge link opens the Wallet settings tab", () => {
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ChatRestrictedBar credits={20} required={50} />);
        fireEvent.click(screen.getByTestId("clariva-chat-restricted-recharge"));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                action: Action.ViewUserSettings,
                initialTabId: expect.stringContaining("WALLET"),
            }),
        );
        dispatch.mockRestore();
    });

    it("consultant <-> consultant: Android's two lines, no amounts and no Recharge button", () => {
        render(<ChatRestrictedBar credits={20} required={50} consultantPeer />);
        expect(screen.getByRole("status")).toHaveAttribute("data-reason", "consultant-peer");
        expect(screen.getByText("You can't chat with other consultants.")).toBeInTheDocument();
        expect(screen.getByText("Consultants can only chat with clients.")).toBeInTheDocument();
        expect(screen.queryByText(chatStrings.gateRestricted)).toBeNull();
        expect(screen.queryByText(/Current:/)).toBeNull();
        expect(screen.queryByTestId("clariva-chat-restricted-recharge")).toBeNull();
    });
});

describe("ClarivaComposerGate", () => {
    afterEach(async () => {
        cleanup();
        WalletStore.resetForTests();
    });

    it("hands the composer the consultant <-> consultant bar for a DM between two consultants", async () => {
        configureClariva();
        WalletStore.resetForTests();
        mockPeer.mockReturnValue(CONSULTANT);
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ isConsultant: 1 })),
            [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                mockResponse(200, walletUser({ Webuddy_name: CONSULTANT, max_credits: "50.00", isConsultant: 1 })),
            "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
        });
        WalletStore.instance.start(ME);
        const room = Object.assign(new EventEmitter(), {
            roomId: "!dm:clarivahub.com",
            currentState: new EventEmitter(),
            client: new EventEmitter(),
        });
        render(
            <ClarivaComposerGate room={room as any}>
                {(bar) => bar ?? <div data-testid="composer">composer</div>}
            </ClarivaComposerGate>,
        );
        await waitFor(() => expect(screen.getByText("You can't chat with other consultants.")).toBeInTheDocument());
        expect(screen.queryByTestId("composer")).toBeNull();
        expect(screen.queryByTestId("clariva-chat-restricted-recharge")).toBeNull();
    });
});

describe("NewSessionDialog", () => {
    it("shows the exact copy", () => {
        render(<NewSessionDialog onFinished={jest.fn()} />);
        expect(screen.getByText("Start a new session?")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Your previous session has ended. Sending this message starts a new billable session and places a fresh hold on your credits.",
            ),
        ).toBeInTheDocument();
        expect(screen.getByText("Never remind me again for this consultant")).toBeInTheDocument();
        expect(screen.getByText("Continue")).toBeInTheDocument();
        expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("Continue reports the unticked checkbox, then the ticked one", () => {
        const first = jest.fn();
        const { unmount } = render(<NewSessionDialog onFinished={first} />);
        fireEvent.click(screen.getByText("Continue"));
        expect(first).toHaveBeenCalledWith(true, false);
        unmount();

        const second = jest.fn();
        render(<NewSessionDialog onFinished={second} />);
        fireEvent.click(screen.getByLabelText("Never remind me again for this consultant"));
        fireEvent.click(screen.getByText("Continue"));
        expect(second).toHaveBeenCalledWith(true, true);
    });

    it("Cancel never reports 'never remind'", () => {
        const onFinished = jest.fn();
        render(<NewSessionDialog onFinished={onFinished} />);
        fireEvent.click(screen.getByLabelText("Never remind me again for this consultant"));
        fireEvent.click(screen.getByText("Cancel"));
        expect(onFinished).toHaveBeenCalledWith(false, false);
    });
});

describe("ClarivaRoomTileRate", () => {
    const room = Object.assign(new EventEmitter(), {
        roomId: "!dm:clarivahub.com",
        currentState: new EventEmitter(),
        client: new EventEmitter(),
    });

    beforeEach(() => {
        configureClariva();
        WalletStore.resetForTests();
        resetRateLookupsForTests();
        mockPeer.mockReset().mockReturnValue(CONSULTANT);
    });

    afterEach(() => {
        cleanup();
        WalletStore.resetForTests();
    });

    const start = async (routes: Record<string, () => Response>): Promise<void> => {
        installFakeApi({ [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()), ...routes });
        WalletStore.instance.start(ME);
        await act(async () => {
            await Promise.resolve();
        });
    };

    it("shows '{n} credits' for a consultant peer", async () => {
        await start({
            [`GET /v1/users/${enc(CONSULTANT)}`]: () =>
                mockResponse(200, walletUser({ max_credits: "50.00", isConsultant: 1 })),
        });
        render(<ClarivaRoomTileRate room={room as any} />);
        expect(await screen.findByText("50 credits")).toBeInTheDocument();
    });

    it("shows nothing for a client peer", async () => {
        mockPeer.mockReturnValue(CLIENT);
        await start({
            [`GET /v1/users/${enc(CLIENT)}`]: () =>
                mockResponse(200, walletUser({ max_credits: "50.00", isConsultant: 0 })),
        });
        render(<ClarivaRoomTileRate room={room as any} />);
        await waitFor(() => expect(WalletStore.instance.getCachedPeer(CLIENT)).toBeDefined());
        expect(screen.queryByTestId("clariva-room-rate")).toBeNull();
    });

    it("never throws for a peer without a wallet row, and shows nothing", async () => {
        await start({
            [`GET /v1/users/${enc(CONSULTANT)}`]: () => mockResponse(404, { message: "User not found" }),
        });
        render(<ClarivaRoomTileRate room={room as any} />);
        await act(async () => {
            for (let i = 0; i < 30; i++) await Promise.resolve();
        });
        expect(screen.queryByTestId("clariva-room-rate")).toBeNull();
    });

    it("shows nothing for rooms that are not 1:1 chats", async () => {
        mockPeer.mockReturnValue(null);
        await start({});
        render(<ClarivaRoomTileRate room={room as any} />);
        expect(screen.queryByTestId("clariva-room-rate")).toBeNull();
    });
});
