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
import Modal, { ModalManagerEvent } from "../../src/Modal";
import { UserTab } from "../../src/components/views/dialogs/UserTab";
import { RoomNotificationStateStore } from "../../src/stores/notifications/RoomNotificationStateStore";
import { ClarivaTabBar, TAB_ORDER, chatsTabLabel, tabAfterKey } from "../../src/clariva/components/shell/ClarivaTabBar";
import { chatsStrings } from "../../src/clariva/strings/chats";
import { configureClariva } from "./helpers";

// The badge itself is the stock component (tested upstream); here it only has to be placed on the Chats tab.
jest.mock("../../src/components/views/rooms/NotificationBadge", () => ({
    __esModule: true,
    default: () => require("react").createElement("span", { "data-testid": "badge" }),
}));

function setUnread(count: number): void {
    jest.spyOn(RoomNotificationStateStore.instance, "globalState", "get").mockReturnValue({ count } as any);
}

const tabs = (): HTMLElement[] => screen.getAllByRole("tab");
const selected = (): string[] =>
    tabs()
        .filter((tab) => tab.getAttribute("aria-selected") === "true")
        .map((t) => t.id);

afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (window as any).visualViewport;
    SdkConfig.reset();
});

describe("tab bar keys", () => {
    it("moves right and left with wrap-around, and Home / End jump to the ends", () => {
        expect(TAB_ORDER).toEqual(["chats", "wallet", "me"]);
        expect(tabAfterKey("chats", "ArrowRight")).toBe("wallet");
        expect(tabAfterKey("wallet", "ArrowRight")).toBe("me");
        expect(tabAfterKey("me", "ArrowRight")).toBe("chats");
        expect(tabAfterKey("chats", "ArrowLeft")).toBe("me");
        expect(tabAfterKey("wallet", "Home")).toBe("chats");
        expect(tabAfterKey("chats", "End")).toBe("me");
    });

    it("mirrors the arrows in a right-to-left layout and ignores every other key", () => {
        expect(tabAfterKey("chats", "ArrowLeft", true)).toBe("wallet");
        expect(tabAfterKey("chats", "ArrowRight", true)).toBe("me");
        expect(tabAfterKey("chats", "Tab")).toBeNull();
        expect(tabAfterKey("chats", "Enter")).toBeNull();
        expect(tabAfterKey("chats", " ")).toBeNull();
    });

    it("names the Chats tab with the unread count only when there is one", () => {
        expect(chatsTabLabel(0)).toBe("Chats");
        expect(chatsTabLabel(1)).toBe("Chats, 1 unread");
        expect(chatsTabLabel(12)).toBe("Chats, 12 unread");
    });
});

