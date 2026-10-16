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
import {
    EventStatus,
    type MatrixClient,
    type MatrixEvent,
    PendingEventOrdering,
    Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";

import EventTile, { type EventTileProps } from "../../src/components/views/rooms/EventTile";
import JumpToBottomButton from "../../src/components/views/rooms/JumpToBottomButton";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import RoomContext, { TimelineRenderingType } from "../../src/contexts/RoomContext";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import SdkConfig from "../../src/SdkConfig";
import { Layout } from "../../src/settings/enums/Layout";
import {
    LIVE_ARRIVAL_WINDOW_MS,
    LIVE_TIMESTAMP_TOLERANCE_MS,
    isLiveArrival,
    isLiveEvent,
} from "../../src/clariva/components/room/liveEvent";
import {
    ClarivaDeliveryTicks,
    deliveryStateOf,
    isReadByOthers,
    subscribeRoomReceipts,
} from "../../src/clariva/components/room/DeliveryTicks";
import { PILL_EXIT_MS, PILL_LEAVING_CLASS } from "../../src/clariva/components/room/pillExit";
import {
    DATE_ATTR,
    PAST_ATTR,
    STUCK_ATTR,
    ClarivaStickyDateMarker,
    computeStickyDates,
    registerStickyDate,
    stickyGroupOf,
} from "../../src/clariva/components/room/stickyDates";
import { ClarivaUnreadLabel } from "../../src/clariva/components/room/UnreadLabel";
import { configureClariva } from "./helpers";
import { getRoomContext, mkMessage, stubClient } from "../test-utils";

describe("isLiveArrival", () => {
    const now = 1_700_000_000_000;
    const base = { now, receivedAt: now - 200, ts: now - 1000, visible: true };

    it("is true for a message that has just arrived in a visible tab", () => {
        expect(isLiveArrival(base)).toBe(true);
    });

    it("is false for a history load or a room switch (it was received a while ago)", () => {
        expect(isLiveArrival({ ...base, receivedAt: now - LIVE_ARRIVAL_WINDOW_MS - 1 })).toBe(false);
        expect(isLiveArrival({ ...base, receivedAt: now - LIVE_ARRIVAL_WINDOW_MS })).toBe(true);
    });

    it("is false for old history that was only just delivered (back-pagination, a cached sync)", () => {
        expect(isLiveArrival({ ...base, ts: now - LIVE_TIMESTAMP_TOLERANCE_MS - 1 })).toBe(false);
        expect(isLiveArrival({ ...base, ts: now - LIVE_TIMESTAMP_TOLERANCE_MS })).toBe(true);
        expect(isLiveArrival({ ...base, ts: 0 })).toBe(false); // an event with no timestamp
    });

    it("is false when the tab is not visible (nobody would see the motion)", () => {
        expect(isLiveArrival({ ...base, visible: false })).toBe(false);
    });

    it("is false for my own messages (sending is the most frequent action; a local echo is mounted twice)", () => {
        expect(isLiveArrival({ ...base, own: true })).toBe(false);
        expect(isLiveArrival({ ...base, own: false })).toBe(true);
    });
});

describe("isLiveEvent", () => {
    let client: MatrixClient;
    const ROOM_ID = "!dm:clarivahub.com";

    const event = (sender: string, ts = Date.now(), receivedAgo = 0): MatrixEvent => {
        const ev = mkMessage({ room: ROOM_ID, user: sender, msg: "Hello", event: true, ts });
        ev.localTimestamp = Date.now() - receivedAgo;
        return ev;
    };
    const visibility = (state: "visible" | "hidden"): void => {
        jest.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    };

    beforeEach(() => {
        client = stubClient();
        configureClariva();
        visibility("visible");
    });

    afterEach(() => {
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    it("is true for somebody else's message that arrives now in a visible tab", () => {
        expect(isLiveEvent(event("@rao:clarivahub.com"))).toBe(true);
    });

    it("is false for my own, for an old one, for a hidden tab, and always outside Clariva", () => {
        expect(isLiveEvent(event(client.getSafeUserId()))).toBe(false);
        expect(isLiveEvent(event("@rao:clarivahub.com", Date.now(), 60_000))).toBe(false);
        visibility("hidden");
        expect(isLiveEvent(event("@rao:clarivahub.com"))).toBe(false);
        visibility("visible");
        SdkConfig.reset();
        expect(isLiveEvent(event("@rao:clarivahub.com"))).toBe(false);
    });
});

describe("EventTile (the Clariva room additions)", () => {
    const ROOM_ID = "!roomId:example.org";
    let client: MatrixClient;
    let room: Room;

    const incoming = (overrides: Record<string, unknown> = {}): MatrixEvent =>
        mkMessage({
            room: ROOM_ID,
            user: "@rao:clarivahub.com",
            msg: "Hello",
            event: true,
            ts: Date.now(),
            ...overrides,
        });

    const renderTile = (mxEvent: MatrixEvent, overrides: Partial<EventTileProps> = {}): ReturnType<typeof render> => {
        const context = getRoomContext(room, { timelineRenderingType: TimelineRenderingType.Room });
        return render(
            <MatrixClientContext.Provider value={client}>
                <RoomContext.Provider value={context}>
                    <EventTile mxEvent={mxEvent} layout={Layout.Bubble} {...overrides} />
                </RoomContext.Provider>
            </MatrixClientContext.Provider>,
        );
    };
    const tile = (): HTMLElement => document.querySelector(".mx_EventTile") as HTMLElement;

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
            timelineSupport: true,
        });
        jest.spyOn(client, "getRoom").mockReturnValue(room);
        jest.spyOn(client, "decryptEventIfNeeded").mockResolvedValue();
        jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        configureClariva();
    });

    afterEach(() => {
        cleanup();
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    it("a message that arrives live in a bubble timeline gets the class the 140 ms ease-in hangs on", () => {
        renderTile(incoming());
        expect(tile()).toHaveClass("mx_EventTile_clarivaLive");
        expect(tile()).toHaveAttribute("data-self", "false");
    });

    it("history (received long ago), my own messages and a hidden tab get no motion", () => {
        const old = incoming();
        old.localTimestamp = Date.now() - 60_000;
        renderTile(old);
        expect(tile()).not.toHaveClass("mx_EventTile_clarivaLive");
        cleanup();

        renderTile(incoming({ user: client.getSafeUserId() }));
        expect(tile()).not.toHaveClass("mx_EventTile_clarivaLive");
        cleanup();

        jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        renderTile(incoming());
        expect(tile()).not.toHaveClass("mx_EventTile_clarivaLive");
    });

    it("only the bubble layout of the main timeline moves, and only when Clariva is on", () => {
        renderTile(incoming(), { layout: Layout.Group });
        expect(tile()).not.toHaveClass("mx_EventTile_clarivaLive");
        cleanup();

        SdkConfig.reset();
        renderTile(incoming());
        expect(tile()).not.toHaveClass("mx_EventTile_clarivaLive");
    });

    it("the class is decided once, when the tile is created: a later re-render never replays or removes it", () => {
        const mxEvent = incoming();
        const props = { mxEvent, layout: Layout.Bubble };
        const context = getRoomContext(room, { timelineRenderingType: TimelineRenderingType.Room });
        const ui = (
            <MatrixClientContext.Provider value={client}>
                <RoomContext.Provider value={context}>
                    <EventTile {...props} />
                </RoomContext.Provider>
            </MatrixClientContext.Provider>
        );
        const result = render(ui);
        expect(tile()).toHaveClass("mx_EventTile_clarivaLive");
        jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden"); // the tab goes to the background
        result.rerender(ui);
        expect(tile()).toHaveClass("mx_EventTile_clarivaLive");
    });

    it("my own message shows a tick beside its time ('Sent'); somebody else's shows none", () => {
        renderTile(incoming({ user: client.getSafeUserId() }));
        expect(screen.getByRole("img", { name: "Sent" })).toHaveClass("mx_ClarivaTicks");
        cleanup();

        renderTile(incoming());
        expect(document.querySelector(".mx_ClarivaTicks")).toBeNull();
    });

    it("a message that is still being sent shows 'Sending', and a failed one 'Not sent'", () => {
        const own = incoming({ user: client.getSafeUserId() });
        renderTile(own, { eventSendStatus: EventStatus.SENDING });
        expect(screen.getByRole("img", { name: "Sending" })).toBeInTheDocument();
        cleanup();
        renderTile(own, { eventSendStatus: EventStatus.NOT_SENT });
        expect(screen.getByRole("img", { name: "Not sent" })).toBeInTheDocument();
    });

    it("no ticks outside the bubble layout or outside Clariva", () => {
        renderTile(incoming({ user: client.getSafeUserId() }), { layout: Layout.Group });
        expect(document.querySelector(".mx_ClarivaTicks")).toBeNull();
        cleanup();
        SdkConfig.reset();
        renderTile(incoming({ user: client.getSafeUserId() }));
        expect(document.querySelector(".mx_ClarivaTicks")).toBeNull();
    });
});

describe("delivery ticks", () => {
    const ME = "@asha:clarivahub.com";
    const PEER = "@rao:clarivahub.com";
    const mxEvent = { getId: () => "$event" } as unknown as MatrixEvent;
    let readers: Set<string>;
    let room: Room;

    beforeEach(() => {
        readers = new Set();
        room = Object.assign(new EventEmitter(), {
            client: { getUserId: () => ME },
            getJoinedMembers: () => [{ userId: ME }, { userId: PEER }],
            hasUserReadEvent: (userId: string) => readers.has(userId),
        }) as unknown as Room;
    });

    afterEach(cleanup);

    it("deliveryStateOf: sending while queued / encrypting, failed when not sent, read only once somebody read it", () => {
        expect(deliveryStateOf(undefined, false)).toBe("sent");
        expect(deliveryStateOf(null, true)).toBe("read");
        expect(deliveryStateOf(EventStatus.SENT, true)).toBe("read");
        expect(deliveryStateOf(EventStatus.SENDING, true)).toBe("sending");
        expect(deliveryStateOf(EventStatus.QUEUED, false)).toBe("sending");
        expect(deliveryStateOf(EventStatus.ENCRYPTING, false)).toBe("sending");
        expect(deliveryStateOf(EventStatus.NOT_SENT, true)).toBe("failed");
    });

    it("isReadByOthers ignores my own receipt", () => {
        readers.add(ME);
        expect(isReadByOthers(room, mxEvent)).toBe(false);
        readers.add(PEER);
        expect(isReadByOthers(room, mxEvent)).toBe(true);
        expect(isReadByOthers(room, { getId: () => undefined } as unknown as MatrixEvent)).toBe(false);
    });

    it("is one check once sent, two checks once read: the SHAPE differs, the colour is only a hint", () => {
        const { container, unmount } = render(<ClarivaDeliveryTicks room={room} mxEvent={mxEvent} />);
        const tick = screen.getByRole("img", { name: "Sent" });
        expect(tick).toHaveAttribute("data-state", "sent");
        expect(container.querySelectorAll("svg path")).toHaveLength(1);
        unmount();

        readers.add(PEER);
        const read = render(<ClarivaDeliveryTicks room={room} mxEvent={mxEvent} />);
        expect(screen.getByRole("img", { name: "Read" })).toHaveAttribute("data-state", "read");
        expect(read.container.querySelectorAll("svg path")).toHaveLength(2);
    });

    it("turns into 'Read' when a read receipt arrives, and then stops listening", () => {
        render(<ClarivaDeliveryTicks room={room} mxEvent={mxEvent} />);
        expect(screen.getByRole("img", { name: "Sent" })).toBeInTheDocument();
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(1);
        readers.add(PEER);
        act(() => {
            (room as unknown as EventEmitter).emit(RoomEvent.Receipt);
        });
        expect(screen.getByRole("img", { name: "Read" })).toBeInTheDocument();
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(0);
    });

    it("shows a clock while sending and an alert mark when it failed, and listens to nothing in those states", () => {
        const { rerender } = render(
            <ClarivaDeliveryTicks room={room} mxEvent={mxEvent} sendStatus={EventStatus.SENDING} />,
        );
        expect(screen.getByRole("img", { name: "Sending" })).toHaveAttribute("data-state", "sending");
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(0);
        rerender(<ClarivaDeliveryTicks room={room} mxEvent={mxEvent} sendStatus={EventStatus.NOT_SENT} />);
        expect(screen.getByRole("img", { name: "Not sent" })).toHaveAttribute("data-state", "failed");
    });

    it("a long timeline costs ONE Room.receipt listener, however many own messages are on screen", () => {
        const many = Array.from({ length: 40 }, (_, i) => (
            <ClarivaDeliveryTicks key={i} room={room} mxEvent={{ getId: () => `$e${i}` } as unknown as MatrixEvent} />
        ));
        const { unmount } = render(<>{many}</>);
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(1);
        unmount();
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(0);
    });

    it("subscribeRoomReceipts: the last unsubscribe removes the room listener", () => {
        const a = jest.fn();
        const b = jest.fn();
        const offA = subscribeRoomReceipts(room, a);
        const offB = subscribeRoomReceipts(room, b);
        (room as unknown as EventEmitter).emit(RoomEvent.Receipt);
        expect([a, b].map((f) => f.mock.calls.length)).toEqual([1, 1]);
        offA();
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(1);
        offB();
        expect(room.listenerCount(RoomEvent.Receipt)).toBe(0);
    });
});

describe("the scroll-to-latest pill", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
    });

    afterEach(() => {
        cleanup();
        jest.useRealTimers();
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    const renderPill = (props: { numUnreadMessages?: number; highlight?: boolean } = {}): ReturnType<typeof render> =>
        render(
            <div data-testid="parent">
                <JumpToBottomButton
                    highlight={!!props.highlight}
                    numUnreadMessages={props.numUnreadMessages}
                    onScrollToBottomClick={jest.fn()}
                />
            </div>,
        );

    it("keeps its accessible name and shows the unread count", () => {
        renderPill({ numUnreadMessages: 3 });
        expect(screen.getByRole("button", { name: "Scroll to most recent messages" })).toBeInTheDocument();
        expect(document.querySelector(".mx_JumpToBottomButton_badge")).toHaveTextContent("3");
    });

    // the room view keeps the pill's parent and only stops rendering the pill
    const roomView = (showPill: boolean, numUnreadMessages = 2): JSX.Element => (
        <div data-testid="parent">
            {showPill && (
                <JumpToBottomButton
                    highlight={false}
                    numUnreadMessages={numUnreadMessages}
                    onScrollToBottomClick={jest.fn()}
                />
            )}
        </div>
    );
    const ghost = (): HTMLElement | null => screen.getByTestId("parent").querySelector(`.${PILL_LEAVING_CLASS}`);

    it("leaves a fading, inert copy behind for the exit animation, then removes it", () => {
        const { rerender } = render(roomView(true));
        expect(ghost()).toBeNull();
        rerender(roomView(false));
        const copy = ghost() as HTMLElement;
        expect(copy).not.toBeNull();
        expect(copy).toHaveAttribute("aria-hidden", "true");
        expect(copy).toHaveClass("mx_JumpToBottomButton");
        expect(copy.querySelector(".mx_JumpToBottomButton_badge")).toHaveTextContent("2");
        copy.querySelectorAll("[tabindex]").forEach((el) => expect(el).toHaveAttribute("tabindex", "-1"));
        act(() => {
            jest.advanceTimersByTime(PILL_EXIT_MS + 1);
        });
        expect(ghost()).toBeNull();
        expect(screen.getByTestId("parent")).toBeEmptyDOMElement();
    });

    it("leaves nothing behind in a hidden tab", () => {
        const { rerender } = render(roomView(true));
        jest.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        rerender(roomView(false));
        expect(ghost()).toBeNull();
    });

    it("leaves nothing behind outside Clariva", () => {
        SdkConfig.reset();
        const { rerender } = render(roomView(true));
        rerender(roomView(false));
        expect(ghost()).toBeNull();
    });
});

