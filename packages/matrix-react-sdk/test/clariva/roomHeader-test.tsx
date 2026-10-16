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
import { act, cleanup, render, screen } from "@testing-library/react";
import { PendingEventOrdering, Room, UserEvent } from "matrix-js-sdk/src/matrix";

import RoomHeader from "../../src/components/views/rooms/RoomHeader";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import DMRoomMap from "../../src/utils/DMRoomMap";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import SdkConfig from "../../src/SdkConfig";
import { ClarivaRoleBadge } from "../../src/clariva/components/room/RoleBadge";
import { ClarivaRoomAvatar } from "../../src/clariva/components/room/RoomAvatarRing";
import { ClarivaRoomHeaderSubtitle } from "../../src/clariva/components/room/RoomHeaderSubtitle";
import {
    type PeerPresence,
    presenceLabel,
    presenceStateOf,
    usePeerPresence,
} from "../../src/clariva/components/room/presence";
import { peerInfoOf, useClarivaPeerInfo } from "../../src/clariva/components/room/useClarivaPeerInfo";
import { useClarivaDmPeerId } from "../../src/clariva/chat/useChatGate";
import { getJoinedNonFunctionalMembers } from "../../src/utils/room/getJoinedNonFunctionalMembers";
import { roomStrings } from "../../src/clariva/strings/room";
import { CONSULTANT, configureClariva } from "./helpers";
import { filterConsole, stubClient } from "../test-utils";

jest.mock("../../src/clariva/components/room/useClarivaPeerInfo", () => ({
    ...jest.requireActual("../../src/clariva/components/room/useClarivaPeerInfo"),
    useClarivaPeerInfo: jest.fn(),
}));
// presence: the pure helpers are real, the hook is a switch (usePeerPresence is tested on its own below)
jest.mock("../../src/clariva/components/room/presence", () => {
    const actual = jest.requireActual("../../src/clariva/components/room/presence");
    return { ...actual, usePeerPresence: jest.fn(actual.usePeerPresence) };
});
jest.mock("../../src/clariva/chat/useChatGate", () => ({
    ...jest.requireActual("../../src/clariva/chat/useChatGate"),
    useClarivaDmPeerId: jest.fn(() => null),
}));
jest.mock("../../src/utils/room/getJoinedNonFunctionalMembers", () => ({ getJoinedNonFunctionalMembers: jest.fn() }));
jest.mock("../../src/components/views/avatars/RoomAvatar", () => ({
    __esModule: true,
    default: ({ size }: { size?: string }) => <span data-testid="room-avatar" data-size={size} />,
}));

const online: PeerPresence = { state: "online", lastActiveTs: null };
const mockPresence = (value: PeerPresence | null): void => {
    jest.mocked(usePeerPresence).mockReturnValue(value);
};

describe("ClarivaRoleBadge", () => {
    it("is the 'Consultant' tag, with a decorative shield", () => {
        const { container } = render(<ClarivaRoleBadge />);
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Consultant");
        const icon = container.querySelector("svg");
        expect(icon).toHaveAttribute("aria-hidden", "true");
        expect(icon).toHaveAttribute("focusable", "false");
    });
});

describe("presence helpers", () => {
    it("map a user's presence like the stock indicator: busy, online / active, offline, away, unknown", () => {
        expect(presenceStateOf(null)).toBeNull();
        expect(presenceStateOf({ presence: "online", currentlyActive: false })).toBe("online");
        expect(presenceStateOf({ presence: "unavailable", currentlyActive: true })).toBe("online");
        expect(presenceStateOf({ presence: "unavailable", currentlyActive: false })).toBe("away");
        expect(presenceStateOf({ presence: "offline", currentlyActive: false })).toBe("offline");
        expect(presenceStateOf({ presence: "org.matrix.msc3026.busy", currentlyActive: false })).toBe("busy");
        expect(presenceStateOf({ presence: "something-else", currentlyActive: false })).toBeNull();
    });

    it("label the peer: Online, Away, Busy, 'Last seen 5m ago' or plain Offline when no time is known", () => {
        const now = 1_000_000_000_000;
        expect(presenceLabel({ state: "online", lastActiveTs: null }, now)).toBe("Online");
        expect(presenceLabel({ state: "away", lastActiveTs: null }, now)).toBe("Away");
        expect(presenceLabel({ state: "busy", lastActiveTs: null }, now)).toBe("Busy");
        expect(presenceLabel({ state: "offline", lastActiveTs: null }, now)).toBe("Offline");
        expect(presenceLabel({ state: "offline", lastActiveTs: now - 5 * 60_000 }, now)).toBe("Last seen 5m ago");
        expect(presenceLabel({ state: "offline", lastActiveTs: now + 1000 }, now)).toBe("Offline");
    });
});

