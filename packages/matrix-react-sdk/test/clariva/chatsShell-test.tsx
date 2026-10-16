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
import { ClientEvent } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import { UserTab } from "../../src/components/views/dialogs/UserTab";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import RoomListStore from "../../src/stores/room-list/RoomListStore";
import { WalletStore, type WalletSnapshot } from "../../src/clariva/stores/WalletStore";
import { ClarivaChatsHeader } from "../../src/clariva/components/chats/ChatsHeader";
import { ClarivaCoinChip, HOVER_IS_REAL_QUERY } from "../../src/clariva/components/chats/CoinChip";
import { ChatsEmptyState } from "../../src/clariva/components/chats/ChatsEmptyState";
import { ChatsSkeleton, SKELETON_ROW_COUNT } from "../../src/clariva/components/chats/ChatsSkeleton";
import { slideChips } from "../../src/clariva/components/chats/ChatFilterChips";
import {
    COLLAPSED_ATTRIBUTE,
    COLLAPSE_AFTER_PX,
    EXPAND_BELOW_PX,
    bindListCollapse,
} from "../../src/clariva/components/chats/useListCollapse";
import { chatsStrings } from "../../src/clariva/strings/chats";
import { configureClariva } from "./helpers";

jest.mock("../../src/clariva/wallet/rechargeFlow", () => ({
    recoverPendingPayments: jest.fn(() => Promise.resolve()),
}));

const SNAPSHOT: WalletSnapshot = {
    userId: "@me:clarivahub.com",
    credits: 934,
    maxCredits: null,
    isConsultant: false,
    loaded: true,
};

function mockWallet(overrides: Partial<WalletSnapshot> = {}): void {
    jest.spyOn(WalletStore.instance, "getSnapshot").mockReturnValue({ ...SNAPSHOT, ...overrides });
}

/** `window.matchMedia` where hover is (or is not) real; every other query answers false. */
function mockHover(real: boolean): void {
    (window as any).matchMedia = jest.fn((query: string) => ({
        matches: real && query === HOVER_IS_REAL_QUERY,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    }));
}

/** A client that has (not) finished its first sync and lets the test finish it. */
function mockClient(synced: boolean): EventEmitter & { isInitialSyncComplete: () => boolean; finish: () => void } {
    let done = synced;
    const client = Object.assign(new EventEmitter(), {
        isInitialSyncComplete: () => done,
        finish: () => {
            done = true;
            client.emit(ClientEvent.Sync);
        },
    });
    jest.spyOn(MatrixClientPeg, "get").mockReturnValue(client as any);
    return client;
}

function mockLists(lists: Record<string, unknown[]>): void {
    jest.spyOn(RoomListStore.instance, "orderedLists", "get").mockReturnValue(lists as any);
}

afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    delete (window as any).matchMedia;
    SdkConfig.reset();
});

describe("<ClarivaCoinChip />", () => {
    beforeEach(() => {
        configureClariva();
        mockHover(false);
    });

    it("renders nothing when Clariva is not configured", () => {
        SdkConfig.reset();
        mockWallet();
        const { container } = render(<ClarivaCoinChip />);
        expect(container).toBeEmptyDOMElement();
    });

    it("is a button named 'Wallet, N credits' with the coin and the balance as text", () => {
        mockWallet({ credits: 934 });
        render(<ClarivaCoinChip />);
        const chip = screen.getByRole("button", { name: "Wallet, 934 credits" });
        expect(chip).toHaveTextContent("934 credits");
        expect(chip.querySelector("svg.cg-coin")).not.toBeNull();
        expect(chip.querySelector(".mx_ClarivaCoinChip_text")).not.toBeNull();
        // a decorative coin: the amount next to it carries the meaning
        expect(chip.querySelector("svg.cg-coin")).toHaveAttribute("aria-hidden", "true");
    });

    it("never invents a 0 before the first balance", () => {
        mockWallet({ credits: null, loaded: false });
        render(<ClarivaCoinChip />);
        expect(screen.getByTestId("clariva-wallet-chip")).toHaveTextContent("Loading...");
    });

    it("tells a consultant it is the earnings balance", () => {
        mockWallet({ isConsultant: true, credits: 300 });
        render(<ClarivaCoinChip />);
        expect(screen.getByTestId("clariva-wallet-chip")).toHaveAttribute("title", "Wallet - your earnings balance");
    });

    it("opens the Wallet tab of the settings", () => {
        mockWallet();
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaCoinChip />);
        fireEvent.click(screen.getByTestId("clariva-wallet-chip"));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewUserSettings, initialTabId: UserTab.Wallet }),
        );
    });

    it("plays the coin glint on mouse hover, only where hover is real, and stops when the mouse leaves", () => {
        mockWallet();
        mockHover(true);
        render(<ClarivaCoinChip />);
        const chip = screen.getByTestId("clariva-wallet-chip");
        expect(chip.querySelector(".cg-coin__glint")).toBeNull(); // never at rest

        fireEvent.mouseEnter(chip);
        expect(chip.querySelector(".cg-coin__glint")).not.toBeNull();
        fireEvent.mouseLeave(chip);
        expect(chip.querySelector(".cg-coin__glint")).toBeNull();
    });

    it("has no glint on a touch screen", () => {
        mockWallet();
        mockHover(false);
        render(<ClarivaCoinChip />);
        const chip = screen.getByTestId("clariva-wallet-chip");
        fireEvent.mouseEnter(chip);
        expect(chip.querySelector(".cg-coin__glint")).toBeNull();
    });
});