describe("computeStickyDates", () => {
    it("none stuck while every chip is still below the line", () => {
        expect(computeStickyDates([120, 400, 900], 80)).toEqual({ current: -1, past: [false, false, false] });
    });

    it("the last chip that reached the line is the day being read; earlier stuck ones are hidden behind it", () => {
        expect(computeStickyDates([80, 80, 80, 300], 80)).toEqual({ current: 2, past: [true, true, false, false] });
        expect(computeStickyDates([-500, 79.5, 400], 80)).toEqual({ current: 1, past: [true, false, false] });
    });

    it("absorbs sub-pixel rounding at the line", () => {
        expect(computeStickyDates([81], 80).current).toBe(0);
        expect(computeStickyDates([82], 80).current).toBe(-1);
    });

    it("an empty timeline has no chips", () => {
        expect(computeStickyDates([], 80)).toEqual({ current: -1, past: [] });
    });
});

describe("registerStickyDate", () => {
    let scroller: HTMLElement;
    let rows: HTMLElement[];
    let tops: number[];
    const realRect = HTMLElement.prototype.getBoundingClientRect;

    beforeEach(() => {
        document.body.innerHTML = `<div class="mx_ScrollPanel" data-testid="scroller"><ol><li style="top: 76px"></li><li style="top: 76px"></li><li style="top: 76px"></li></ol></div>`;
        scroller = screen.getByTestId("scroller");
        rows = [...scroller.querySelectorAll("li")];
        tops = [0, 0, 0];
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            const i = rows.indexOf(this);
            const top = this === scroller ? 10 : i >= 0 ? tops[i] : 0;
            return {
                top,
                height: 30,
                width: 100,
                left: 0,
                right: 100,
                bottom: top + 30,
                x: 0,
                y: top,
                toJSON: () => ({}),
            };
        };
    });

    afterEach(() => {
        HTMLElement.prototype.getBoundingClientRect = realRect;
        document.body.innerHTML = "";
    });

    it("marks the row as a date row and sticks only the day being read (the line is the scroller's top + the row's own top)", () => {
        const offs = rows.map((row) => registerStickyDate(row));
        rows.forEach((row) => expect(row).toHaveAttribute(DATE_ATTR));
        tops = [50, 86, 400]; // the line is 10 + 76 = 86: rows 0 and 1 have reached it
        stickyGroupOf(scroller)!.update();
        expect(rows[0]).toHaveAttribute(PAST_ATTR);
        expect(rows[0]).not.toHaveAttribute(STUCK_ATTR);
        expect(rows[1]).toHaveAttribute(STUCK_ATTR);
        expect(rows[1]).not.toHaveAttribute(PAST_ATTR);
        expect(rows[2]).not.toHaveAttribute(STUCK_ATTR);
        expect(rows[2]).not.toHaveAttribute(PAST_ATTR);

        tops = [-200, -100, 86]; // scrolled on: the third day takes over
        stickyGroupOf(scroller)!.update();
        expect(rows[2]).toHaveAttribute(STUCK_ATTR);
        expect(rows[1]).toHaveAttribute(PAST_ATTR);
        offs.forEach((off) => off());
    });

    it("cleans up: no attributes left, and the scroll listener goes with the last row", () => {
        const remove = jest.spyOn(scroller, "removeEventListener");
        const offs = rows.map((row) => registerStickyDate(row));
        tops = [86, 400, 500];
        stickyGroupOf(scroller)!.update();
        expect(rows[0]).toHaveAttribute(STUCK_ATTR);
        offs[0]();
        expect(rows[0]).not.toHaveAttribute(DATE_ATTR);
        expect(rows[0]).not.toHaveAttribute(STUCK_ATTR);
        expect(stickyGroupOf(scroller)).toBeDefined();
        offs[1]();
        offs[2]();
        expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
        expect(stickyGroupOf(scroller)).toBeUndefined();
    });

    it("a row outside a timeline scroller stays an ordinary in-flow row", () => {
        const loose = document.body.appendChild(document.createElement("li"));
        const off = registerStickyDate(loose);
        expect(loose).toHaveAttribute(DATE_ATTR);
        expect(loose).not.toHaveAttribute(STUCK_ATTR);
        off();
        expect(loose).not.toHaveAttribute(DATE_ATTR);
    });

    it("ClarivaStickyDateMarker turns the li it sits in into a sticky date row, and renders nothing visible", () => {
        const { container } = render(
            <div className="mx_ScrollPanel">
                <ol>
                    <li data-testid="day">
                        <div className="mx_TimelineSeparator">
                            <ClarivaStickyDateMarker />
                        </div>
                    </li>
                </ol>
            </div>,
        );
        expect(screen.getByTestId("day")).toHaveAttribute(DATE_ATTR);
        expect(container.querySelector("span[hidden]")).not.toBeNull();
    });
});

describe("ClarivaUnreadLabel", () => {
    it("is the word 'New', hidden from assistive tech (the line marks the place)", () => {
        render(<ClarivaUnreadLabel />);
        const label = screen.getByTestId("clariva-unread-label");
        expect(label).toHaveTextContent("New");
        expect(label).toHaveAttribute("aria-hidden", "true");
        expect(label).toHaveClass("mx_ClarivaUnreadLabel");
    });
});