describe("usePeerPresence", () => {
    // the real hook, through a small component (the module-level mock above wraps the real implementation)
    const actual = jest.requireActual("../../src/clariva/components/room/presence") as {
        usePeerPresence: typeof usePeerPresence;
    };
    function Probe({ room }: { room: Room }): JSX.Element {
        const presence = actual.usePeerPresence(room);
        return <span data-testid="probe">{presence ? `${presence.state}` : "none"}</span>;
    }

    const user = Object.assign(new EventEmitter(), {
        presence: "online",
        currentlyActive: true,
        getLastActiveTs: () => 0,
    });
    const room = {
        getMember: jest.fn(() => ({ user })),
        client: { baseUrl: "https://hs.example" },
    } as unknown as Room;

    beforeEach(() => {
        SdkConfig.reset();
        configureClariva();
        jest.mocked(useClarivaDmPeerId).mockReturnValue(CONSULTANT);
        jest.mocked(getJoinedNonFunctionalMembers).mockReturnValue([{}, {}] as never);
        user.presence = "online";
        user.currentlyActive = true;
    });

    afterEach(cleanup);

    it("is the other party's presence in a two-person chat, and updates when it changes", () => {
        render(<Probe room={room} />);
        expect(screen.getByTestId("probe")).toHaveTextContent("online");
        user.presence = "unavailable";
        user.currentlyActive = false;
        act(() => {
            user.emit(UserEvent.Presence);
        });
        expect(screen.getByTestId("probe")).toHaveTextContent("away");
    });

    it("is null when it is not shared: no peer (not a 1:1 chat / Clariva off), a group, or presence switched off", () => {
        jest.mocked(useClarivaDmPeerId).mockReturnValue(null);
        const { unmount } = render(<Probe room={room} />);
        expect(screen.getByTestId("probe")).toHaveTextContent("none");
        unmount();

        jest.mocked(useClarivaDmPeerId).mockReturnValue(CONSULTANT);
        jest.mocked(getJoinedNonFunctionalMembers).mockReturnValue([{}, {}, {}] as never);
        const second = render(<Probe room={room} />);
        expect(screen.getByTestId("probe")).toHaveTextContent("none");
        second.unmount();

        jest.mocked(getJoinedNonFunctionalMembers).mockReturnValue([{}, {}] as never);
        SdkConfig.add({
            clariva: { api_base_url: "https://api.test" },
            enable_presence_by_hs_url: { "https://hs.example": false },
        });
        render(<Probe room={room} />);
        expect(screen.getByTestId("probe")).toHaveTextContent("none");
    });
});

describe("ClarivaRoomAvatar", () => {
    const room = {} as Room;
    afterEach(cleanup);

    it("draws a teal ring while the other party is online, and says so to assistive tech", () => {
        mockPresence(online);
        render(<ClarivaRoomAvatar room={room} size="40px" />);
        const avatar = screen.getByTestId("clariva-room-avatar");
        expect(avatar).toHaveAttribute("data-presence", "online");
        expect(avatar).toHaveStyle({ "--cg-avatar-size": "40px" });
        expect(screen.getByTestId("room-avatar")).toHaveAttribute("data-size", "40px");
        expect(avatar).toHaveTextContent(roomStrings.presenceOnline);
    });

    it("has no ring and no extra text when presence is unknown or the peer is offline", () => {
        mockPresence(null);
        const { unmount } = render(<ClarivaRoomAvatar room={room} size="72px" />);
        expect(screen.getByTestId("clariva-room-avatar")).toHaveAttribute("data-presence", "none");
        expect(screen.getByTestId("clariva-room-avatar")).toHaveTextContent("");
        unmount();

        mockPresence({ state: "offline", lastActiveTs: null });
        render(<ClarivaRoomAvatar room={room} size="72px" />);
        expect(screen.getByTestId("clariva-room-avatar")).toHaveAttribute("data-presence", "offline");
        expect(screen.getByTestId("clariva-room-avatar")).toHaveTextContent("");
    });
});

