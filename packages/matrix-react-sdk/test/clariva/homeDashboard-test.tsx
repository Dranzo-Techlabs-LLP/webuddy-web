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
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type MatrixClient, Room } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import Modal, { ModalManagerEvent } from "../../src/Modal";
import { Landmark, LandmarkNavigation } from "../../src/accessibility/LandmarkNavigation";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import { UserTab } from "../../src/components/views/dialogs/UserTab";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import HomePage from "../../src/components/structures/HomePage";
import RoomListStore from "../../src/stores/room-list/RoomListStore";
import { OwnProfileStore } from "../../src/stores/OwnProfileStore";
import { WalletStore, type WalletSnapshot } from "../../src/clariva/stores/WalletStore";
import { formatCredits } from "../../src/clariva/money";
import { getClarivaDmPeerId } from "../../src/clariva/chat/dmPeer";
import { openMyQrCodeDialog, openScanQrCodeDialog } from "../../src/clariva/components/qr/dialogs";
import { getLastActivityTs } from "../../src/clariva/components/chats/RoomTileTime";
import { HomeDashboard, resetHomeEntranceForTests } from "../../src/clariva/components/home/HomeDashboard";
import { ConsultantsRail } from "../../src/clariva/components/home/ConsultantsRail";
import { QuickActions, quickActions } from "../../src/clariva/components/home/QuickActions";
import { WalletCard } from "../../src/clariva/components/home/WalletCard";
import {
    MAX_RECENT_CHATS,
    chatsWithPendingRefunds,
    selectRecentChats,
} from "../../src/clariva/components/home/recentChats";
import {
    dayPartForHour,
    firstNameOf,
    greetingForHour,
    msUntilNextDayPart,
    useGreeting,
} from "../../src/clariva/components/home/useGreeting";
import { homeStrings } from "../../src/clariva/strings/home";
import { stubClient } from "../test-utils";
import { configureClariva } from "./helpers";

