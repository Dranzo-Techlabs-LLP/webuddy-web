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

import { RechargeSuccess, prefersReducedMotion } from "../../src/clariva/components/wallet/RechargeSuccess";

/** jsdom has no matchMedia: install one that answers `prefers-reduced-motion: reduce` with `reduce`. */
function mockReducedMotion(reduce: boolean): void {
    Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string) => ({
            matches: reduce && query.includes("prefers-reduced-motion"),
            media: query,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        }),
    });
}

afterEach(() => {
    cleanup();
    delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("<RechargeSuccess /> (the one allowed delight of the wallet)", () => {
    it("announces the result in a status region: the title, what was added and the new balance", () => {
        render(<RechargeSuccess added={500} newBalance={620} />);
        const region = screen.getByRole("status");
        expect(region).toHaveAttribute("data-testid", "clariva-success");
        expect(screen.getByRole("heading", { level: 2, name: "Credits added" })).toBeInTheDocument();
        expect(screen.getByText("500 credits are now in your Clariva wallet.")).toBeInTheDocument();
        expect(screen.getByText("New balance: 620 credits")).toBeInTheDocument();
    });

    it("leaves out the lines it has no number for (never an invented 0)", () => {
        render(<RechargeSuccess added={null} newBalance={null} />);
        expect(screen.getByRole("heading", { name: "Credits added" })).toBeInTheDocument();
        expect(screen.queryByText(/are now in your Clariva wallet/)).not.toBeInTheDocument();
        expect(screen.queryByText(/New balance/)).not.toBeInTheDocument();
    });

    it("the picture is decorative: the seal and its check are hidden from assistive technology", () => {
        render(<RechargeSuccess added={100} newBalance={null} />);
        expect(screen.getByTestId("clariva-success-seal")).toHaveAttribute("aria-hidden", "true");
        expect(screen.getByTestId("clariva-success-seal").querySelector(".mx_ClarivaSuccess_check")).toHaveAttribute(
            "focusable",
            "false",
        );
        // the check is a path of length 1: the stylesheet draws it with a plain 1 -> 0 stroke-dashoffset
        const tick = document.querySelector(".mx_ClarivaSuccess_tick");
        expect(tick).toHaveAttribute("pathLength", "1");
    });

    it("animates by default (jsdom has no matchMedia, which counts as 'no preference'): the seal carries the animate class and the coin glints", () => {
        render(<RechargeSuccess added={100} newBalance={200} />);
        expect(screen.getByTestId("clariva-success-seal")).toHaveClass("mx_ClarivaSuccess_seal_animate");
        expect(screen.getByTestId("clariva-success")).toHaveAttribute("data-animated", "true");
        expect(document.querySelector(".cg-coin__glint")).not.toBeNull();
    });

    it("animate={false} renders the finished picture: no animate class and no glint", () => {
        render(<RechargeSuccess added={100} newBalance={200} animate={false} />);
        expect(screen.getByTestId("clariva-success-seal")).not.toHaveClass("mx_ClarivaSuccess_seal_animate");
        expect(screen.getByTestId("clariva-success")).toHaveAttribute("data-animated", "false");
        expect(document.querySelector(".cg-coin__glint")).toBeNull();
        // the words and the drawn check are still there
        expect(screen.getByRole("heading", { name: "Credits added" })).toBeInTheDocument();
        expect(document.querySelector(".mx_ClarivaSuccess_tick")).not.toBeNull();
    });

    it("prefers-reduced-motion: reduce removes the animate class and the glint without a prop", () => {
        mockReducedMotion(true);
        render(<RechargeSuccess added={100} newBalance={200} />);
        expect(prefersReducedMotion()).toBe(true);
        expect(screen.getByTestId("clariva-success-seal")).not.toHaveClass("mx_ClarivaSuccess_seal_animate");
        expect(document.querySelector(".cg-coin__glint")).toBeNull();
    });

    it("no preference: the same render animates", () => {
        mockReducedMotion(false);
        render(<RechargeSuccess added={100} newBalance={200} />);
        expect(prefersReducedMotion()).toBe(false);
        expect(screen.getByTestId("clariva-success-seal")).toHaveClass("mx_ClarivaSuccess_seal_animate");
    });

    it("an explicit animate={true} wins over the media query (the caller decides)", () => {
        mockReducedMotion(true);
        render(<RechargeSuccess added={100} newBalance={200} animate />);
        expect(screen.getByTestId("clariva-success-seal")).toHaveClass("mx_ClarivaSuccess_seal_animate");
    });

    it("prefersReducedMotion never throws when matchMedia does", () => {
        Object.defineProperty(window, "matchMedia", {
            configurable: true,
            writable: true,
            value: () => {
                throw new Error("boom");
            },
        });
        expect(prefersReducedMotion()).toBe(false);
    });
});