describe("ClarivaRoomHeaderSubtitle", () => {
    const room = {} as Room;
    afterEach(cleanup);

    it("a consultant: the Consultant badge, then the presence line", () => {
        jest.mocked(useClarivaPeerInfo).mockReturnValue({ peerId: CONSULTANT, isConsultant: true, rate: 100 });
        mockPresence(online);
        render(<ClarivaRoomHeaderSubtitle room={room} />);
        const sub = screen.getByTestId("clariva-header-sub");
        expect(sub).toHaveTextContent("ConsultantOnline");
        expect(screen.getByTestId("clariva-role-badge")).toBeInTheDocument();
    });

    it("a client: just the presence line", () => {
        jest.mocked(useClarivaPeerInfo).mockReturnValue({ peerId: CONSULTANT, isConsultant: false, rate: null });
        mockPresence({ state: "away", lastActiveTs: null });
        render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
        expect(screen.getByTestId("clariva-header-sub")).toHaveTextContent("Away");
    });

    it("a consultant without presence: just the badge", () => {
        jest.mocked(useClarivaPeerInfo).mockReturnValue({ peerId: CONSULTANT, isConsultant: true, rate: null });
        mockPresence(null);
        render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(screen.getByTestId("clariva-role-badge")).toBeInTheDocument();
        expect(document.querySelector(".mx_ClarivaRoomHeader_presence")).toBeNull();
    });

    it("renders nothing at all when neither is known, so a plain chat keeps a one-line header", () => {
        jest.mocked(useClarivaPeerInfo).mockReturnValue({ peerId: null, isConsultant: null, rate: null });
        mockPresence(null);
        const { container } = render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("peerInfoOf", () => {
    it("reads role and price the way the chat list's rate tag does", () => {
        expect(peerInfoOf(null, undefined)).toEqual({ peerId: null, isConsultant: null, rate: null });
        expect(peerInfoOf(CONSULTANT, undefined)).toEqual({ peerId: CONSULTANT, isConsultant: null, rate: null });
        expect(peerInfoOf(CONSULTANT, null)).toEqual({ peerId: CONSULTANT, isConsultant: null, rate: null });
        const info = { isConsultant: true, maxCredits: 100 } as never;
        expect(peerInfoOf(CONSULTANT, info)).toEqual({ peerId: CONSULTANT, isConsultant: true, rate: 100 });
        // a client's max_credits is NOT a price: only a consultant has a rate
        const client = { isConsultant: false, maxCredits: 100 } as never;
        expect(peerInfoOf("@asha:clarivahub.com", client)).toEqual({
            peerId: "@asha:clarivahub.com",
            isConsultant: false,
            rate: null,
        });
    });
});

describe("RoomHeader (the Clariva branch)", () => {
    filterConsole(
        "[getType] Room !1:example.org does not have an m.room.create event",
        "Age for event was not available, using `now - origin_server_ts` as a fallback. If the device clock is not correct issues might occur.",
    );

    let room: Room;

    const renderHeader = (): ReturnType<typeof render> =>
        render(<RoomHeader room={room} />, {
            wrapper: ({ children }) => (
                <MatrixClientContext.Provider value={MatrixClientPeg.safeGet()}>
                    {children}
                </MatrixClientContext.Provider>
            ),
        });

    beforeEach(() => {
        stubClient();
        room = new Room("!1:example.org", MatrixClientPeg.get()!, "@alice:example.org", {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        DMRoomMap.setShared({ getUserIdForRoomId: jest.fn() } as unknown as DMRoomMap);
        jest.mocked(useClarivaPeerInfo).mockReturnValue({ peerId: CONSULTANT, isConsultant: true, rate: 100 });
        mockPresence(online);
    });

    afterEach(() => {
        cleanup();
        SdkConfig.reset();
    });

    it("Clariva on: the avatar sits in a presence ring and a consultant gets the badge and presence under the name", () => {
        configureClariva();
        renderHeader();
        expect(screen.getByTestId("clariva-room-avatar")).toHaveAttribute("data-presence", "online");
        expect(screen.getByTestId("clariva-room-avatar")).toHaveStyle({ "--cg-avatar-size": "40px" });
        expect(screen.getByTestId("clariva-header-sub")).toHaveTextContent("ConsultantOnline");
        // the heading is still the room name, level 1, and the info button keeps its name
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("!1:example.org");
        const infoButtons = screen.getAllByRole("button", { name: "Room info" });
        expect(infoButtons.some((b) => b.classList.contains("mx_RoomHeader_infoWrapper"))).toBe(true);
    });

    it("Clariva off: Element's own header, none of the new markup", () => {
        SdkConfig.reset();
        renderHeader();
        expect(screen.queryByTestId("clariva-room-avatar")).toBeNull();
        expect(screen.queryByTestId("clariva-header-sub")).toBeNull();
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
        expect(screen.queryByTestId("clariva-back")).toBeNull();
    });

    it("Clariva on: the Back button is there for phones (CSS shows it below 768px)", () => {
        configureClariva();
        renderHeader();
        expect(screen.getByTestId("clariva-back")).toHaveAccessibleName("Back to chats");
    });
});
