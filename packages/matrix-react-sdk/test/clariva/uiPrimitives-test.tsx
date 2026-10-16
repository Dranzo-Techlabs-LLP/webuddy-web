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
import { act, cleanup, render, screen } from "@testing-library/react";

import * as ui from "../../src/clariva/ui";
import { ClarivaAurora, CoinIcon, Skeleton } from "../../src/clariva/ui";

/** jsdom is always "visible"; shadow `document.hidden` on the instance and tell listeners the tab changed. */
function setTabHidden(hidden: boolean): void {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
    });
}

/** The window loses / regains focus (another app is in front, or focus moved into an iframe). */
function setWindowFocus(focused: boolean): void {
    act(() => {
        window.dispatchEvent(new Event(focused ? "focus" : "blur"));
    });
}

afterEach(() => {
    cleanup();
    delete (document as { hidden?: boolean }).hidden; // back to the prototype getter
});

describe("src/clariva/ui exports", () => {
    it("exposes the three primitives", () => {
        expect(Object.keys(ui).sort()).toEqual(["ClarivaAurora", "CoinIcon", "Skeleton"]);
    });
});

describe("ClarivaAurora", () => {
    it("a static aurora is a decorative, still layer", () => {
        render(<ClarivaAurora />);
        const layer = screen.getByTestId("clariva-aurora");
        expect(layer).toHaveClass("cg-aurora");
        expect(layer).not.toHaveClass("cg-aurora--live");
        expect(layer).not.toHaveClass("cg-paused");
        expect(layer).toHaveAttribute("aria-hidden", "true");
    });

    it("live adds the drifting modifier and merges a caller class", () => {
        render(<ClarivaAurora live className="mx_Home_aurora" />);
        const layer = screen.getByTestId("clariva-aurora");
        expect(layer).toHaveClass("cg-aurora", "cg-aurora--live", "mx_Home_aurora");
        expect(layer).not.toHaveClass("cg-paused");
    });

    it("a live aurora pauses while the tab is hidden and resumes when it is visible again", () => {
        render(<ClarivaAurora live />);
        const layer = screen.getByTestId("clariva-aurora");

        setTabHidden(true);
        expect(layer).toHaveClass("cg-paused");

        setTabHidden(false);
        expect(layer).not.toHaveClass("cg-paused");
    });

    it("a live aurora also pauses while the window has lost focus, and resumes when it is focused again", () => {
        render(<ClarivaAurora live />);
        const layer = screen.getByTestId("clariva-aurora");

        setWindowFocus(false);
        expect(layer).toHaveClass("cg-paused");

        setWindowFocus(true);
        expect(layer).not.toHaveClass("cg-paused");
    });

    it("blur and visibility are combined: it runs only when the tab is visible AND the window is focused", () => {
        render(<ClarivaAurora live />);
        const layer = screen.getByTestId("clariva-aurora");

        setWindowFocus(false);
        setTabHidden(true);
        setWindowFocus(true); // focused again, but the tab is still hidden
        expect(layer).toHaveClass("cg-paused");

        setTabHidden(false);
        expect(layer).not.toHaveClass("cg-paused");

        setTabHidden(true);
        setTabHidden(false);
        setWindowFocus(false); // visible again, but the window is not focused
        expect(layer).toHaveClass("cg-paused");
        setWindowFocus(true);
        expect(layer).not.toHaveClass("cg-paused");
    });

    it("a live aurora mounted in a hidden tab starts paused", () => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        render(<ClarivaAurora live />);
        expect(screen.getByTestId("clariva-aurora")).toHaveClass("cg-paused");
    });

    it("a static aurora never gets cg-paused and never listens to the tab or the window focus", () => {
        const add = jest.spyOn(document, "addEventListener");
        const addWindow = jest.spyOn(window, "addEventListener");
        render(<ClarivaAurora />);
        setTabHidden(true);
        setWindowFocus(false);
        expect(screen.getByTestId("clariva-aurora")).not.toHaveClass("cg-paused");
        expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(0);
        expect(addWindow.mock.calls.filter(([type]) => type === "blur" || type === "focus")).toHaveLength(0);
        add.mockRestore();
        addWindow.mockRestore();
    });

    it("removes its visibilitychange listener on unmount", () => {
        const add = jest.spyOn(document, "addEventListener");
        const remove = jest.spyOn(document, "removeEventListener");
        const { unmount } = render(<ClarivaAurora live />);
        const added = add.mock.calls.filter(([type]) => type === "visibilitychange");
        expect(added).toHaveLength(1);
        unmount();
        expect(
            remove.mock.calls.filter(([type, fn]) => type === "visibilitychange" && fn === added[0][1]),
        ).toHaveLength(1);
        add.mockRestore();
        remove.mockRestore();
    });

    it("removes its window blur and focus listeners on unmount", () => {
        const add = jest.spyOn(window, "addEventListener");
        const remove = jest.spyOn(window, "removeEventListener");
        const { unmount } = render(<ClarivaAurora live />);
        const added = (type: string): unknown[][] => add.mock.calls.filter(([t]) => t === type);
        expect(added("blur")).toHaveLength(1);
        expect(added("focus")).toHaveLength(1);
        unmount();
        for (const type of ["blur", "focus"]) {
            expect(remove.mock.calls.filter(([t, fn]) => t === type && fn === added(type)[0][1])).toHaveLength(1);
        }
        add.mockRestore();
        remove.mockRestore();
    });

    it("switching live off un-pauses and detaches", () => {
        const { rerender } = render(<ClarivaAurora live />);
        setTabHidden(true);
        expect(screen.getByTestId("clariva-aurora")).toHaveClass("cg-paused");
        rerender(<ClarivaAurora />);
        expect(screen.getByTestId("clariva-aurora")).not.toHaveClass("cg-paused");
        expect(screen.getByTestId("clariva-aurora")).not.toHaveClass("cg-aurora--live");

        // blurring the window no longer pauses anything: the listeners are gone
        setWindowFocus(false);
        expect(screen.getByTestId("clariva-aurora")).not.toHaveClass("cg-paused");
    });
});

