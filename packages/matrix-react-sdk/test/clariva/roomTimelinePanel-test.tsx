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
import { cleanup, render, screen } from "@testing-library/react";
import { type MatrixClient, type MatrixEvent, Room, type RoomMember } from "matrix-js-sdk/src/matrix";

import MessagePanel from "../../src/components/structures/MessagePanel";
import WhoIsTypingTile from "../../src/components/views/rooms/WhoIsTypingTile";
import SettingsStore from "../../src/settings/SettingsStore";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import RoomContext, { TimelineRenderingType } from "../../src/contexts/RoomContext";
import DMRoomMap from "../../src/utils/DMRoomMap";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import ResizeNotifier from "../../src/utils/ResizeNotifier";
import SdkConfig from "../../src/SdkConfig";
import { type IRoomState } from "../../src/components/structures/RoomView";
import { DATE_ATTR } from "../../src/clariva/components/room/stickyDates";
import * as WhoIsTyping from "../../src/WhoIsTyping";
import { configureClariva } from "./helpers";
import {
    getMockClientWithEventEmitter,
    mkMessage,
    mockClientMethodsEvents,
    mockClientMethodsUser,
} from "../test-utils";

// the avatars are not what is tested here
jest.mock("../../src/components/views/avatars/MemberAvatar", () => ({
    __esModule: true,
    default: () => <span data-testid="member-avatar" />,
}));
jest.mock("../../src/WhoIsTyping", () => ({
    usersTypingApartFromMe: jest.fn(() => []),
    whoIsTypingString: jest.fn(() => ""),
}));
jest.mock("../../src/utils/beacon", () => ({ useBeacon: jest.fn() }));

const roomId = "!roomId:server_name";
const userId = "@me:here";

/** A client the panel can run against; `getMockClientWithEventEmitter` also points MatrixClientPeg at it. */
const makeClient = (): MatrixClient =>
    getMockClientWithEventEmitter({
        ...mockClientMethodsUser(userId),
        ...mockClientMethodsEvents(),
        getAccountData: jest.fn(),
        isUserIgnored: jest.fn().mockReturnValue(false),
        isRoomEncrypted: jest.fn().mockReturnValue(false),
        getRoom: jest.fn(),
        getClientWellKnown: jest.fn().mockReturnValue({}),
        supportsThreads: jest.fn().mockReturnValue(true),
    });
let client: MatrixClient;

