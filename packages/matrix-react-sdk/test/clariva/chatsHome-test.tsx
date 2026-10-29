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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import SdkConfig from "../../src/SdkConfig";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import PageType from "../../src/PageTypes";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import RoomListStore from "../../src/stores/room-list/RoomListStore";
import {
    availableChatFilters,
    CHAT_FILTER_ORDER,
    ChatFilter,
    ChatFilterCondition,
    ClarivaChatFilterStore,
    emptyStateCopy,
    roomMatchesFilters,
    toggleChatFilter,
    visibleChatFilters,
    type RoomFacts,
} from "../../src/clariva/components/chats/chatFilters";
import { ChatFilterChips } from "../../src/clariva/components/chats/ChatFilterChips";
import { ChatsEmptyState } from "../../src/clariva/components/chats/ChatsEmptyState";
import { ClarivaChatsFab } from "../../src/clariva/components/chats/ChatsFab";
import { formatChatTimestamp } from "../../src/clariva/components/chats/chatTime";
import { ClarivaShell } from "../../src/clariva/components/shell/ClarivaShell";
import { ClarivaBackButton, ClarivaDetailBar } from "../../src/clariva/components/shell/BackButton";
import { clarivaLhsMinimized, clarivaViewFor } from "../../src/clariva/components/shell/viewState";
import { chatsStrings } from "../../src/clariva/strings/chats";
import { configureClariva } from "./helpers";

const NONE: RoomFacts = { isDm: false, isInvite: false, isFavourite: false, isUnread: false };

afterEach(() => {
    cleanup();
    ClarivaChatFilterStore.instance.reset();
    jest.restoreAllMocks();
    SdkConfig.reset();
});

describe("chat filter selection (Android RoomListFilter rules)", () => {
    it("lists the chips in Android's order", () => {
        expect(CHAT_FILTER_ORDER).toEqual([
            ChatFilter.Unread,
            ChatFilter.People,
            ChatFilter.Rooms,
            ChatFilter.Favourites,
            ChatFilter.Invites,
        ]);
    });

    it("toggles a chip on and off", () => {
        const on = toggleChatFilter(new Set(), ChatFilter.Unread);
        expect([...on]).toEqual([ChatFilter.Unread]);
        expect(toggleChatFilter(on, ChatFilter.Unread).size).toBe(0);
    });

    it("People and Rooms replace each other, Invites replaces everything else", () => {
        const people = toggleChatFilter(new Set([ChatFilter.Unread]), ChatFilter.People);
        expect([...people]).toEqual([ChatFilter.Unread, ChatFilter.People]);
        const rooms = toggleChatFilter(people, ChatFilter.Rooms);
        expect([...rooms]).toEqual([ChatFilter.Unread, ChatFilter.Rooms]);
        const invites = toggleChatFilter(rooms, ChatFilter.Invites);
        expect([...invites]).toEqual([ChatFilter.Invites]);
        // and the other way round
        expect([...toggleChatFilter(invites, ChatFilter.Favourites)]).toEqual([ChatFilter.Favourites]);
    });

    it("offers every chip but Rooms while group rooms are off", () => {
        expect(availableChatFilters(true)).toEqual(CHAT_FILTER_ORDER);
        expect(availableChatFilters(false)).toEqual([
            ChatFilter.Unread,
            ChatFilter.People,
            ChatFilter.Favourites,
            ChatFilter.Invites,
        ]);
        const noRooms = availableChatFilters(false);
        expect(visibleChatFilters(new Set(), noRooms)).toEqual(noRooms);
        expect(visibleChatFilters(new Set([ChatFilter.Favourites]), noRooms)).toEqual([
            ChatFilter.Favourites,
            ChatFilter.Unread,
            ChatFilter.People,
        ]);
        // the default follows the configuration: stock (no Clariva) keeps them all, Clariva hides Rooms by default
        expect(availableChatFilters()).toEqual(CHAT_FILTER_ORDER);
        configureClariva();
        expect(availableChatFilters()).not.toContain(ChatFilter.Rooms);
        configureClariva({ features: { group_rooms: true } });
        expect(availableChatFilters()).toContain(ChatFilter.Rooms);
    });

    it("shows the selected chips first and hides the ones that cannot be combined", () => {
        expect(visibleChatFilters(new Set())).toEqual(CHAT_FILTER_ORDER);
        expect(visibleChatFilters(new Set([ChatFilter.Favourites]))).toEqual([
            ChatFilter.Favourites,
            ChatFilter.Unread,
            ChatFilter.People,
            ChatFilter.Rooms,
        ]);
        expect(visibleChatFilters(new Set([ChatFilter.Invites]))).toEqual([ChatFilter.Invites]);
    });

    it("matches rooms with an AND of the selected chips", () => {
        const dm: RoomFacts = { ...NONE, isDm: true };
        const room: RoomFacts = { ...NONE };
        expect(roomMatchesFilters(room, new Set())).toBe(true);
        expect(roomMatchesFilters(dm, new Set([ChatFilter.People]))).toBe(true);
        expect(roomMatchesFilters(room, new Set([ChatFilter.People]))).toBe(false);
        expect(roomMatchesFilters(room, new Set([ChatFilter.Rooms]))).toBe(true);
        expect(roomMatchesFilters(dm, new Set([ChatFilter.Rooms]))).toBe(false);
        expect(roomMatchesFilters({ ...dm, isUnread: true }, new Set([ChatFilter.People, ChatFilter.Unread]))).toBe(
            true,
        );
        expect(roomMatchesFilters(dm, new Set([ChatFilter.People, ChatFilter.Unread]))).toBe(false);
        expect(roomMatchesFilters({ ...room, isFavourite: true }, new Set([ChatFilter.Favourites]))).toBe(true);
        expect(roomMatchesFilters({ ...room, isInvite: true }, new Set([ChatFilter.Invites]))).toBe(true);
        expect(roomMatchesFilters(room, new Set([ChatFilter.Invites]))).toBe(false);
    });

    it("uses Android's empty-state copy", () => {
        expect(emptyStateCopy(new Set())).toEqual({
            title: "No chats yet.",
            subtitle: "Get started by messaging someone.",
        });
        expect(emptyStateCopy(new Set([ChatFilter.Unread])).title).toBe("Congrats!");
        expect(emptyStateCopy(new Set([ChatFilter.People])).title).toBe("You don’t have any DMs yet");
        expect(emptyStateCopy(new Set([ChatFilter.Unread, ChatFilter.People])).title).toBe(
            "You don’t have chats for this selection",
        );
        expect(emptyStateCopy(new Set([ChatFilter.Invites])).subtitle).toBeUndefined();
    });
});

