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

import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
    ClarivaComposerAction,
    KEYBOARD_SEND_WINDOW_MS,
    isKeyboardSendFlip,
} from "../../src/clariva/components/room/ComposerAction";
import { COMPOSER_HEIGHT_VAR, ClarivaComposerMeasure } from "../../src/clariva/components/room/ComposerMeasure";
import MessageComposer from "../../src/components/views/rooms/MessageComposer";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import RoomContext from "../../src/contexts/RoomContext";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import { type IRoomState } from "../../src/components/structures/RoomView";
import ResizeNotifier from "../../src/utils/ResizeNotifier";
import { RoomPermalinkCreator } from "../../src/utils/permalinks/Permalinks";
import SdkConfig from "../../src/SdkConfig";
import { configureClariva } from "./helpers";
import { addTextToComposerRTL } from "../test-utils/composer";
import { createTestClient, mkStubRoom, mockPlatformPeg, stubClient } from "../test-utils";

// The gate is the chat workstream's; here it is a switch that hands the composer a ready-made bar (or nothing).
let mockBar: ReactNode | null = null;
jest.mock("../../src/clariva/components/chat/ComposerGate", () => ({
    ClarivaComposerGate: ({ room, children }: { room: unknown; children: (bar: ReactNode | null) => ReactNode }) => (
        <>{children(mockBar)}</>
    ),
}));

describe("isKeyboardSendFlip", () => {
    const now = 1_000_000;

    it("is true only when the composer is CLEARED (send -> mic) within the window after an Enter", () => {
        expect(isKeyboardSendFlip("send", "mic", now - 100, now)).toBe(true);
        expect(isKeyboardSendFlip("send", "mic", now - KEYBOARD_SEND_WINDOW_MS, now)).toBe(true);
    });

    it("is false for typing into an empty composer, for a click, and when the Enter is too old or never happened", () => {
        expect(isKeyboardSendFlip("mic", "send", now - 100, now)).toBe(false);
        expect(isKeyboardSendFlip("send", "send", now - 100, now)).toBe(false);
        expect(isKeyboardSendFlip("mic", "mic", now - 100, now)).toBe(false);
        expect(isKeyboardSendFlip("send", "mic", now - KEYBOARD_SEND_WINDOW_MS - 1, now)).toBe(false);
        expect(isKeyboardSendFlip("send", "mic", 0, now)).toBe(false);
    });
});