describe("<ChatsSkeleton />", () => {
    beforeEach(() => configureClariva());

    it("shows six placeholder rows as one busy 'Loading chats' status during the first sync", () => {
        mockClient(false);
        mockLists({ "im.vector.fake.direct": [] });
        const { container } = render(<ChatsSkeleton />);

        expect(SKELETON_ROW_COUNT).toBe(6);
        const status = screen.getByRole("status");
        expect(status).toHaveAttribute("aria-busy", "true");
        expect(status).toHaveTextContent(chatsStrings.loadingChats);
        const rows = container.querySelectorAll(".mx_ClarivaChatsSkeleton_row");
        expect(rows).toHaveLength(6);
        // avatar + name + preview per row, all hidden from assistive technology (the status says it once)
        expect(screen.getAllByTestId("clariva-skeleton")).toHaveLength(18);
        for (const row of rows) expect(row).toHaveAttribute("aria-hidden", "true");
    });

    it("pulses in opacity only: the shared skeleton block, no shimmer class", () => {
        mockClient(false);
        mockLists({});
        render(<ChatsSkeleton />);
        for (const block of screen.getAllByTestId("clariva-skeleton")) {
            expect(block).toHaveClass("cg-skeleton", "cg-pulse");
        }
    });

    it("goes away when the first sync completes", () => {
        const client = mockClient(false);
        mockLists({});
        render(<ChatsSkeleton />);
        expect(screen.getByTestId("clariva-chats-skeleton")).toBeInTheDocument();
        act(() => client.finish());
        expect(screen.queryByTestId("clariva-chats-skeleton")).toBeNull();
    });

    it("is not shown once a chat is listed, after the sync, or without Clariva", () => {
        mockClient(false);
        mockLists({ "im.vector.fake.direct": [{}] });
        const first = render(<ChatsSkeleton />);
        expect(first.container).toBeEmptyDOMElement();
        first.unmount();

        mockClient(true);
        mockLists({});
        const second = render(<ChatsSkeleton />);
        expect(second.container).toBeEmptyDOMElement();
        second.unmount();

        SdkConfig.reset();
        mockClient(false);
        const third = render(<ChatsSkeleton />);
        expect(third.container).toBeEmptyDOMElement();
    });
});

describe("<ChatsEmptyState /> illustration and action", () => {
    beforeEach(() => {
        configureClariva();
        mockClient(true);
        mockLists({ "im.vector.fake.direct": [] });
    });

    it("draws the glass bubbles above a title and one primary action", () => {
        render(<ChatsEmptyState />);
        const picture = screen.getByTestId("clariva-chats-illustration");
        expect(picture).toHaveAttribute("data-variant", "chats");
        expect(picture).toHaveAttribute("aria-hidden", "true"); // decorative: the title says it
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("No chats yet.");
        expect(screen.getAllByRole("button")).toHaveLength(1);
        expect(screen.getByRole("button", { name: "Start a chat" })).toBeInTheDocument();
    });
});