describe("ClarivaChatFilterStore", () => {
    it("registers one room-list filter while any chip is selected and removes it with the last chip", () => {
        const add = jest.spyOn(RoomListStore.instance, "addFilter").mockResolvedValue();
        const remove = jest.spyOn(RoomListStore.instance, "removeFilter").mockImplementation(() => {});
        const store = ClarivaChatFilterStore.instance;

        store.toggle(ChatFilter.Unread);
        store.toggle(ChatFilter.Favourites);
        expect(add).toHaveBeenCalledTimes(1);
        expect(add.mock.calls[0][0]).toBeInstanceOf(ChatFilterCondition);

        store.toggle(ChatFilter.Unread);
        expect(remove).not.toHaveBeenCalled();
        store.toggle(ChatFilter.Favourites);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls[0][0]).toBe(add.mock.calls[0][0]);
        expect(store.selected.size).toBe(0);
    });

    it("clear() and reset() both unhook from the room list", () => {
        jest.spyOn(RoomListStore.instance, "addFilter").mockResolvedValue();
        const remove = jest.spyOn(RoomListStore.instance, "removeFilter").mockImplementation(() => {});
        const store = ClarivaChatFilterStore.instance;
        store.toggle(ChatFilter.People);
        store.clear();
        expect(remove).toHaveBeenCalledTimes(1);
        store.toggle(ChatFilter.People);
        store.reset();
        expect(remove).toHaveBeenCalledTimes(2);
        expect(store.selected.size).toBe(0);
    });
});