describe("CoinIcon", () => {
    it("is a decorative 20px square by default, in the amber token and currentColor", () => {
        render(<CoinIcon />);
        const coin = screen.getByTestId("clariva-coin");
        expect(coin.tagName.toLowerCase()).toBe("svg");
        expect(coin).toHaveAttribute("width", "20");
        expect(coin).toHaveAttribute("height", "20");
        expect(coin).toHaveAttribute("viewBox", "0 0 20 20");
        expect(coin).toHaveAttribute("aria-hidden", "true");
        expect(coin).not.toHaveAttribute("role");
        expect(coin).toHaveClass("cg-coin");
        expect(coin.querySelector(".cg-coin__face")).not.toBeNull(); // filled with --cg-amber by the stylesheet
        expect(coin.querySelector("circle")).toHaveAttribute("stroke", "currentColor");
        expect(coin.querySelector("path")).toHaveAttribute("stroke", "currentColor");
        expect(coin.querySelector(".cg-coin__glint")).toBeNull();
    });

    it("size and class name are configurable", () => {
        render(<CoinIcon size={32} className="mx_Wallet_coin" />);
        const coin = screen.getByTestId("clariva-coin");
        expect(coin).toHaveAttribute("width", "32");
        expect(coin).toHaveAttribute("height", "32");
        expect(coin).toHaveClass("cg-coin", "mx_Wallet_coin");
    });

    it("glint adds a sweep that is clipped to the coin, with an id that is unique per instance", () => {
        const { container } = render(
            <>
                <CoinIcon glint />
                <CoinIcon glint />
            </>,
        );
        const sweeps = container.querySelectorAll(".cg-coin__glint");
        expect(sweeps).toHaveLength(2);
        const clips = [...container.querySelectorAll("clipPath")].map((c) => c.id);
        expect(clips).toHaveLength(2);
        expect(new Set(clips).size).toBe(2);
        const groups = [...container.querySelectorAll("g[clip-path]")].map((g) => g.getAttribute("clip-path"));
        expect(groups).toEqual(clips.map((id) => `url(#${id})`));
    });

    it("a title makes it an image with an accessible name instead of aria-hidden", () => {
        render(<CoinIcon title="Credits" />);
        const coin = screen.getByRole("img", { name: "Credits" });
        expect(coin).not.toHaveAttribute("aria-hidden");
        expect(coin.querySelector("title")?.textContent).toBe("Credits");
    });
});

describe("Skeleton", () => {
    it("is a hidden, pulsing block", () => {
        render(<Skeleton />);
        const block = screen.getByTestId("clariva-skeleton");
        expect(block).toHaveClass("cg-skeleton", "cg-pulse");
        expect(block).toHaveAttribute("aria-hidden", "true");
        expect(block.style.width).toBe("");
        expect(block.style.height).toBe("");
        expect(block.style.borderRadius).toBe("");
    });

    it("a number is pixels, a string is any CSS length", () => {
        const { rerender } = render(<Skeleton width={120} height={16} />);
        const block = screen.getByTestId("clariva-skeleton");
        expect(block.style.width).toBe("120px");
        expect(block.style.height).toBe("16px");
        rerender(<Skeleton width="60%" height="1.25rem" />);
        expect(block.style.width).toBe("60%");
        expect(block.style.height).toBe("1.25rem");
    });

    it.each(["xs", "sm", "md", "lg", "xl", "pill"] as const)("radius %s maps to the --cg-r-%s token", (token) => {
        render(<Skeleton radius={token} />);
        expect(screen.getByTestId("clariva-skeleton").style.borderRadius).toBe(`var(--cg-r-${token})`);
    });

    it("any other radius is taken as a length", () => {
        const { rerender } = render(<Skeleton radius={6} />);
        expect(screen.getByTestId("clariva-skeleton").style.borderRadius).toBe("6px");
        rerender(<Skeleton radius="50%" />);
        expect(screen.getByTestId("clariva-skeleton").style.borderRadius).toBe("50%");
    });

    it("merges a caller class", () => {
        render(<Skeleton className="mx_Row_avatar" />);
        expect(screen.getByTestId("clariva-skeleton")).toHaveClass("cg-skeleton", "cg-pulse", "mx_Row_avatar");
    });
});