describe("the large Chats title collapsing into the header", () => {
    function scrollerAt(top: { value: number }): { column: HTMLElement; scroller: HTMLElement } {
        const column = document.createElement("div");
        const scroller = document.createElement("div");
        column.appendChild(scroller);
        Object.defineProperty(scroller, "scrollTop", { get: () => top.value, configurable: true });
        return { column, scroller };
    }
    const scrollTo = (scroller: HTMLElement, top: { value: number }, value: number): void => {
        top.value = value;
        scroller.dispatchEvent(new Event("scroll"));
    };

    it("mirrors 'scrolled past the title' into data-collapsed, with a gap so it does not flicker", () => {
        const top = { value: 0 };
        const { column, scroller } = scrollerAt(top);
        const unbind = bindListCollapse(column, scroller);
        expect(column.getAttribute(COLLAPSED_ATTRIBUTE)).toBe("false");

        scrollTo(scroller, top, COLLAPSE_AFTER_PX);
        expect(column.getAttribute(COLLAPSED_ATTRIBUTE)).toBe("false"); // not past it yet
        scrollTo(scroller, top, COLLAPSE_AFTER_PX + 1);
        expect(column.getAttribute(COLLAPSED_ATTRIBUTE)).toBe("true");
        scrollTo(scroller, top, EXPAND_BELOW_PX + 1);
        expect(column.getAttribute(COLLAPSED_ATTRIBUTE)).toBe("true"); // in the gap: stays
        scrollTo(scroller, top, EXPAND_BELOW_PX);
        expect(column.getAttribute(COLLAPSED_ATTRIBUTE)).toBe("false");

        unbind();
        expect(column.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false);
        scrollTo(scroller, top, 500);
        expect(column.hasAttribute(COLLAPSED_ATTRIBUTE)).toBe(false); // the listener is gone
    });

    it("writes the attribute only when the answer changes", () => {
        const top = { value: 0 };
        const { column, scroller } = scrollerAt(top);
        const set = jest.spyOn(column, "setAttribute");
        bindListCollapse(column, scroller);
        const initial = set.mock.calls.length;
        for (const value of [40, 60, 90, 300]) scrollTo(scroller, top, value);
        expect(set.mock.calls.length).toBe(initial + 1); // false -> true, once
    });

    it("the header binds itself to the list it sits above and hides the compact title from assistive technology", () => {
        configureClariva();
        mockWallet();
        mockHover(false);
        const top = { value: 0 };
        const { container } = render(
            <div className="mx_LeftPanel_roomListContainer">
                <ClarivaChatsHeader />
                <div className="mx_LeftPanel_actualRoomListContainer" />
            </div>,
        );
        const column = container.querySelector<HTMLElement>(".mx_LeftPanel_roomListContainer")!;
        const scroller = container.querySelector<HTMLElement>(".mx_LeftPanel_actualRoomListContainer")!;
        Object.defineProperty(scroller, "scrollTop", { get: () => top.value, configurable: true });

        expect(column).toHaveAttribute(COLLAPSED_ATTRIBUTE, "false");
        scrollTo(scroller, top, 80);
        expect(column).toHaveAttribute(COLLAPSED_ATTRIBUTE, "true");

        const compact = container.querySelector(".mx_ClarivaChatsHeader_title");
        expect(compact).toHaveTextContent("Chats");
        expect(compact).toHaveAttribute("aria-hidden", "true"); // the large title is the real heading
        expect(screen.getByTestId("clariva-wallet-chip")).toBeInTheDocument();
    });

    it("renders nothing without Clariva", () => {
        SdkConfig.reset();
        const { container } = render(<ClarivaChatsHeader />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("filter chips sliding into place (FLIP)", () => {
    function chip(key: string, onReflow?: () => void): HTMLElement {
        const el = document.createElement("button");
        el.dataset.filter = key;
        if (onReflow) {
            Object.defineProperty(el, "offsetWidth", {
                get: () => {
                    onReflow();
                    return 0;
                },
            });
        }
        return el;
    }

    it("starts each moved chip where it was and lets it travel to where it is, with the spring", () => {
        let start = "";
        const a = chip("a", () => (start = a.style.transform));
        const b = chip("b");
        const c = chip("c");
        slideChips(
            [a, b, c],
            new Map([
                ["a", 0],
                ["b", 90],
                ["c", 180],
            ]),
            new Map([
                ["a", 90],
                ["b", 0],
                ["c", 180],
            ]),
        );
        expect(start).toBe("translate3d(-90px, 0, 0)"); // inverted: it paints at its old place first
        expect(a.style.transform).toBe(""); // ...then the transition carries it to the new one
        expect(a.style.transition).toContain("transform");
        expect(a.style.transition).toContain("--cg-spring");
        expect(a.style.transition).not.toContain("all");

        // the chip that did not move is left alone
        expect(c.style.transform).toBe("");
        expect(c.style.transition).toBe("");

        // the inline transition is cleaned up when it ends, so hover and press styles work again
        a.dispatchEvent(new Event("transitionend"));
        expect(a.style.transition).toBe("");
    });

    it("does nothing when no chip changed place, or when a chip is new", () => {
        const a = chip("a");
        slideChips([a], new Map([["a", 10]]), new Map([["a", 10]]));
        expect(a.style.transition).toBe("");
        const b = chip("b");
        slideChips([b], new Map(), new Map([["b", 10]]));
        expect(b.style.transition).toBe("");
        expect(b.style.transform).toBe("");
    });
});
