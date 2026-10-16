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
import { act, render, screen } from "@testing-library/react";
import { logger } from "matrix-js-sdk/src/logger";

import { ClarivaGoogleButton } from "../../src/clariva/components/auth/ClarivaGoogleButton";
import { authStrings } from "../../src/clariva/strings/auth";
import {
    type GoogleButtonOutcome,
    GoogleUnavailableError,
    type RenderedGoogleButton,
} from "../../src/clariva/session/googleIdentity";

// The real module keeps its error class (the component does `instanceof`); only the GIS-touching render is replaced.
const mockRender = jest.fn();
jest.mock("../../src/clariva/session/googleIdentity", () => ({
    ...jest.requireActual("../../src/clariva/session/googleIdentity"),
    renderGoogleButton: (...args: unknown[]) => mockRender(...args),
}));

interface RenderCall {
    container: HTMLElement;
    options: { text: string; onCredential: (token: string) => void; signal: AbortSignal };
}

const renderCall = (index = 0): RenderCall => {
    const [container, options] = mockRender.mock.calls[index];
    return { container, options };
};

/** A resolved render whose `ready` the test controls. */
function controlledRender(): {
    rendered: RenderedGoogleButton;
    dispose: jest.Mock;
    settle: (outcome: GoogleButtonOutcome) => void;
} {
    let settle: (outcome: GoogleButtonOutcome) => void = () => {};
    const ready = new Promise<GoogleButtonOutcome>((resolve) => {
        settle = resolve;
    });
    const dispose = jest.fn();
    return { rendered: { dispose, ready }, dispose, settle };
}

const flush = async (): Promise<void> => {
    await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    });
};