// The pieces the dashboard borrows from the Chats list are exercised by their own suites; here they are stand-ins.
jest.mock("../../src/clariva/components/qr/dialogs", () => ({
    openMyQrCodeDialog: jest.fn(),
    openScanQrCodeDialog: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock("../../src/clariva/chat/dmPeer", () => ({ getClarivaDmPeerId: jest.fn() }));
jest.mock("../../src/clariva/components/chats/RoomTileTime", () => ({ getLastActivityTs: jest.fn() }));
jest.mock("../../src/clariva/components/chat/RoomTileRate", () => ({
    ClarivaRoomTileRate: ({ room }: { room: { roomId: string } }) =>
        require("react").createElement("span", { "data-testid": "rate" }, `rate ${room.roomId}`),
}));
jest.mock("../../src/components/views/avatars/DecoratedRoomAvatar", () => ({
    __esModule: true,
    default: ({ room }: { room: { name: string } }) =>
        require("react").createElement("span", { "data-testid": "avatar" }, room.name),
}));
jest.mock("../../src/components/structures/EmbeddedPage", () => ({
    __esModule: true,
    default: () => require("react").createElement("div", { "data-testid": "embedded-home" }),
}));

const SNAPSHOT: WalletSnapshot = {
    userId: "@me:clarivahub.com",
    credits: 1195,
    maxCredits: null,
    isConsultant: false,
    loaded: true,
};

function mockWallet(overrides: Partial<WalletSnapshot> = {}, pending: string[] = []): void {
    jest.spyOn(WalletStore.instance, "getSnapshot").mockReturnValue({ ...SNAPSHOT, ...overrides });
    jest.spyOn(WalletStore.instance, "pendingRefundClients", "get").mockReturnValue(new Set(pending));
}

interface Chat {
    id: string;
    name: string;
    peer: string | null;
    ts: number;
}

/** Real rooms (so `useRoomName` works) whose peer and last activity come from the table, newest first is NOT assumed. */
function mockChats(client: MatrixClient, chats: Chat[], extraTags: Record<string, Chat[]> = {}): Room[] {
    const make = (chat: Chat): Room => {
        const room = new Room(chat.id, client, "@me:clarivahub.com");
        room.name = chat.name;
        return room;
    };
    const rooms = new Map(chats.map((chat) => [chat.id, make(chat)]));
    const lists: Record<string, Room[]> = { "im.vector.fake.direct": [...rooms.values()] };
    for (const [tag, tagged] of Object.entries(extraTags)) {
        lists[tag] = tagged.map((chat) => {
            const room = make(chat);
            rooms.set(chat.id, room);
            return room;
        });
    }
    const all = [...chats, ...Object.values(extraTags).flat()];
    jest.spyOn(RoomListStore.instance, "orderedLists", "get").mockReturnValue(lists as any);
    (getClarivaDmPeerId as jest.Mock).mockImplementation(
        (room: Room) => all.find((chat) => chat.id === room.roomId)?.peer ?? null,
    );
    (getLastActivityTs as jest.Mock).mockImplementation(
        (room: Room) => all.find((chat) => chat.id === room.roomId)?.ts ?? 0,
    );
    return [...rooms.values()];
}

let client: MatrixClient;

beforeEach(() => {
    client = stubClient();
    configureClariva();
    resetHomeEntranceForTests();
});

afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
    (getClarivaDmPeerId as jest.Mock).mockReset();
    (getLastActivityTs as jest.Mock).mockReset();
    (openMyQrCodeDialog as jest.Mock).mockClear();
    (openScanQrCodeDialog as jest.Mock).mockClear();
    SdkConfig.reset();
});

describe("greeting", () => {
    it("splits the day at 05:00, 12:00 and 17:00", () => {
        expect([0, 4, 5, 11, 12, 16, 17, 23].map(dayPartForHour)).toEqual([
            "evening",
            "evening",
            "morning",
            "morning",
            "afternoon",
            "afternoon",
            "evening",
            "evening",
        ]);
        expect(greetingForHour(9)).toBe("Good morning");
        expect(greetingForHour(14)).toBe("Good afternoon");
        expect(greetingForHour(20)).toBe("Good evening");
    });

    it("greets by first name and falls back to the bare greeting", () => {
        expect(homeStrings.greeting("Good evening", "Asha")).toBe("Good evening, Asha");
        expect(homeStrings.greeting("Good evening", null)).toBe("Good evening");
        expect(firstNameOf("Asha Rao", "@asha:x")).toBe("Asha");
        expect(firstNameOf("  Asha  ")).toBe("Asha");
        expect(firstNameOf("Dr. Rao", "@rao:x")).toBe("Dr. Rao");
        expect(firstNameOf("Prof Maya Iyer")).toBe("Prof Maya");
    });

    it("never greets a Matrix ID or an empty name", () => {
        expect(firstNameOf("@asha:clarivahub.com", "@asha:clarivahub.com")).toBeNull();
        expect(firstNameOf("asha:clarivahub.com", "asha:clarivahub.com")).toBeNull();
        expect(firstNameOf("@someone:else")).toBeNull();
        expect(firstNameOf("")).toBeNull();
        expect(firstNameOf(undefined)).toBeNull();
    });

    it("waits until the next boundary, never less than a second", () => {
        expect(msUntilNextDayPart(new Date(2026, 0, 5, 4, 30))).toBe(30 * 60_000);
        expect(msUntilNextDayPart(new Date(2026, 0, 5, 11, 59, 30))).toBe(30_000);
        expect(msUntilNextDayPart(new Date(2026, 0, 5, 16, 0))).toBe(60 * 60_000);
        expect(msUntilNextDayPart(new Date(2026, 0, 5, 23, 0))).toBe(6 * 60 * 60_000);
        expect(msUntilNextDayPart(new Date(2026, 0, 5, 4, 59, 59, 999))).toBe(1000);
    });

    function Probe({ clock }: { clock: () => Date }): JSX.Element {
        return <p data-testid="probe">{useGreeting(clock).text}</p>;
    }

    it("useGreeting reads the profile name and moves to the next day part on its own", () => {
        jest.useFakeTimers();
        jest.spyOn(OwnProfileStore.instance, "displayName", "get").mockReturnValue("Asha Rao");
        let now = new Date(2026, 0, 5, 11, 59, 0);
        const clock = (): Date => now;
        render(<Probe clock={clock} />);
        expect(screen.getByTestId("probe")).toHaveTextContent("Good morning, Asha");

        now = new Date(2026, 0, 5, 12, 0, 0);
        act(() => {
            jest.advanceTimersByTime(60_000);
        });
        expect(screen.getByTestId("probe")).toHaveTextContent("Good afternoon, Asha");
    });

    it("useGreeting has no name to greet while the profile is empty", () => {
        jest.spyOn(OwnProfileStore.instance, "displayName", "get").mockReturnValue(null);
        render(<Probe clock={() => new Date(2026, 0, 5, 20, 0)} />);
        expect(screen.getByTestId("probe")).toHaveTextContent(/^Good evening$/);
    });
});

describe("recent chats", () => {
    it("keeps the newest chats first, at most eight, and ties in list order", () => {
        // 3 and 4 were active at the same moment (the newest): they keep the order the list had them in
        const items = Array.from({ length: 10 }, (_, i) => ({ id: i, ts: i === 3 || i === 4 ? 500 : i * 10 }));
        const picked = selectRecentChats(
            items,
            () => true,
            (item) => item.ts,
        );
        expect(picked).toHaveLength(MAX_RECENT_CHATS);
        expect(picked.map((item) => item.id)).toEqual([3, 4, 9, 8, 7, 6, 5, 2]);
    });

    it("drops what is not a one-to-one chat", () => {
        const picked = selectRecentChats(
            ["dm-a", "group", "dm-b"],
            (item) => item.startsWith("dm"),
            () => 1,
        );
        expect(picked).toEqual(["dm-a", "dm-b"]);
    });

    it("finds the chats of the clients who asked for a refund, newest first", () => {
        const rooms = mockChats(client, [
            { id: "!old:x", name: "Old", peer: "@a:x", ts: 10 },
            { id: "!new:x", name: "New", peer: "@b:x", ts: 90 },
            { id: "!none:x", name: "None", peer: "@c:x", ts: 99 },
        ]);
        const ids = chatsWithPendingRefunds(rooms, new Set(["@a:x", "@b:x"])).map((room) => room.roomId);
        expect(ids).toEqual(["!new:x", "!old:x"]);
        expect(chatsWithPendingRefunds(rooms, new Set())).toEqual([]);
    });
});

describe("<WalletCard />", () => {
    it("shows the balance and one action, Add credits, which opens the Wallet tab", () => {
        mockWallet();
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<WalletCard />);
        expect(screen.getByRole("region", { name: homeStrings.walletCardLabel })).toBeInTheDocument();
        expect(screen.getByTestId("clariva-home-balance")).toHaveTextContent(formatCredits(1195, true));
        expect(screen.getByText(homeStrings.creditsUnit)).toBeInTheDocument();
        expect(screen.getByText(homeStrings.balanceCaption)).toBeInTheDocument();
        expect(screen.queryByTestId("clariva-home-review-refunds")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Add credits" }));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewUserSettings, initialTabId: UserTab.Wallet }),
        );
    });

    it("shows a placeholder, not an invented 0, until the first balance arrives", () => {
        mockWallet({ credits: null, loaded: false });
        render(<WalletCard />);
        expect(screen.getByRole("region", { name: homeStrings.walletCardLabel })).toHaveAttribute("aria-busy", "true");
        expect(screen.getByTestId("clariva-skeleton")).toBeInTheDocument();
        expect(screen.queryByTestId("clariva-home-balance")).toBeNull();
    });

    it("says so when the balance could not be loaded", () => {
        mockWallet({ credits: null, loaded: false, balanceFailed: true });
        render(<WalletCard />);
        expect(screen.getByTestId("clariva-home-balance-unavailable")).toBeInTheDocument();
        expect(screen.getByRole("region", { name: homeStrings.walletCardLabel })).toHaveAttribute("aria-busy", "false");
    });

    it("a consultant sees earnings and the waiting refund requests instead of Add credits", () => {
        mockWallet({ isConsultant: true, credits: 300 }, ["@a:x", "@b:x"]);
        render(<WalletCard />);
        expect(screen.getByText(homeStrings.earningsCaption)).toBeInTheDocument();
        expect(screen.getByTestId("clariva-home-refund-count")).toHaveTextContent("2 refund requests are waiting");
        expect(screen.getByRole("button", { name: "Review refunds" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Add credits" })).toBeNull();
    });

    it("a consultant with nothing waiting has no button to press", () => {
        mockWallet({ isConsultant: true }, []);
        render(<WalletCard />);
        expect(screen.getByTestId("clariva-home-refund-count")).toHaveTextContent(homeStrings.noPendingRefunds);
        expect(screen.queryByRole("button")).toBeNull();
        expect(homeStrings.pendingRefunds(1)).toBe("1 refund request is waiting");
    });

    it("Review refunds opens the most recent chat among the clients who asked", () => {
        mockWallet({ isConsultant: true }, ["@a:x", "@b:x"]);
        mockChats(client, [
            { id: "!a:x", name: "Asha", peer: "@a:x", ts: 10 },
            { id: "!b:x", name: "Bala", peer: "@b:x", ts: 50 },
            { id: "!c:x", name: "Chitra", peer: "@c:x", ts: 99 },
        ]);
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<WalletCard />);
        fireEvent.click(screen.getByRole("button", { name: "Review refunds" }));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: "!b:x", show_room_tile: true }),
        );
    });
});