describe("ClarivaComposerAction", () => {
    let clock: number;
    const onSend = jest.fn();
    const onMic = jest.fn();

    /** The action inside a `.mx_MessageComposer` (it listens for Enter on its composer). */
    const ui = (mode: "mic" | "send"): JSX.Element => (
        <div className="mx_MessageComposer" data-testid="composer">
            <ClarivaComposerAction
                mode={mode}
                sendTitle="Send message"
                micTitle="Voice message"
                onSend={onSend}
                onMic={onMic}
                now={() => clock}
            />
        </div>
    );
    const button = (): HTMLElement => document.querySelector(".mx_ClarivaComposerAction") as HTMLElement;
    const pressEnter = (init: KeyboardEventInit = {}): void => {
        fireEvent.keyDown(screen.getByTestId("composer"), { key: "Enter", ...init });
    };

    beforeEach(() => {
        clock = 10_000;
        onSend.mockReset();
        onMic.mockReset();
    });

    afterEach(cleanup);

    it("is the microphone while there is nothing to send: its own test id and the 'Voice message' name", () => {
        render(ui("mic"));
        expect(screen.getByTestId("clariva-composer-mic")).toBe(button());
        expect(screen.getByRole("button", { name: "Voice message" })).toBe(button());
        expect(button()).toHaveAttribute("data-mode", "mic");
        expect(screen.queryByTestId("sendmessagebtn")).toBeNull();
    });

    it("is the send arrow once there is something to send: the stock test id and 'Send message' name", () => {
        render(ui("send"));
        expect(screen.getByTestId("sendmessagebtn")).toBe(button());
        expect(screen.getByRole("button", { name: "Send message" })).toBe(button());
        expect(button()).toHaveAttribute("data-mode", "send");
        expect(screen.queryByTestId("clariva-composer-mic")).toBeNull();
    });

    it("draws both glyphs (the stylesheet cross-fades them) and hides both from assistive tech", () => {
        render(ui("send"));
        // (the jest svg mock renders an icon as a div; in the browser it is an inline svg with the same classes)
        const icons = button().querySelectorAll(".mx_ClarivaComposerAction_icon");
        expect(icons).toHaveLength(2);
        icons.forEach((icon) => expect(icon).toHaveAttribute("aria-hidden", "true"));
        expect(button().querySelector(".mx_ClarivaComposerAction_mic")).not.toBeNull();
        expect(button().querySelector(".mx_ClarivaComposerAction_send")).not.toBeNull();
    });

    it("a click sends in send mode and starts a recording in mic mode", () => {
        const { rerender } = render(ui("mic"));
        fireEvent.click(button());
        expect(onMic).toHaveBeenCalledTimes(1);
        expect(onSend).not.toHaveBeenCalled();
        rerender(ui("send"));
        fireEvent.click(button());
        expect(onSend).toHaveBeenCalledTimes(1);
        expect(onMic).toHaveBeenCalledTimes(1);
    });

    it("is reachable and operable by keyboard (a real button role with Enter / Space)", () => {
        render(ui("send"));
        expect(button()).toHaveAttribute("role", "button");
        expect(button()).toHaveAttribute("tabindex", "0");
        fireEvent.keyDown(button(), { key: "Enter" });
        fireEvent.keyUp(button(), { key: "Enter" });
        expect(onSend).toHaveBeenCalled();
    });

    it("typing into an empty composer cross-fades: the flip to send is NOT instant", () => {
        const { rerender } = render(ui("mic"));
        expect(button()).not.toHaveAttribute("data-instant");
        rerender(ui("send"));
        expect(button()).toHaveAttribute("data-mode", "send");
        expect(button()).not.toHaveAttribute("data-instant");
    });

    it("an Enter that sends clears the composer INSTANTLY: the flip back to the microphone carries data-instant", () => {
        const { rerender } = render(ui("send"));
        pressEnter();
        clock += 50;
        rerender(ui("mic"));
        expect(button()).toHaveAttribute("data-mode", "mic");
        expect(button()).toHaveAttribute("data-instant", "true");
    });

    it("the instant flag goes again on the next render, so the NEXT cross-fade is a normal one", () => {
        const { rerender } = render(ui("send"));
        pressEnter();
        rerender(ui("mic"));
        expect(button()).toHaveAttribute("data-instant", "true");
        rerender(ui("mic"));
        expect(button()).not.toHaveAttribute("data-instant");
        rerender(ui("send"));
        expect(button()).not.toHaveAttribute("data-instant");
    });

    it("clicking Send (no Enter) still cross-fades back to the microphone", () => {
        const { rerender } = render(ui("send"));
        fireEvent.click(button());
        rerender(ui("mic"));
        expect(button()).not.toHaveAttribute("data-instant");
    });

    it("Shift+Enter (a new line), and an Enter pressed with nothing to send, do not count as a keyboard send", () => {
        const { rerender } = render(ui("send"));
        pressEnter({ shiftKey: true });
        rerender(ui("mic"));
        expect(button()).not.toHaveAttribute("data-instant");

        pressEnter(); // mode is "mic" now: there is nothing to send
        rerender(ui("send"));
        rerender(ui("mic"));
        expect(button()).not.toHaveAttribute("data-instant");
    });

    it("an Enter from long ago does not make a later, unrelated clear instant", () => {
        const { rerender } = render(ui("send"));
        pressEnter();
        clock += KEYBOARD_SEND_WINDOW_MS + 1;
        rerender(ui("mic"));
        expect(button()).not.toHaveAttribute("data-instant");
    });

    it("stops listening when it unmounts", () => {
        const { unmount } = render(ui("send"));
        const composer = screen.getByTestId("composer");
        const remove = jest.spyOn(composer, "removeEventListener");
        unmount();
        expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    });
});

