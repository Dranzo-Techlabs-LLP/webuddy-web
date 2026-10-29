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
import { cleanup, render, screen } from "@testing-library/react";
import { PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import RoomHeader from "../../src/components/views/rooms/RoomHeader";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import DMRoomMap from "../../src/utils/DMRoomMap";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import SdkConfig from "../../src/SdkConfig";
import { ClarivaRoleBadge } from "../../src/clariva/components/room/RoleBadge";
import { ClarivaRoomAvatar } from "../../src/clariva/components/room/RoomAvatarRing";
import { ClarivaRoomHeaderSubtitle } from "../../src/clariva/components/room/RoomHeaderSubtitle";
import { type DmPeerStatus, useDmPeerStatus } from "../../src/clariva/presence/useDmPeerStatus";
import { peerInfoOf, useClarivaPeerInfo } from "../../src/clariva/components/room/useClarivaPeerInfo";
import { CONSULTANT, configureClariva } from "./helpers";
import { filterConsole, stubClient } from "../test-utils";

jest.mock("../../src/clariva/components/room/useClarivaPeerInfo", () => ({
    ...jest.requireActual("../../src/clariva/components/room/useClarivaPeerInfo"),
    useClarivaPeerInfo: jest.fn(),
}));
// the header's data source is a switch here (useDmPeerStatus has its own suite: dmPeerStatus-test.tsx)
jest.mock("../../src/clariva/presence/useDmPeerStatus", () => ({ useDmPeerStatus: jest.fn() }));
jest.mock("../../src/components/views/avatars/RoomAvatar", () => ({
    __esModule: true,
    default: ({ size }: { size?: string }) => <span data-testid="room-avatar" data-size={size} />,
}));

const status = (overrides: Partial<DmPeerStatus> = {}): DmPeerStatus => ({
    peerId: CONSULTANT,
    badge: null,
    presence: null,
    online: false,
    ...overrides,
});
const mockStatus = (overrides: Partial<DmPeerStatus> = {}): void => {
    jest.mocked(useDmPeerStatus).mockReturnValue(status(overrides));
};
const online: Partial<DmPeerStatus> = { badge: "Consultant", presence: "online", online: true };

describe("ClarivaRoleBadge", () => {
    afterEach(cleanup);

    it("is the 'Consultant' tag by default, with a decorative shield", () => {
        const { container } = render(<ClarivaRoleBadge />);
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Consultant");
        const icon = container.querySelector("svg");
        expect(icon).toHaveAttribute("aria-hidden", "true");
        expect(icon).toHaveAttribute("focusable", "false");
    });

    it("shows a designation, with the full text as its tooltip (a long one is cut with '...' by CSS)", () => {
        const long = "Senior Interventional Cardiologist";
        render(<ClarivaRoleBadge text={long} />);
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent(long);
        expect(screen.getByTestId("clariva-role-badge")).toHaveAttribute("title", long);
    });
});

describe("ClarivaRoomAvatar", () => {
    const room = {} as Room;
    afterEach(cleanup);

    it("draws a teal ring while the other party shows as online, and says so to assistive tech", () => {
        mockStatus(online);
        render(<ClarivaRoomAvatar room={room} size="40px" />);
        const avatar = screen.getByTestId("clariva-room-avatar");
        expect(avatar).toHaveAttribute("data-presence", "online");
        expect(avatar).toHaveStyle({ "--cg-avatar-size": "40px" });
        expect(screen.getByTestId("room-avatar")).toHaveAttribute("data-size", "40px");
        expect(avatar).toHaveTextContent("online");
    });

    it("has no ring and no extra text while the presence is hidden, unknown or a 'last seen'", () => {
        mockStatus();
        const { unmount } = render(<ClarivaRoomAvatar room={room} size="72px" />);
        expect(screen.getByTestId("clariva-room-avatar")).toHaveAttribute("data-presence", "none");
        expect(screen.getByTestId("clariva-room-avatar")).toHaveTextContent("");
        unmount();

        mockStatus({ presence: "last seen today at 10:30" });
        render(<ClarivaRoomAvatar room={room} size="72px" />);
        expect(screen.getByTestId("clariva-room-avatar")).toHaveAttribute("data-presence", "none");
        expect(screen.getByTestId("clariva-room-avatar")).toHaveTextContent("");
    });
});

describe("ClarivaRoomHeaderSubtitle", () => {
    const room = {} as Room;
    afterEach(cleanup);

    it("a consultant: the designation badge, then the presence line ('online' is marked for its dot)", () => {
        mockStatus({ ...online, badge: "Cardiologist" });
        render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(screen.getByTestId("clariva-header-sub")).toHaveTextContent("Cardiologistonline");
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Cardiologist");
        expect(screen.getByTestId("clariva-header-presence")).toHaveAttribute("data-presence", "online");
    });

    it("a client: just the presence line, a 'last seen' without the online dot", () => {
        mockStatus({ presence: "last seen yesterday at 22:45" });
        render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
        expect(screen.getByTestId("clariva-header-presence")).toHaveTextContent("last seen yesterday at 22:45");
        expect(screen.getByTestId("clariva-header-presence")).toHaveAttribute("data-presence", "last-seen");
    });

    it("a consultant whose presence is hidden: just the badge", () => {
        mockStatus({ badge: "Consultant" });
        render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(screen.getByTestId("clariva-role-badge")).toBeInTheDocument();
        expect(screen.queryByTestId("clariva-header-presence")).toBeNull();
    });

    it("renders nothing at all when neither is known, so a plain chat keeps a one-line header", () => {
        mockStatus({ peerId: null });
        const { container } = render(<ClarivaRoomHeaderSubtitle room={room} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("peerInfoOf", () => {
    it("reads role and price the way the chat list's rate tag does", () => {
        const none = { isConsultant: null, rate: null, badge: null };
        expect(peerInfoOf(null, undefined)).toEqual({ peerId: null, ...none });
        expect(peerInfoOf(CONSULTANT, undefined)).toEqual({ peerId: CONSULTANT, ...none });
        expect(peerInfoOf(CONSULTANT, null)).toEqual({ peerId: CONSULTANT, ...none });
        const info = { isConsultant: true, maxCredits: 100 } as never;
        expect(peerInfoOf(CONSULTANT, info)).toEqual({
            peerId: CONSULTANT,
            isConsultant: true,
            rate: 100,
            badge: "Consultant",
        });
        const designated = { isConsultant: true, maxCredits: 100, designation: "Dentist" } as never;
        expect(peerInfoOf(CONSULTANT, designated).badge).toBe("Dentist");
        // a client's max_credits is NOT a price: only a consultant has a rate
        const client = { isConsultant: false, maxCredits: 100 } as never;
        expect(peerInfoOf("@asha:clarivahub.com", client)).toEqual({
            peerId: "@asha:clarivahub.com",
            isConsultant: false,
            rate: null,
            badge: null,
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
        jest.mocked(useClarivaPeerInfo).mockReturnValue({
            peerId: CONSULTANT,
            isConsultant: true,
            rate: 100,
            badge: "Consultant",
        });
        mockStatus(online);
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
        expect(screen.getByTestId("clariva-header-sub")).toHaveTextContent("Consultantonline");
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
