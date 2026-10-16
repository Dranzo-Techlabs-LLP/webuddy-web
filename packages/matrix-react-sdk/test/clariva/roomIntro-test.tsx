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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EventType, type MatrixClient, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { ClarivaDmIntroCard, roomHasContent } from "../../src/clariva/components/room/DmIntroCard";
import { useClarivaPeerInfo } from "../../src/clariva/components/room/useClarivaPeerInfo";
import { useIsEncrypted } from "../../src/hooks/useIsEncrypted";
import { useClarivaCallDmPeerId, useClarivaCallRestriction } from "../../src/clariva/chat";
import { useClarivaDmCalls, useRoomCallState, type RoomCallState } from "../../src/clariva/calls/hooks";
import { ClarivaCalls } from "../../src/clariva/calls/runtime";
import { LOCAL_ROOM_ID_PREFIX, LocalRoom } from "../../src/models/LocalRoom";
import { roomStrings } from "../../src/clariva/strings/room";
import { CONSULTANT, configureClariva } from "./helpers";
import { stubClient } from "../test-utils";

// The intro card asks the wallet about the peer, the room about its encryption and the call stack whether Voice / Video
// are offered. None of those is what is tested here (their results are).
jest.mock("../../src/clariva/components/room/useClarivaPeerInfo", () => ({
    ...jest.requireActual("../../src/clariva/components/room/useClarivaPeerInfo"),
    useClarivaPeerInfo: jest.fn(),
}));
jest.mock("../../src/hooks/useIsEncrypted", () => ({ useIsEncrypted: jest.fn() }));
jest.mock("../../src/clariva/chat", () => ({
    useClarivaCallRestriction: jest.fn(() => false),
    useClarivaCallDmPeerId: jest.fn(() => "@rao:clarivahub.com"),
    useClarivaDmPeerId: jest.fn(() => null),
}));
jest.mock("../../src/clariva/calls/hooks", () => ({
    ...jest.requireActual("../../src/clariva/calls/hooks"),
    useRoomCallState: jest.fn(),
    useClarivaDmCalls: jest.fn(),
}));
jest.mock("../../src/clariva/calls/runtime", () => ({
    ClarivaCalls: {
        startCall: jest.fn(async () => "start_call_dm"),
        joinCall: jest.fn(async () => "join_existing_dm"),
    },
}));
// the avatar ring is tested on its own (roomHeader-test.tsx); here only the size it is given matters
jest.mock("../../src/clariva/components/room/RoomAvatarRing", () => ({
    ClarivaRoomAvatar: ({ size, onClick }: { size: string; onClick?: () => void }) => (
        <button type="button" data-testid="room-avatar" data-size={size} onClick={onClick} />
    ),
}));

const ROOM_ID = "!dm:clarivahub.com";

const callState = (overrides: Partial<RoomCallState> = {}): RoomCallState => ({
    memberships: [],
    hasOngoingCall: false,
    meInCall: false,
    peerInCall: false,
    media: null,
    ...overrides,
});

const message = (type: string): MatrixEvent => ({ getType: () => type }) as unknown as MatrixEvent;