describe("ClarivaComposerMeasure", () => {
    let height: number;
    let observed: (() => void) | null;
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    const realRO = (global as { ResizeObserver?: unknown }).ResizeObserver;

    beforeEach(() => {
        jest.useFakeTimers();
        height = 76.2;
        observed = null;
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            const h = this.classList.contains("mx_MessageComposer") ? height : 0;
            return { height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON: () => ({}) };
        };
        (global as { ResizeObserver?: unknown }).ResizeObserver = class {
            public constructor(cb: () => void) {
                observed = cb;
            }
            public observe(): void {}
            public disconnect(): void {
                observed = null;
            }
        };
    });

    afterEach(() => {
        cleanup();
        jest.useRealTimers();
        HTMLElement.prototype.getBoundingClientRect = realRect;
        (global as { ResizeObserver?: unknown }).ResizeObserver = realRO;
    });

    const inRoomBody = (onChange?: () => void): JSX.Element => (
        <div className="mx_RoomView_body" data-testid="body">
            <div className="mx_MessageComposer">
                <ClarivaComposerMeasure onChange={onChange} />
            </div>
        </div>
    );

    it("publishes the composer's height (rounded up) on the room body, for the timeline's padding", () => {
        const onChange = jest.fn();
        render(inRoomBody(onChange));
        expect(screen.getByTestId("body").style.getPropertyValue(COMPOSER_HEIGHT_VAR)).toBe("77px");
        expect(COMPOSER_HEIGHT_VAR).toBe("--cg-composer-h");
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("follows the composer as it grows (one update per frame) and says so", () => {
        const onChange = jest.fn();
        render(inRoomBody(onChange));
        height = 140;
        act(() => {
            observed?.();
            observed?.(); // several resizes in one frame are one update
            jest.advanceTimersByTime(32);
        });
        expect(screen.getByTestId("body").style.getPropertyValue(COMPOSER_HEIGHT_VAR)).toBe("140px");
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("does nothing when the height did not change", () => {
        const onChange = jest.fn();
        render(inRoomBody(onChange));
        act(() => {
            observed?.();
            jest.advanceTimersByTime(32);
        });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("removes the variable when the composer goes away (the last message is then not padded for nothing)", () => {
        const { unmount } = render(inRoomBody());
        const body = screen.getByTestId("body");
        unmount();
        expect(body.style.getPropertyValue(COMPOSER_HEIGHT_VAR)).toBe("");
    });

    it("does nothing in a composer outside a room body (a thread's)", () => {
        const { container } = render(
            <div className="mx_MessageComposer">
                <ClarivaComposerMeasure />
            </div>,
        );
        expect(container.querySelector("[style]")).toBeNull();
    });
});

describe("MessageComposer (the Clariva branch)", () => {
    const room = (): ReturnType<typeof mkStubRoom> => mkStubRoom("!roomId:server", "Room 1", createTestClient());

    const renderComposer = (): ReturnType<typeof render> => {
        const client = MatrixClientPeg.safeGet();
        const stub: any = room();
        const context = { room: stub, canSendMessages: true, narrow: false } as unknown as IRoomState;
        return render(
            <MatrixClientContext.Provider value={client}>
                <RoomContext.Provider value={context}>
                    <div className="mx_RoomView_body" data-testid="body">
                        <MessageComposer
                            room={stub}
                            resizeNotifier={new ResizeNotifier()}
                            permalinkCreator={new RoomPermalinkCreator(stub)}
                        />
                    </div>
                </RoomContext.Provider>
            </MatrixClientContext.Provider>,
        );
    };

    beforeEach(() => {
        stubClient();
        mockPlatformPeg();
        mockBar = null;
        jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            const h = this.classList.contains("mx_MessageComposer") ? 64 : 0;
            return {
                height: h,
                width: 0,
                top: 0,
                left: 0,
                right: 0,
                bottom: h,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect;
        });
    });

    afterEach(() => {
        cleanup();
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    it("an empty composer offers the microphone, not Send", () => {
        configureClariva();
        renderComposer();
        // Element's own string for the mic, unchanged
        expect(screen.getByTestId("clariva-composer-mic")).toHaveAccessibleName("Voice Message");
        expect(screen.queryByTestId("sendmessagebtn")).toBeNull();
    });

    it("once there is text the circle is Send (same button, test id and name Element's tests know)", async () => {
        configureClariva();
        const result = renderComposer();
        await addTextToComposerRTL(result, "Hello");
        expect(screen.getByTestId("sendmessagebtn")).toHaveAccessibleName("Send message");
        expect(screen.getByTestId("sendmessagebtn")).toHaveClass("mx_ClarivaComposerAction");
        expect(screen.queryByTestId("clariva-composer-mic")).toBeNull();
    });

    it("tells the timeline how tall it is (so the last message is never hidden behind it)", () => {
        configureClariva();
        renderComposer();
        expect(screen.getByTestId("body").style.getPropertyValue(COMPOSER_HEIGHT_VAR)).toBe("64px");
    });

    it("a restricted chat replaces the whole composer with the bar: no textbox, no mic, no send", () => {
        configureClariva();
        mockBar = <div data-testid="gate-bar">Chat restricted</div>;
        renderComposer();
        expect(screen.getByTestId("gate-bar")).toBeInTheDocument();
        expect(screen.queryByLabelText("Send a message…")).toBeNull();
        expect(screen.queryByTestId("clariva-composer-mic")).toBeNull();
        expect(screen.queryByTestId("sendmessagebtn")).toBeNull();
    });

    it("Clariva off: Element's composer, no morphing circle and no measuring", async () => {
        SdkConfig.reset();
        const result = renderComposer();
        expect(screen.queryByTestId("clariva-composer-mic")).toBeNull();
        await addTextToComposerRTL(result, "Hello");
        expect(screen.getByLabelText("Send message")).not.toHaveClass("mx_ClarivaComposerAction");
        expect(screen.getByTestId("body").style.getPropertyValue(COMPOSER_HEIGHT_VAR)).toBe("");
    });
});