describe("<ChatFilterChips />", () => {
    beforeEach(() => {
        jest.spyOn(RoomListStore.instance, "addFilter").mockResolvedValue();
        jest.spyOn(RoomListStore.instance, "removeFilter").mockImplementation(() => {});
    });

    it("renders nothing when Clariva is not configured", () => {
        SdkConfig.reset();
        const { container } = render(<ChatFilterChips />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows the five chips with aria-pressed and toggles them (group rooms on)", () => {
        configureClariva({ features: { group_rooms: true } });
        render(<ChatFilterChips />);
        const group = screen.getByRole("group", { name: chatsStrings.filtersLabel });
        expect(group).toHaveAttribute("data-active", "false");
        for (const label of ["Unread", "People", "Rooms", "Favourites", "Invites"]) {
            expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
        }
        expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "People" }));
        expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-pressed", "true");
        expect(group).toHaveAttribute("data-active", "true");
        // Rooms and Invites cannot be combined with People
        expect(screen.queryByRole("button", { name: "Rooms" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Invites" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Rooms" })).toBeInTheDocument();
        expect(group).toHaveAttribute("data-active", "false");
    });

    it("has no Rooms chip while group rooms are off (the default, Android GROUP_ROOMS_ENABLED = false)", () => {
        configureClariva();
        render(<ChatFilterChips />);
        for (const label of ["Unread", "People", "Favourites", "Invites"]) {
            expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
        }
        expect(screen.queryByRole("button", { name: "Rooms" })).toBeNull();
        // and it cannot be selected another way either
        act(() => ClarivaChatFilterStore.instance.toggle(ChatFilter.Rooms));
        expect(ClarivaChatFilterStore.instance.selected.size).toBe(0);
        fireEvent.click(screen.getByRole("button", { name: "People" }));
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(screen.queryByRole("button", { name: "Rooms" })).toBeNull();
    });

    it("forgets the selection when it unmounts (sign-out)", () => {
        configureClariva();
        const { unmount } = render(<ChatFilterChips />);
        fireEvent.click(screen.getByRole("button", { name: "Unread" }));
        expect(ClarivaChatFilterStore.instance.selected.size).toBe(1);
        unmount();
        expect(ClarivaChatFilterStore.instance.selected.size).toBe(0);
    });
});

describe("<ChatsEmptyState />", () => {
    function mockLists(lists: Record<string, unknown[]>, synced = true): void {
        jest.spyOn(RoomListStore.instance, "orderedLists", "get").mockReturnValue(lists as any);
        jest.spyOn(MatrixClientPeg, "get").mockReturnValue({ isInitialSyncComplete: () => synced } as any);
    }

    it("offers Start a chat when there are no chats at all", () => {
        configureClariva();
        mockLists({ "m.favourite": [], "im.vector.fake.direct": [] });
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ChatsEmptyState />);
        expect(screen.getByText("No chats yet.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Start a chat" }));
        expect(dispatch).toHaveBeenCalledWith({ action: "view_create_chat" });
    });

    it("renders nothing while there are chats, while syncing, or without Clariva", () => {
        configureClariva();
        mockLists({ "im.vector.fake.direct": [{}] });
        const { container, unmount } = render(<ChatsEmptyState />);
        expect(container).toBeEmptyDOMElement();
        unmount();

        mockLists({}, false);
        const second = render(<ChatsEmptyState />);
        expect(second.container).toBeEmptyDOMElement();
        second.unmount();

        SdkConfig.reset();
        mockLists({});
        const third = render(<ChatsEmptyState />);
        expect(third.container).toBeEmptyDOMElement();
    });

    it("explains an empty filter and offers Clear filters", () => {
        configureClariva();
        jest.spyOn(RoomListStore.instance, "addFilter").mockResolvedValue();
        jest.spyOn(RoomListStore.instance, "removeFilter").mockImplementation(() => {});
        mockLists({});
        render(<ChatsEmptyState />);
        act(() => ClarivaChatFilterStore.instance.toggle(ChatFilter.Favourites));
        expect(screen.getByText("You don’t have favourite chats yet")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(screen.getByText("No chats yet.")).toBeInTheDocument();
    });
});