describe("ClarivaDmIntroCard", () => {
    let client: MatrixClient;
    let room: Room;
    let events: MatrixEvent[];

    const setPeer = (isConsultant: boolean | null, rate: number | null): void => {
        jest.mocked(useClarivaPeerInfo).mockReturnValue({ peerId: CONSULTANT, isConsultant, rate });
    };

    const renderCard = (children?: React.ReactNode, onAvatarClick?: () => void): void => {
        render(
            <ClarivaDmIntroCard room={room} client={client} onAvatarClick={onAvatarClick}>
                {children}
            </ClarivaDmIntroCard>,
        );
    };

    beforeEach(() => {
        configureClariva();
        client = stubClient();
        events = [];
        room = Object.assign(new EventEmitter(), {
            roomId: ROOM_ID,
            name: "Dr. Rao",
            client,
            currentState: Object.assign(new EventEmitter(), { mayClientSendStateEvent: jest.fn(() => true) }),
            getLiveTimeline: () => ({ getEvents: () => events }),
        }) as unknown as Room;
        setPeer(true, 100);
        jest.mocked(useIsEncrypted).mockReturnValue(true);
        jest.mocked(useClarivaDmCalls).mockReturnValue(true);
        jest.mocked(useClarivaCallRestriction).mockReturnValue(false);
        jest.mocked(useClarivaCallDmPeerId).mockReturnValue(CONSULTANT);
        jest.mocked(useRoomCallState).mockReturnValue(callState());
        jest.mocked(ClarivaCalls.startCall).mockClear();
    });

    afterEach(() => {
        cleanup();
        jest.clearAllMocks();
    });

    it("is one labelled region with a 72px avatar and the name as a heading", () => {
        renderCard();
        const card = screen.getByRole("region", { name: roomStrings.introLabel });
        expect(card).toBeInTheDocument();
        expect(screen.getByTestId("room-avatar")).toHaveAttribute("data-size", "72px");
        expect(screen.getByRole("heading", { name: "Dr. Rao" })).toBeInTheDocument();
    });

    it("a consultant: the Consultant badge and the rate chip, '100 credits per 24 h chat'", () => {
        renderCard();
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Consultant");
        expect(screen.getByTestId("clariva-intro-rate")).toHaveTextContent("100 credits per 24 h chat");
    });

    it("formats the rate like the chat list (a decimal keeps its cents, thousands are not grouped)", () => {
        setPeer(true, 49.5);
        renderCard();
        expect(screen.getByTestId("clariva-intro-rate")).toHaveTextContent("49.50 credits per 24 h chat");
    });

    it("a client peer: no badge and no rate chip", () => {
        setPeer(false, null);
        renderCard();
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
        expect(screen.queryByTestId("clariva-intro-rate")).toBeNull();
        expect(screen.queryByText(/per 24 h chat/)).toBeNull();
    });

    it("an unknown peer (not looked up yet, not a Clariva user): nothing is guessed", () => {
        setPeer(null, null);
        renderCard();
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
        expect(screen.queryByTestId("clariva-intro-rate")).toBeNull();
        expect(screen.getByRole("heading", { name: "Dr. Rao" })).toBeInTheDocument();
    });

    it("a consultant whose price is unknown shows the badge but no rate", () => {
        setPeer(true, null);
        renderCard();
        expect(screen.getByTestId("clariva-role-badge")).toBeInTheDocument();
        expect(screen.queryByTestId("clariva-intro-rate")).toBeNull();
    });

    it("says 'Private and end-to-end encrypted' only when the room really is encrypted", () => {
        renderCard();
        expect(screen.getByTestId("clariva-intro-private")).toHaveTextContent("Private and end-to-end encrypted");
        cleanup();

        jest.mocked(useIsEncrypted).mockReturnValue(false);
        renderCard();
        expect(screen.queryByTestId("clariva-intro-private")).toBeNull();
        expect(screen.queryByText(/end-to-end/)).toBeNull();
        cleanup();

        jest.mocked(useIsEncrypted).mockReturnValue(undefined);
        renderCard();
        expect(screen.queryByTestId("clariva-intro-private")).toBeNull();
    });

    it("Voice and Video start the call (voice = true / false) and keep the header's accessible names", () => {
        renderCard();
        const voice = screen.getByTestId("clariva-intro-voice");
        const video = screen.getByTestId("clariva-intro-video");
        expect(voice).toHaveAccessibleName("Voice call");
        expect(video).toHaveAccessibleName("Video call");
        expect(voice).toHaveTextContent("Voice");
        expect(video).toHaveTextContent("Video");

        fireEvent.click(voice);
        expect(ClarivaCalls.startCall).toHaveBeenLastCalledWith(room, true);
        fireEvent.click(video);
        expect(ClarivaCalls.startCall).toHaveBeenLastCalledWith(room, false);
    });

    it("a restricted client gets NO call buttons (hidden, not disabled), exactly like the header", () => {
        jest.mocked(useClarivaCallRestriction).mockReturnValue(true);
        renderCard();
        expect(screen.queryByTestId("clariva-intro-voice")).toBeNull();
        expect(screen.queryByTestId("clariva-intro-video")).toBeNull();
        // the rest of the card is still there
        expect(screen.getByRole("heading", { name: "Dr. Rao" })).toBeInTheDocument();
        expect(screen.getByTestId("clariva-intro-rate")).toBeInTheDocument();
    });

    it("offers no call buttons when calls are off, or while a call is already running in the room", () => {
        jest.mocked(useClarivaDmCalls).mockReturnValue(false);
        renderCard();
        expect(screen.queryByTestId("clariva-intro-voice")).toBeNull();
        cleanup();

        jest.mocked(useClarivaDmCalls).mockReturnValue(true);
        jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true }));
        renderCard();
        expect(screen.queryByTestId("clariva-intro-voice")).toBeNull();
    });

    it("offers no call buttons in a room that does not exist on the server yet (a local room)", () => {
        const local = new LocalRoom(`${LOCAL_ROOM_ID_PREFIX}abc`, client, client.getSafeUserId());
        render(<ClarivaDmIntroCard room={local} client={client} />);
        expect(screen.queryByTestId("clariva-intro-voice")).toBeNull();
        expect(screen.queryByTestId("clariva-intro-video")).toBeNull();
    });

    it("disables Voice and Video (but shows them) when the user may not start a call here", () => {
        (room.currentState.mayClientSendStateEvent as jest.Mock).mockReturnValue(false);
        renderCard();
        expect(screen.getByTestId("clariva-intro-voice")).toBeDisabled();
        expect(screen.getByTestId("clariva-intro-video")).toBeDisabled();
    });

    it("an empty chat adds the gentle prompt 'Say hello to <name>'; once somebody has spoken it goes", () => {
        renderCard();
        expect(screen.getByTestId("clariva-dm-hello")).toHaveTextContent("Say hello to Dr. Rao");

        events.push(message(EventType.RoomMessage));
        act(() => {
            room.emit(RoomEvent.Timeline, message(EventType.RoomMessage), room, false, false, {} as never);
        });
        expect(screen.queryByTestId("clariva-dm-hello")).toBeNull();
    });

    it("keeps the stock intro text under the card (nothing is removed)", () => {
        renderCard(<p>This is the beginning of your direct message history with Dr. Rao.</p>);
        expect(screen.getByText(/beginning of your direct message history/)).toBeInTheDocument();
        expect(document.querySelector(".mx_ClarivaDmIntro_note")).toContainElement(
            screen.getByText(/beginning of your direct message history/),
        );
    });

    it("renders no note wrapper when there is no stock text", () => {
        renderCard();
        expect(document.querySelector(".mx_ClarivaDmIntro_note")).toBeNull();
    });

    it("clicking the avatar opens the profile (what the stock intro avatar does)", () => {
        const open = jest.fn();
        renderCard(undefined, open);
        fireEvent.click(screen.getByTestId("room-avatar"));
        expect(open).toHaveBeenCalledTimes(1);
    });
});

describe("roomHasContent", () => {
    const room = (...types: string[]): Room =>
        ({ getLiveTimeline: () => ({ getEvents: () => types.map(message) }) }) as unknown as Room;

    it("is false for a room that only has its setup events", () => {
        expect(roomHasContent(room(EventType.RoomCreate, EventType.RoomMember, EventType.RoomPowerLevels))).toBe(false);
        expect(roomHasContent(room())).toBe(false);
    });

    it("is true once somebody wrote, sent an encrypted message, a sticker or started a call", () => {
        expect(roomHasContent(room(EventType.RoomCreate, EventType.RoomMessage))).toBe(true);
        expect(roomHasContent(room(EventType.RoomMessageEncrypted))).toBe(true);
        expect(roomHasContent(room("m.sticker"))).toBe(true);
    });
});