describe("ClarivaGoogleButton", () => {
    beforeEach(() => {
        mockRender.mockReset();
        jest.spyOn(logger, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("renders Google's button into its container with the requested text", async () => {
        mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
        render(<ClarivaGoogleButton text="signup_with" onCredential={jest.fn()} testId="g" />);
        await flush();

        expect(mockRender).toHaveBeenCalledTimes(1);
        const { container, options } = renderCall();
        expect(container).toBe(screen.getByTestId("g").querySelector(".mx_ClarivaAuth_googleButton"));
        expect(options.text).toBe("signup_with");
        expect(options.signal.aborted).toBe(false);
    });

    describe("width", () => {
        const realRO = (global as any).ResizeObserver;
        const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
        let containerWidth = 318;
        let roCallbacks: Array<() => void> = [];

        beforeEach(() => {
            containerWidth = 318;
            roCallbacks = [];
            (global as any).ResizeObserver = class {
                public constructor(cb: () => void) {
                    roCallbacks.push(cb);
                }
                public observe(): void {}
                public disconnect(): void {}
            };
            Object.defineProperty(HTMLElement.prototype, "clientWidth", {
                configurable: true,
                get: () => containerWidth,
            });
        });

        afterEach(() => {
            (global as any).ResizeObserver = realRO;
            if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDescriptor);
            jest.useRealTimers();
        });

        it("renders Google's button at the MEASURED container width (rounded down to 4px), not before it is known", async () => {
            mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();

            expect(mockRender).toHaveBeenCalledTimes(1);
            expect((mockRender.mock.calls[0][1] as { width?: number }).width).toBe(316);
        });

        it("re-renders at the new width once a resize settles, and ignores changes under 4px", async () => {
            jest.useFakeTimers();
            mockRender.mockImplementation(async () => ({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) }));
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();
            expect(mockRender).toHaveBeenCalledTimes(1);

            containerWidth = 319; // under the 4px step: nothing happens
            act(() => roCallbacks.forEach((cb) => cb()));
            await act(async () => void jest.advanceTimersByTime(200));
            expect(mockRender).toHaveBeenCalledTimes(1);

            containerWidth = 376; // rotation / window resize
            act(() => roCallbacks.forEach((cb) => cb()));
            await act(async () => void jest.advanceTimersByTime(200));
            await flush();
            expect(mockRender).toHaveBeenCalledTimes(2);
            expect((mockRender.mock.calls[1][1] as { width?: number }).width).toBe(376);
            // the previous render was aborted so it can never draw over the new one
            expect((mockRender.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
        });
    });

    describe("onUnavailable", () => {
        it("receives the reason of a { ok: false } outcome", async () => {
            const onUnavailable = jest.fn();
            mockRender.mockResolvedValue({
                dispose: jest.fn(),
                ready: Promise.resolve({ ok: false, reason: "render_failed" }),
            });
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />);
            await flush();
            expect(onUnavailable).toHaveBeenCalledTimes(1);
            expect(onUnavailable).toHaveBeenCalledWith("render_failed");
        });

        it("is not called when the button rendered fine", async () => {
            const onUnavailable = jest.fn();
            mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />);
            await flush();
            expect(onUnavailable).not.toHaveBeenCalled();
        });

        it.each(["script_blocked", "script_timeout", "render_failed"] as const)(
            "receives the reason of a GoogleUnavailableError rejection (%s)",
            async (reason) => {
                const onUnavailable = jest.fn();
                mockRender.mockRejectedValue(new GoogleUnavailableError(reason));
                render(
                    <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />,
                );
                await flush();
                expect(onUnavailable).toHaveBeenCalledTimes(1);
                expect(onUnavailable).toHaveBeenCalledWith(reason);
            },
        );

        it("treats any other rejection as render_failed", async () => {
            const onUnavailable = jest.fn();
            mockRender.mockRejectedValue(new TypeError("something else"));
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />);
            await flush();
            expect(onUnavailable).toHaveBeenCalledWith("render_failed");
        });

        it("works without a listener (no throw)", async () => {
            mockRender.mockRejectedValue(new GoogleUnavailableError("script_blocked"));
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await expect(flush()).resolves.toBeUndefined();
        });

        it("always calls the LATEST listener", async () => {
            const stale = jest.fn();
            const latest = jest.fn();
            const { rendered, settle } = controlledRender();
            mockRender.mockResolvedValue(rendered);
            const { rerender } = render(
                <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={stale} />,
            );
            await flush();
            rerender(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={latest} />);
            settle({ ok: false, reason: "render_failed" });
            await flush();
            expect(stale).not.toHaveBeenCalled();
            expect(latest).toHaveBeenCalledWith("render_failed");
            expect(mockRender).toHaveBeenCalledTimes(1); // a new listener does not re-render Google's button
        });

        it("nothing fires after unmount: not a late outcome, not a late rejection", async () => {
            const onUnavailable = jest.fn();

            const lateOutcome = controlledRender();
            mockRender.mockResolvedValueOnce(lateOutcome.rendered);
            const first = render(
                <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />,
            );
            await flush();
            first.unmount();
            lateOutcome.settle({ ok: false, reason: "render_failed" });
            await flush();

            let rejectRender: (e: unknown) => void = () => {};
            mockRender.mockReturnValueOnce(
                new Promise((_resolve, reject) => {
                    rejectRender = reject;
                }),
            );
            const second = render(
                <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />,
            );
            second.unmount();
            rejectRender(new GoogleUnavailableError("script_timeout"));
            await flush();

            expect(onUnavailable).not.toHaveBeenCalled();
        });
    });

    describe("lifecycle", () => {
        it("unmount aborts the signal and disposes the render", async () => {
            const { rendered, dispose } = controlledRender();
            mockRender.mockResolvedValue(rendered);
            const { unmount } = render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();
            const { options } = renderCall();
            expect(dispose).not.toHaveBeenCalled();

            unmount();

            expect(options.signal.aborted).toBe(true);
            expect(dispose).toHaveBeenCalledTimes(1);
        });

        it("a render that finishes AFTER unmount is disposed immediately and never reported", async () => {
            const onUnavailable = jest.fn();
            const late = controlledRender();
            let resolveRender: (r: RenderedGoogleButton) => void = () => {};
            mockRender.mockReturnValue(
                new Promise<RenderedGoogleButton>((resolve) => {
                    resolveRender = resolve;
                }),
            );
            const { unmount } = render(
                <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />,
            );
            unmount();
            resolveRender(late.rendered);
            late.settle({ ok: false, reason: "render_failed" });
            await flush();

            expect(late.dispose).toHaveBeenCalledTimes(1);
            expect(onUnavailable).not.toHaveBeenCalled();
        });

        it("changing 'text' aborts the previous signal, disposes the previous render, and renders anew", async () => {
            const first = controlledRender();
            const second = controlledRender();
            mockRender.mockResolvedValueOnce(first.rendered).mockResolvedValueOnce(second.rendered);
            const { rerender } = render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();
            const firstCall = renderCall(0);

            rerender(<ClarivaGoogleButton text="signup_with" onCredential={jest.fn()} />);
            await flush();

            expect(firstCall.options.signal.aborted).toBe(true);
            expect(first.dispose).toHaveBeenCalledTimes(1);
            expect(mockRender).toHaveBeenCalledTimes(2);
            const secondCall = renderCall(1);
            expect(secondCall.options.text).toBe("signup_with");
            expect(secondCall.options.signal.aborted).toBe(false);
            expect(secondCall.container).toBe(firstCall.container); // the same container, a fresh render
            expect(second.dispose).not.toHaveBeenCalled();
        });

        it("a stale outcome from the previous text is ignored", async () => {
            const onUnavailable = jest.fn();
            const first = controlledRender();
            const second = controlledRender();
            mockRender.mockResolvedValueOnce(first.rendered).mockResolvedValueOnce(second.rendered);
            const { rerender } = render(
                <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />,
            );
            await flush();
            rerender(<ClarivaGoogleButton text="signup_with" onCredential={jest.fn()} onUnavailable={onUnavailable} />);
            await flush();

            first.settle({ ok: false, reason: "render_failed" }); // belongs to the render that was replaced
            await flush();
            expect(onUnavailable).not.toHaveBeenCalled();

            second.settle({ ok: false, reason: "script_timeout" });
            await flush();
            expect(onUnavailable).toHaveBeenCalledTimes(1);
            expect(onUnavailable).toHaveBeenCalledWith("script_timeout");
        });

        it("re-renders with an unchanged text do not re-render Google's button", async () => {
            mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
            const { rerender } = render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();
            rerender(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} disabled />);
            rerender(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();
            expect(mockRender).toHaveBeenCalledTimes(1);
        });
    });

    describe("disabled", () => {
        const buttonContainer = (): HTMLElement =>
            screen.getByTestId("g").querySelector(".mx_ClarivaAuth_googleButton") as HTMLElement;
        const shield = (): Element | null => screen.getByTestId("g").querySelector(".mx_ClarivaAuth_googleShield");

        beforeEach(() => {
            mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
        });

        it("toggles the inert attribute (keyboard, assistive tech) and the mouse shield together", async () => {
            const { rerender } = render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} testId="g" />);
            await flush();
            expect(buttonContainer()).not.toHaveAttribute("inert");
            expect(shield()).toBeNull();

            rerender(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} disabled testId="g" />);
            expect(buttonContainer()).toHaveAttribute("inert");
            expect(shield()).not.toBeNull();
            expect(shield()).toHaveAttribute("aria-hidden", "true");

            rerender(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} testId="g" />);
            expect(buttonContainer()).not.toHaveAttribute("inert");
            expect(shield()).toBeNull();
        });

        it("starts out inert when mounted disabled", async () => {
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} disabled testId="g" />);
            await flush();
            expect(buttonContainer()).toHaveAttribute("inert");
            expect(shield()).not.toBeNull();
        });

        it("swallows a credential that arrives while disabled, and forwards it to the latest handler otherwise", async () => {
            const stale = jest.fn();
            const latest = jest.fn();
            const { rerender } = render(<ClarivaGoogleButton text="signin_with" onCredential={stale} testId="g" />);
            await flush();
            const { onCredential } = renderCall().options;

            rerender(<ClarivaGoogleButton text="signin_with" onCredential={latest} disabled testId="g" />);
            onCredential("while-disabled");
            expect(latest).not.toHaveBeenCalled();

            rerender(<ClarivaGoogleButton text="signin_with" onCredential={latest} testId="g" />);
            onCredential("while-enabled");
            expect(latest).toHaveBeenCalledWith("while-enabled", "signin_with");
            expect(stale).not.toHaveBeenCalled();
        });
    });

    describe("onCredential reports the text the delivering button was RENDERED with", () => {
        it("passes the token and the rendered text, for each of the three texts", async () => {
            for (const text of ["signin_with", "signup_with", "continue_with"] as const) {
                mockRender.mockReset();
                mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
                const onCredential = jest.fn();
                const { unmount } = render(<ClarivaGoogleButton text={text} onCredential={onCredential} />);
                await flush();
                renderCall().options.onCredential("id-token");
                expect(onCredential).toHaveBeenCalledTimes(1);
                expect(onCredential).toHaveBeenCalledWith("id-token", text);
                unmount();
            }
        });

        it("a credential from the render of the OLD text keeps that text after the text changed", async () => {
            const first = controlledRender();
            const second = controlledRender();
            mockRender.mockResolvedValueOnce(first.rendered).mockResolvedValueOnce(second.rendered);
            const onCredential = jest.fn();
            const { rerender } = render(<ClarivaGoogleButton text="signin_with" onCredential={onCredential} />);
            await flush();
            rerender(<ClarivaGoogleButton text="signup_with" onCredential={onCredential} />);
            await flush();

            // the account chooser was opened from the "Sign in" button, then the page flipped to "Sign up"
            renderCall(0).options.onCredential("from-old-button");
            expect(onCredential).toHaveBeenLastCalledWith("from-old-button", "signin_with");
            renderCall(1).options.onCredential("from-new-button");
            expect(onCredential).toHaveBeenLastCalledWith("from-new-button", "signup_with");
        });
    });

    describe("pending (until Google has drawn)", () => {
        const wrap = (): HTMLElement => screen.getByTestId("g");
        const loading = (): Element | null => wrap().querySelector(".mx_ClarivaAuth_googleLoading");

        it("shows 'Connecting to Google…' from the first paint, hidden from assistive tech, inside the wrap", () => {
            mockRender.mockReturnValue(new Promise(() => {})); // never answers
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} testId="g" />);
            expect(loading()).not.toBeNull();
            expect(loading()).toHaveTextContent(authStrings.googleLoading);
            expect(loading()).toHaveAttribute("aria-hidden", "true");
            expect(wrap()).toContainElement(loading() as HTMLElement);
            // the live Google container is a sibling, still empty: nothing is announced
            expect(wrap().querySelector(".mx_ClarivaAuth_googleButton")).toBeEmptyDOMElement();
        });

        it("stays while the render has resolved but Google has not drawn, and goes once ready says ok", async () => {
            const { rendered, settle } = controlledRender();
            mockRender.mockResolvedValue(rendered);
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} testId="g" />);
            await flush();
            expect(loading()).not.toBeNull(); // resolved is not drawn

            settle({ ok: true });
            await flush();
            expect(loading()).toBeNull();
        });

        it("goes when Google drew nothing too (the caller then shows its notice)", async () => {
            const onUnavailable = jest.fn();
            const { rendered, settle } = controlledRender();
            mockRender.mockResolvedValue(rendered);
            render(
                <ClarivaGoogleButton
                    text="signin_with"
                    onCredential={jest.fn()}
                    onUnavailable={onUnavailable}
                    testId="g"
                />,
            );
            await flush();
            settle({ ok: false, reason: "render_failed" });
            await flush();
            expect(loading()).toBeNull();
            expect(onUnavailable).toHaveBeenCalledWith("render_failed");
        });

        it("goes when the render rejects", async () => {
            const onUnavailable = jest.fn();
            mockRender.mockRejectedValue(new GoogleUnavailableError("script_blocked"));
            render(
                <ClarivaGoogleButton
                    text="signin_with"
                    onCredential={jest.fn()}
                    onUnavailable={onUnavailable}
                    testId="g"
                />,
            );
            await flush();
            expect(loading()).toBeNull();
            expect(onUnavailable).toHaveBeenCalledWith("script_blocked");
        });

        it("a text change starts a new pending period, which ends when the replacement has drawn", async () => {
            const first = controlledRender();
            const second = controlledRender();
            mockRender.mockResolvedValueOnce(first.rendered).mockResolvedValueOnce(second.rendered);
            const { rerender } = render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} testId="g" />);
            await flush();
            first.settle({ ok: true });
            await flush();
            expect(loading()).toBeNull(); // the first button is up

            rerender(<ClarivaGoogleButton text="signup_with" onCredential={jest.fn()} testId="g" />);
            await flush();
            expect(loading()).not.toBeNull(); // the replacement has not drawn yet

            second.settle({ ok: true });
            await flush();
            expect(loading()).toBeNull();
        });

        it("a late outcome of a replaced run is ignored while the new run is still pending", async () => {
            const onUnavailable = jest.fn();
            const first = controlledRender();
            const second = controlledRender();
            mockRender.mockResolvedValueOnce(first.rendered).mockResolvedValueOnce(second.rendered);
            const { rerender } = render(
                <ClarivaGoogleButton
                    text="signin_with"
                    onCredential={jest.fn()}
                    onUnavailable={onUnavailable}
                    testId="g"
                />,
            );
            await flush();
            rerender(
                <ClarivaGoogleButton
                    text="signup_with"
                    onCredential={jest.fn()}
                    onUnavailable={onUnavailable}
                    testId="g"
                />,
            );
            await flush();

            first.settle({ ok: true }); // the replaced run answers late: it must not end the new run's pending state
            await flush();
            expect(loading()).not.toBeNull();
            expect(onUnavailable).not.toHaveBeenCalled();
        });

        it("an aborted run (unmount) never touches the state: no React warning", async () => {
            const errors = jest.spyOn(console, "error").mockImplementation(() => {});
            const { rendered, settle } = controlledRender();
            mockRender.mockResolvedValue(rendered);
            const { unmount } = render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} />);
            await flush();
            unmount();
            settle({ ok: true });
            await flush();
            expect(errors).not.toHaveBeenCalled();
        });
    });

    describe("autoFocus", () => {
        const wrap = (): HTMLElement => screen.getByTestId("g");

        beforeEach(() => {
            mockRender.mockResolvedValue({ dispose: jest.fn(), ready: Promise.resolve({ ok: true }) });
        });

        it("focuses the wrapper once on mount when asked (a programmatic target, out of the tab order)", async () => {
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} autoFocus testId="g" />);
            await flush();
            expect(wrap()).toHaveFocus();
            expect(wrap()).toHaveAttribute("tabindex", "-1");
        });

        it("does not touch focus by default", async () => {
            render(<ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} testId="g" />);
            await flush();
            expect(wrap()).not.toHaveFocus();
            expect(document.body).toHaveFocus();
        });

        it("only on mount: a re-render or a text change does not steal focus back", async () => {
            const { rerender } = render(
                <ClarivaGoogleButton text="signin_with" onCredential={jest.fn()} autoFocus testId="g" />,
            );
            await flush();
            const other = document.createElement("button");
            document.body.appendChild(other);
            other.focus();

            rerender(<ClarivaGoogleButton text="signup_with" onCredential={jest.fn()} autoFocus testId="g" />);
            await flush();
            rerender(<ClarivaGoogleButton text="signup_with" onCredential={jest.fn()} autoFocus disabled testId="g" />);
            await flush();
            expect(other).toHaveFocus();
            other.remove();
        });
    });
});