describe("<ConsultantsRail />", () => {
    it("lists the recent one-to-one chats newest first and opens one on click", () => {
        mockChats(
            client,
            [
                { id: "!a:x", name: "Asha", peer: "@a:x", ts: 10 },
                { id: "!b:x", name: "Dr. Rao", peer: "@b:x", ts: 90 },
                { id: "!g:x", name: "A group", peer: null, ts: 95 },
            ],
            { "m.favourite": [{ id: "!a:x", name: "Asha", peer: "@a:x", ts: 10 }] },
        );
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ConsultantsRail />);

        const list = screen.getByRole("list", { name: homeStrings.recentChatsList });
        // the group is not a chat to go back to, and a room listed twice appears once
        const buttons = within(list).getAllByTestId("clariva-home-chat");
        expect(buttons).toHaveLength(2);
        expect(buttons[0]).toHaveTextContent("Dr. Rao");
        expect(buttons[1]).toHaveTextContent("Asha");
        expect(screen.getByRole("heading", { name: homeStrings.recentChats })).toBeInTheDocument();

        fireEvent.click(screen.getAllByTestId("clariva-home-chat")[0]);
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: "!b:x", show_room_tile: true }),
        );
    });

    it("shows at most eight chats", () => {
        mockChats(
            client,
            Array.from({ length: 11 }, (_, i) => ({ id: `!r${i}:x`, name: `Peer ${i}`, peer: `@p${i}:x`, ts: i })),
        );
        render(<ConsultantsRail />);
        expect(screen.getAllByTestId("clariva-home-chat")).toHaveLength(MAX_RECENT_CHATS);
        expect(screen.getAllByTestId("clariva-home-chat")[0]).toHaveTextContent("Peer 10");
    });

    it("renders nothing while there are no chats, and skips invites and the archive", () => {
        mockChats(client, [], {
            "m.lowpriority": [],
            "im.vector.fake.invite": [{ id: "!i:x", name: "Invite", peer: "@i:x", ts: 5 }],
            "im.vector.fake.archived": [{ id: "!z:x", name: "Archived", peer: "@z:x", ts: 6 }],
        });
        const { container } = render(<ConsultantsRail />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("<QuickActions />", () => {
    it("offers Start a chat, My QR code and Scan QR code, in that order", () => {
        expect(quickActions(true, true).map((action) => action.id)).toEqual(["start-chat", "my-qr", "scan-qr"]);
        expect(quickActions(false, true).map((action) => action.id)).toEqual(["start-chat"]);
        expect(quickActions(true, false).map((action) => action.id)).toEqual(["my-qr", "scan-qr"]);
        expect(quickActions(false, false)).toEqual([]);
    });

    it("runs the existing actions", () => {
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<QuickActions />);
        const group = screen.getByRole("region", { name: homeStrings.quickActions });
        expect(within(group).getAllByRole("button")).toHaveLength(3);

        fireEvent.click(screen.getByRole("button", { name: "Start a chat" }));
        expect(dispatch).toHaveBeenCalledWith({ action: "view_create_chat" });
        fireEvent.click(screen.getByRole("button", { name: "My QR code" }));
        expect(openMyQrCodeDialog).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
        expect(openScanQrCodeDialog).toHaveBeenCalledTimes(1);
    });

    it("hides both QR tiles when the deployment turns QR off", () => {
        configureClariva({ features: { qr: false } });
        render(<QuickActions />);
        expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Start a chat"]);
    });
});

describe("<HomeDashboard />", () => {
    beforeEach(() => {
        mockWallet();
        mockChats(client, [{ id: "!a:x", name: "Asha", peer: "@a:x", ts: 10 }]);
        jest.spyOn(OwnProfileStore.instance, "displayName", "get").mockReturnValue("Asha Rao");
    });

    it("is one labelled region: greeting, wallet, recent chats and quick actions", () => {
        render(<HomeDashboard />);
        const home = screen.getByRole("main", { name: homeStrings.dashboardLabel });
        expect(within(home).getByRole("heading", { level: 1 })).toHaveTextContent(
            /^Good (morning|afternoon|evening), Asha$/,
        );
        expect(within(home).getByTestId("clariva-home-wallet")).toBeInTheDocument();
        expect(within(home).getByTestId("clariva-home-rail")).toBeInTheDocument();
        expect(within(home).getByTestId("clariva-home-quick")).toBeInTheDocument();
        expect(within(home).getByText(homeStrings.tagline)).toBeInTheDocument();
    });

    it("puts the live aurora in the greeting block only, never around a glass card", () => {
        const { container } = render(<HomeDashboard />);
        const auroras = container.querySelectorAll(".cg-aurora");
        expect(auroras).toHaveLength(1);
        expect(auroras[0]).toHaveClass("cg-aurora--live");
        expect(auroras[0].closest(".mx_ClarivaHome_hero")).not.toBeNull();
        expect(container.querySelector(".mx_ClarivaWalletCard .cg-aurora")).toBeNull();
        expect(container.querySelector(".mx_ClarivaRail .cg-aurora")).toBeNull();
    });

    it("holds the greeting glow still while a dialog is open (nothing blurred may sit on a moving layer)", () => {
        const hasDialogs = jest.spyOn(Modal, "hasDialogs").mockReturnValue(false);
        const { container } = render(<HomeDashboard />);
        const aurora = container.querySelector(".cg-aurora")!;
        expect(aurora).not.toHaveClass("cg-paused");

        hasDialogs.mockReturnValue(true);
        act(() => {
            Modal.emit(ModalManagerEvent.Opened);
        });
        expect(aurora).toHaveClass("cg-paused");

        hasDialogs.mockReturnValue(false);
        act(() => {
            Modal.emit(ModalManagerEvent.Closed);
        });
        expect(aurora).not.toHaveClass("cg-paused");
    });

    it("is the Home landmark of the keyboard landmark navigation", () => {
        render(
            <>
                <div tabIndex={0} className="mx_RoomTile">
                    ROOM_TILE
                </div>
                <HomeDashboard />
            </>,
        );
        LandmarkNavigation.findAndFocusNextLandmark(Landmark.ROOM_LIST);
        expect(screen.getByTestId("clariva-home")).toHaveFocus();
    });

    it("staggers in the four blocks on the first visit only", () => {
        const first = render(<HomeDashboard />);
        const entering = first.container.querySelectorAll(".mx_ClarivaHome_enter");
        expect(entering).toHaveLength(4);
        expect([...entering].map((block) => (block as HTMLElement).style.getPropertyValue("--cg-stagger"))).toEqual([
            "0",
            "1",
            "2",
            "3",
        ]);
        first.unmount();

        // back to Home from a chat: the dashboard remounts and must not replay the entrance
        const second = render(<HomeDashboard />);
        expect(second.container.querySelectorAll(".mx_ClarivaHome_enter")).toHaveLength(0);
    });
});

describe("the Home page", () => {
    function renderHomePage(): ReturnType<typeof render> {
        return render(
            <MatrixClientContext.Provider value={client}>
                <HomePage />
            </MatrixClientContext.Provider>,
        );
    }

    beforeEach(() => {
        mockWallet();
        mockChats(client, []);
    });

    it("shows the dashboard for a Clariva session even when the deployment embeds a static home page", () => {
        // config.clariva.json points embedded_pages.home_url at home.html (the stock "Welcome" pane): the dashboard wins
        SdkConfig.add({ embedded_pages: { home_url: "home.html" } });
        renderHomePage();
        expect(screen.getByTestId("clariva-home")).toBeInTheDocument();
        expect(screen.queryByTestId("embedded-home")).toBeNull();
    });

    it("keeps the stock pane when Clariva is not configured", () => {
        SdkConfig.reset();
        SdkConfig.add({ embedded_pages: { home_url: "home.html" } });
        renderHomePage();
        expect(screen.getByTestId("embedded-home")).toBeInTheDocument();
        expect(screen.queryByTestId("clariva-home")).toBeNull();
    });
});