describe("<ClarivaTabBar />", () => {
    beforeEach(() => {
        configureClariva();
        setUnread(0);
        jest.spyOn(Modal, "hasDialogs").mockReturnValue(false);
    });

    it("renders nothing when Clariva is not configured", () => {
        SdkConfig.reset();
        const { container } = render(<ClarivaTabBar />);
        expect(container).toBeEmptyDOMElement();
    });

    it("is a tablist of Chats, Wallet and Me with Chats selected", () => {
        render(<ClarivaTabBar />);
        expect(screen.getByRole("tablist", { name: chatsStrings.tabBarLabel })).toBeInTheDocument();
        expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual(["Chats", "Wallet", "Me"]);
        expect(selected()).toEqual(["clariva-tab-chats"]);
        // one tab stop for the whole bar (roving tabindex)
        expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
        // icon + label are visible text, the accessible name comes from aria-label
        expect(tabs().map((tab) => tab.textContent)).toEqual(["Chats", "Wallet", "Me"]);
    });

    it("tells a screen reader how many chats are unread, and shows the badge on the Chats tab only", () => {
        setUnread(3);
        render(<ClarivaTabBar />);
        expect(screen.getByRole("tab", { name: "Chats, 3 unread" })).toBeInTheDocument();
        expect(screen.getAllByTestId("badge")).toHaveLength(1);
        expect(screen.getByTestId("clariva-tab-chats")).toContainElement(screen.getByTestId("badge"));
    });

    it("moves focus with the arrow keys without opening anything", () => {
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaTabBar />);
        const [chats, wallet, me] = tabs();
        chats.focus();

        fireEvent.keyDown(chats, { key: "ArrowRight" });
        expect(wallet).toHaveFocus();
        expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
        fireEvent.keyDown(wallet, { key: "End" });
        expect(me).toHaveFocus();
        fireEvent.keyDown(me, { key: "ArrowRight" });
        expect(chats).toHaveFocus();
        fireEvent.keyDown(chats, { key: "ArrowLeft" });
        expect(me).toHaveFocus();
        fireEvent.keyDown(me, { key: "Home" });
        expect(chats).toHaveFocus();

        // moving the focus never selects or opens: the tabs open dialogs
        expect(selected()).toEqual(["clariva-tab-chats"]);
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("Wallet opens the Wallet tab of the settings and the indicator follows", () => {
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaTabBar />);
        fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewUserSettings, initialTabId: UserTab.Wallet }),
        );
        expect(selected()).toEqual(["clariva-tab-wallet"]);
        expect(screen.getByTestId("clariva-tab-bar")).toHaveAttribute("data-active", "wallet");
        // the indicator slides by transform only: one tab width per step
        expect(
            screen.getByTestId("clariva-tab-bar").querySelector(".mx_ClarivaTabBar_indicator")!.getAttribute("style"),
        ).toContain("translate3d(100%");
    });

    it("Me opens the user settings", () => {
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaTabBar />);
        fireEvent.click(screen.getByRole("tab", { name: "Me" }));
        expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewUserSettings });
        expect(selected()).toEqual(["clariva-tab-me"]);
    });

    it("Chats is where you are: pressing it opens nothing", () => {
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaTabBar />);
        fireEvent.click(screen.getByRole("tab", { name: "Chats" }));
        expect(dispatch).not.toHaveBeenCalled();
        expect(selected()).toEqual(["clariva-tab-chats"]);
    });

    it("hands the indicator back to Chats when the dialog closes", () => {
        jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        render(<ClarivaTabBar />);
        fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));
        expect(selected()).toEqual(["clariva-tab-wallet"]);
        act(() => {
            Modal.emit(ModalManagerEvent.Closed);
        });
        expect(selected()).toEqual(["clariva-tab-chats"]);
    });

    it("hands the indicator back after a moment when nothing opened, but not while a dialog is up", () => {
        jest.useFakeTimers();
        jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        const hasDialogs = jest.spyOn(Modal, "hasDialogs").mockReturnValue(true);
        render(<ClarivaTabBar />);

        fireEvent.click(screen.getByRole("tab", { name: "Me" }));
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(selected()).toEqual(["clariva-tab-me"]);

        hasDialogs.mockReturnValue(false);
        fireEvent.click(screen.getByRole("tab", { name: "Wallet" }));
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(selected()).toEqual(["clariva-tab-chats"]);
    });

    describe("steps aside while the on-screen keyboard is up", () => {
        const bar = (): HTMLElement => screen.getByTestId("clariva-tab-bar");

        it("is shown at rest", () => {
            render(<ClarivaTabBar />);
            expect(bar()).not.toHaveClass("mx_ClarivaTabBar_hidden");
        });

        it("hides while a text field has focus", () => {
            render(
                <>
                    <input aria-label="Search" />
                    <ClarivaTabBar />
                </>,
            );
            const input = screen.getByLabelText("Search");
            act(() => {
                input.focus();
                fireEvent.focusIn(input);
            });
            expect(bar()).toHaveClass("mx_ClarivaTabBar_hidden");

            act(() => {
                input.blur();
                fireEvent.focusOut(input);
            });
            expect(bar()).not.toHaveClass("mx_ClarivaTabBar_hidden");
        });

        it("does not hide for a button or a checkbox", () => {
            render(
                <>
                    <button>Press</button>
                    <input type="checkbox" aria-label="Tick" />
                    <ClarivaTabBar />
                </>,
            );
            for (const el of [screen.getByRole("button", { name: "Press" }), screen.getByRole("checkbox")]) {
                act(() => {
                    el.focus();
                    fireEvent.focusIn(el);
                });
                expect(bar()).not.toHaveClass("mx_ClarivaTabBar_hidden");
            }
        });

        it("hides when the visual viewport shrinks by a keyboard, but not when the user pinch-zooms", () => {
            const full = window.innerHeight;
            const viewport = Object.assign(new EventTarget(), { height: full, scale: 1 });
            (window as any).visualViewport = viewport;
            render(<ClarivaTabBar />);
            expect(bar()).not.toHaveClass("mx_ClarivaTabBar_hidden");

            act(() => {
                viewport.height = full - 320;
                viewport.dispatchEvent(new Event("resize"));
            });
            expect(bar()).toHaveClass("mx_ClarivaTabBar_hidden");

            act(() => {
                viewport.scale = 2; // pinch-zoom also shrinks the visual viewport; that is not a keyboard
                viewport.dispatchEvent(new Event("resize"));
            });
            expect(bar()).not.toHaveClass("mx_ClarivaTabBar_hidden");

            act(() => {
                viewport.scale = 1;
                viewport.height = full;
                viewport.dispatchEvent(new Event("resize"));
            });
            expect(bar()).not.toHaveClass("mx_ClarivaTabBar_hidden");
        });
    });
});