describe("the Clariva timeline furniture inside MessagePanel", () => {
    let room: Room;
    const pegged = (): void => {
        client = makeClient();
        jest.spyOn(MatrixClientPeg, "get").mockReturnValue(client);
    };

    const DAY = 24 * 60 * 60 * 1000;
    const mkEvents = (count: number, firstTs = Date.now() - 2 * DAY, step = 1000): MatrixEvent[] =>
        Array.from({ length: count }, (_, i) =>
            mkMessage({ event: true, room: "!room:id", user: "@user:id", ts: firstTs + i * step }),
        );

    const roomContext = (): IRoomState =>
        ({
            ...RoomContext,
            timelineRenderingType: TimelineRenderingType.Room,
            room,
            roomId: room.roomId,
            canReact: true,
            canSendMessages: true,
            showReadReceipts: true,
            showRedactions: false,
            showJoinLeaves: false,
            showAvatarChanges: false,
            showDisplaynameChanges: true,
            showHiddenEvents: false,
        }) as unknown as IRoomState;

    const panel = (props: Record<string, unknown> = {}): JSX.Element => (
        <MatrixClientContext.Provider value={client}>
            <RoomContext.Provider value={roomContext()}>
                <MessagePanel
                    resizeNotifier={new EventEmitter() as unknown as ResizeNotifier}
                    callEventGroupers={new Map()}
                    room={room}
                    className="cls"
                    events={[]}
                    {...props}
                />
            </RoomContext.Provider>
        </MatrixClientContext.Provider>
    );

    beforeEach(() => {
        pegged();
        room = new Room(roomId, client, userId);
        // upstream's "all settings are off" hack, with the display-name rule it relies on
        jest.spyOn(SettingsStore, "getValue").mockImplementation((name) => name === "showDisplaynameChanges");
        DMRoomMap.makeShared(client);
        configureClariva();
    });

    afterEach(() => {
        cleanup();
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    describe("the unread divider", () => {
        it("a visible read marker carries the small 'New' label, hidden from assistive tech", () => {
            const events = mkEvents(10);
            const { container } = render(
                panel({ events, readMarkerEventId: events[4].getId(), readMarkerVisible: true }),
            );
            const marker = container.querySelector(".mx_MessagePanel_myReadMarker") as HTMLElement;
            expect(marker.querySelector("hr")).not.toBeNull(); // the hairline is still there
            expect(screen.getByTestId("clariva-unread-label")).toHaveTextContent("New");
            expect(marker).toContainElement(screen.getByTestId("clariva-unread-label"));
            expect(screen.getByTestId("clariva-unread-label")).toHaveAttribute("aria-hidden", "true");
        });

        it("a marker at the very end of the timeline stays an empty placeholder (no hairline, no label)", () => {
            const events = mkEvents(10);
            const { container } = render(
                panel({ events, readMarkerEventId: events[9].getId(), readMarkerVisible: true }),
            );
            const marker = container.querySelector(".mx_MessagePanel_myReadMarker") as HTMLElement;
            expect(marker.children).toHaveLength(0);
            expect(screen.queryByTestId("clariva-unread-label")).toBeNull();
        });

        it("outside Clariva the marker is Element's, with no label", () => {
            SdkConfig.reset();
            const events = mkEvents(10);
            render(panel({ events, readMarkerEventId: events[4].getId(), readMarkerVisible: true }));
            expect(screen.queryByTestId("clariva-unread-label")).toBeNull();
        });
    });

    describe("the day chips", () => {
        it("every day separator row becomes a sticky date row", () => {
            const events = [...mkEvents(3, Date.now() - 3 * DAY), ...mkEvents(3, Date.now() - DAY)];
            const { container } = render(panel({ events }));
            const dayRows = [...container.querySelectorAll(`li[${DATE_ATTR}]`)];
            expect(dayRows).toHaveLength(2);
            dayRows.forEach((row) => expect(row.querySelector(".mx_TimelineSeparator")).not.toBeNull());
        });

        it("outside Clariva the rows are Element's: nothing sticks", () => {
            SdkConfig.reset();
            const events = [...mkEvents(3, Date.now() - 3 * DAY), ...mkEvents(3, Date.now() - DAY)];
            const { container } = render(panel({ events }));
            expect(container.querySelectorAll(`li[${DATE_ATTR}]`)).toHaveLength(0);
            expect(container.querySelectorAll(".mx_TimelineSeparator").length).toBeGreaterThan(0);
        });
    });
});

describe("WhoIsTypingTile (the Clariva typing dots)", () => {
    let room: Room;

    beforeEach(() => {
        client = makeClient();
        jest.spyOn(MatrixClientPeg, "get").mockReturnValue(client);
        room = new Room(roomId, client, userId);
        jest.mocked(WhoIsTyping.usersTypingApartFromMe).mockReturnValue([
            { userId: "@rao:clarivahub.com", name: "Dr. Rao" } as RoomMember,
        ]);
        jest.mocked(WhoIsTyping.whoIsTypingString).mockReturnValue("Dr. Rao is typing…");
        configureClariva();
    });

    afterEach(() => {
        cleanup();
        jest.restoreAllMocks();
        jest.mocked(WhoIsTyping.usersTypingApartFromMe).mockReturnValue([]);
        jest.mocked(WhoIsTyping.whoIsTypingString).mockReturnValue("");
        SdkConfig.reset();
    });

    it("three decorative dots sit before the label, which stays the stock 'X is typing' text", () => {
        render(<WhoIsTypingTile room={room} />);
        const dots = screen.getByTestId("clariva-typing-dots");
        expect(dots).toHaveAttribute("aria-hidden", "true");
        expect(dots.querySelectorAll("span")).toHaveLength(3);
        expect(screen.getByText("Dr. Rao is typing…")).toBeInTheDocument();
        // the dots come before the label in reading order (the pill, then the words)
        const tile = dots.parentElement as HTMLElement;
        expect([...tile.children].map((el) => el.className)).toEqual([
            "mx_WhoIsTypingTile_avatars",
            "mx_WhoIsTypingTile_dots",
            "mx_WhoIsTypingTile_label",
        ]);
        expect(tile).toHaveAttribute("aria-atomic", "true");
    });

    it("outside Clariva: no dots, Element's tile", () => {
        SdkConfig.reset();
        render(<WhoIsTypingTile room={room} />);
        expect(screen.queryByTestId("clariva-typing-dots")).toBeNull();
        expect(screen.getByText("Dr. Rao is typing…")).toBeInTheDocument();
    });

    it("renders nothing when nobody is typing", () => {
        jest.mocked(WhoIsTyping.whoIsTypingString).mockReturnValue("");
        const { container } = render(<WhoIsTypingTile room={room} />);
        expect(container).toBeEmptyDOMElement();
    });
});