describe("<ClarivaChatsFab />", () => {
    it("is a labelled button that starts a chat (Android's a11y label 'Start a new chat')", () => {
        configureClariva();
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaChatsFab />);
        fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));
        expect(dispatch).toHaveBeenCalledWith({ action: "view_create_chat" });
    });

    it("renders nothing without Clariva", () => {
        SdkConfig.reset();
        const { container } = render(<ClarivaChatsFab />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("chat row timestamp", () => {
    // Wednesday 14 May 2025, 15:30 local
    const now = new Date(2025, 4, 14, 15, 30);
    const at = (y: number, m: number, d: number, h = 9, min = 5): number => new Date(y, m, d, h, min).getTime();

    it("shows the time today, Yesterday, the weekday this week, then the date", () => {
        expect(formatChatTimestamp(at(2025, 4, 14), now, "en-US")).toMatch(/^9:05\s?AM$/);
        expect(formatChatTimestamp(at(2025, 4, 13, 23, 59), now, "en-US")).toBe("Yesterday");
        expect(formatChatTimestamp(at(2025, 4, 10), now, "en-US")).toBe("Sat");
        expect(formatChatTimestamp(at(2025, 3, 16), now, "en-US")).toBe("Apr 16");
        expect(formatChatTimestamp(at(2024, 0, 29), now, "en-US")).toBe("Jan 29, 2024");
    });

    it("shows nothing for a missing or absurd timestamp", () => {
        expect(formatChatTimestamp(0, now)).toBe("");
        expect(formatChatTimestamp(Number.MAX_SAFE_INTEGER, now)).toBe("");
        expect(formatChatTimestamp(Number.NaN, now)).toBe("");
    });
});

describe("responsive shell", () => {
    it("maps pages to the phone panes", () => {
        expect(clarivaViewFor(PageType.HomePage)).toBe("list");
        expect(clarivaViewFor(undefined)).toBe("list");
        expect(clarivaViewFor(PageType.RoomView)).toBe("detail");
        expect(clarivaViewFor(PageType.UserView)).toBe("detail");
    });

    it("never minimises the left panel while Clariva is configured", () => {
        SdkConfig.reset();
        expect(clarivaLhsMinimized(true)).toBe(true);
        configureClariva();
        expect(clarivaLhsMinimized(true)).toBe(false);
        expect(clarivaLhsMinimized(undefined)).toBe(false);
    });

    it("keeps data-clariva-view on <html> (data-clariva is the root marker's job) and cleans up", () => {
        configureClariva();
        const root = document.documentElement;
        const { rerender, unmount } = render(<ClarivaShell pageType={PageType.HomePage} />);
        expect(root.hasAttribute("data-clariva")).toBe(true); // set by isClarivaEnabled(), not by the shell
        expect(root.dataset.clarivaView).toBe("list");
        rerender(<ClarivaShell pageType={PageType.RoomView} />);
        expect(root.dataset.clarivaView).toBe("detail");
        rerender(<ClarivaShell pageType={PageType.HomePage} />);
        expect(root.dataset.clarivaView).toBe("list");
        unmount();
        expect(root.dataset.clarivaView).toBeUndefined();
    });

    it("sets nothing without Clariva", () => {
        SdkConfig.reset();
        render(<ClarivaShell pageType={PageType.RoomView} />);
        expect(document.documentElement.dataset.clarivaView).toBeUndefined();
    });

    it("mirrors the visual viewport into CSS variables", () => {
        configureClariva();
        const listeners: Record<string, () => void> = {};
        const viewport = {
            height: 412.4,
            offsetTop: 0,
            scale: 1,
            addEventListener: (name: string, fn: () => void) => (listeners[name] = fn),
            removeEventListener: jest.fn(),
        };
        Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
        const { unmount } = render(<ClarivaShell pageType={PageType.RoomView} />);
        const root = document.documentElement;
        expect(root.style.getPropertyValue("--clariva-vvh")).toBe("412px");
        viewport.height = 300;
        viewport.offsetTop = 12;
        act(() => listeners.resize());
        expect(root.style.getPropertyValue("--clariva-vvh")).toBe("300px");
        expect(root.style.getPropertyValue("--clariva-vv-top")).toBe("12px");
        viewport.scale = 2; // pinch zoomed: do not resize the layout
        act(() => listeners.resize());
        expect(root.style.getPropertyValue("--clariva-vvh")).toBe("");
        unmount();
        expect(root.style.getPropertyValue("--clariva-vv-top")).toBe("");
        Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    });

    it("the Back button returns to the Chats list", () => {
        configureClariva();
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaBackButton />);
        fireEvent.click(screen.getByRole("button", { name: chatsStrings.backToChats }));
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewHomePage });
    });

    it("the fallback bar carries a Back button and the Chats label; both vanish without Clariva", () => {
        configureClariva();
        const { container, unmount } = render(<ClarivaDetailBar />);
        expect(container.querySelector(".mx_ClarivaDetailBar")).not.toBeNull();
        expect(screen.getByRole("button", { name: chatsStrings.backToChats })).toBeInTheDocument();
        unmount();
        SdkConfig.reset();
        expect(render(<ClarivaDetailBar />).container).toBeEmptyDOMElement();
        expect(render(<ClarivaBackButton />).container).toBeEmptyDOMElement();
    });
});
