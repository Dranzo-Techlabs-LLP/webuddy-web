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

import { mocked, MockedObject } from "jest-mock";
import { MatrixClient } from "matrix-js-sdk/src/matrix";
import {
    EventDirection,
    ISendToDeviceFromWidgetActionRequest,
    WidgetApiFromWidgetAction,
    WidgetEventCapability,
} from "matrix-widget-api";
import { waitFor } from "@testing-library/react";

import {
    createEncryptedToDeviceFallback,
    ENCRYPTED_TO_DEVICE_UNSUPPORTED_MESSAGE,
    registerEncryptedToDeviceFallback,
} from "../../src/clariva/calls/toDeviceFallback";
import { StopGapWidget } from "../../src/stores/widgets/StopGapWidget";
import { StopGapWidgetDriver } from "../../src/stores/widgets/StopGapWidgetDriver";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import SdkConfig from "../../src/SdkConfig";
import { mkRoom, stubClient } from "../test-utils";
import { configureClariva } from "./helpers";

const SEND_TO_DEVICE_EVENT = `action:${WidgetApiFromWidgetAction.SendToDevice}`;

/** What Element Call 0.16.3 sends for its media keys (encrypted, to every device of the other member). */
function request(encrypted: unknown = true, omitFlag = false): CustomEvent<ISendToDeviceFromWidgetActionRequest> {
    const detail = {
        api: "fromWidget",
        widgetId: "test",
        requestId: "req-1",
        action: WidgetApiFromWidgetAction.SendToDevice,
        data: {
            type: "io.element.call.encryption_keys",
            ...(omitFlag ? {} : { encrypted }),
            messages: { "@rao:clarivahub.com": { "*": { keys: { index: 0, key: "AAAA" } } } },
        },
    } as unknown as ISendToDeviceFromWidgetActionRequest;
    return new CustomEvent("action:send_to_device", { detail, cancelable: true });
}

describe("encrypted to-device fallback (Rust crypto has no client.crypto)", () => {
    describe("createEncryptedToDeviceFallback", () => {
        it("answers an encrypted send with exactly one 'not supported' error and cancels the default handling", () => {
            const reply = jest.fn();
            const listener = createEncryptedToDeviceFallback({ transport: { reply } } as any, () => false);
            const ev = request(true);

            listener(ev);

            expect(ev.defaultPrevented).toBe(true);
            expect(reply).toHaveBeenCalledTimes(1);
            expect(reply).toHaveBeenCalledWith(ev.detail, {
                error: { message: ENCRYPTED_TO_DEVICE_UNSUPPORTED_MESSAGE },
            });
        });

        it("uses a message Element Call 0.16.3 treats as 'switch to room-event key transport'", () => {
            // EC only falls back when the error message contains "not supported" (case sensitive).
            expect(ENCRYPTED_TO_DEVICE_UNSUPPORTED_MESSAGE).toContain("not supported");
        });

        it("leaves an encrypted send untouched when the client has the legacy crypto the driver needs", () => {
            const reply = jest.fn();
            const listener = createEncryptedToDeviceFallback({ transport: { reply } } as any, () => true);
            const ev = request(true);

            listener(ev);

            expect(ev.defaultPrevented).toBe(false);
            expect(reply).not.toHaveBeenCalled();
        });

        it("leaves an unencrypted send untouched (queueToDevice works without crypto)", () => {
            const reply = jest.fn();
            const listener = createEncryptedToDeviceFallback({ transport: { reply } } as any, () => false);
            const ev = request(false);

            listener(ev);

            expect(ev.defaultPrevented).toBe(false);
            expect(reply).not.toHaveBeenCalled();
        });

        it.each([undefined, "true", 1, null])(
            "leaves a malformed encryption flag (%p) to the widget API's own validation",
            (flag) => {
                const reply = jest.fn();
                const listener = createEncryptedToDeviceFallback({ transport: { reply } } as any, () => false);
                const ev = request(flag, flag === undefined);

                listener(ev);

                expect(ev.defaultPrevented).toBe(false);
                expect(reply).not.toHaveBeenCalled();
            },
        );

        it("does not throw on an event without data", () => {
            const reply = jest.fn();
            const listener = createEncryptedToDeviceFallback({ transport: { reply } } as any, () => false);
            const ev = new CustomEvent("action:send_to_device", {
                detail: { action: "send_to_device" },
                cancelable: true,
            });

            expect(() => listener(ev as any)).not.toThrow();
            expect(ev.defaultPrevented).toBe(false);
            expect(reply).not.toHaveBeenCalled();
        });
    });

    describe("registerEncryptedToDeviceFallback", () => {
        afterEach(() => SdkConfig.reset());

        it("registers one send_to_device listener when Clariva calls are enabled", () => {
            configureClariva({ features: { calls: true } });
            const messaging = { on: jest.fn(), transport: { reply: jest.fn() } };

            expect(registerEncryptedToDeviceFallback(messaging as any, { crypto: undefined })).toBe(true);

            expect(messaging.on).toHaveBeenCalledTimes(1);
            expect(messaging.on).toHaveBeenCalledWith(SEND_TO_DEVICE_EVENT, expect.any(Function));
        });

        it("the registered listener reads client.crypto at call time", () => {
            configureClariva({ features: { calls: true } });
            const messaging = { on: jest.fn(), transport: { reply: jest.fn() } };
            const client: Pick<MatrixClient, "crypto"> = { crypto: undefined };
            registerEncryptedToDeviceFallback(messaging as any, client);
            const listener = messaging.on.mock.calls[0][1];

            const withoutCrypto = request(true);
            listener(withoutCrypto);
            expect(withoutCrypto.defaultPrevented).toBe(true);

            client.crypto = {} as any; // legacy crypto appears later
            const withCrypto = request(true);
            listener(withCrypto);
            expect(withCrypto.defaultPrevented).toBe(false);
            expect(messaging.transport.reply).toHaveBeenCalledTimes(1);
        });

        it("never registers a listener when the calls feature flag is off", () => {
            configureClariva({ features: { calls: false } });
            const messaging = { on: jest.fn(), transport: { reply: jest.fn() } };

            expect(registerEncryptedToDeviceFallback(messaging as any, { crypto: undefined })).toBe(false);

            expect(messaging.on).not.toHaveBeenCalled();
        });

        it("never registers a listener when Clariva is not configured at all (stock Element Web)", () => {
            SdkConfig.reset();
            const messaging = { on: jest.fn(), transport: { reply: jest.fn() } };

            expect(registerEncryptedToDeviceFallback(messaging as any, { crypto: undefined })).toBe(false);

            expect(messaging.on).not.toHaveBeenCalled();
        });
    });

    /**
     * The real thing: `StopGapWidget.startMessaging` builds the real `ClientWidgetApi` (and the real
     * `StopGapWidgetDriver`) on a fake iframe, the "widget" posts a `send_to_device` message to the window and we read
     * what the host posts back to the iframe. This is what Element Call 0.16.3 does with its media keys.
     */
    describe("through StopGapWidget.startMessaging and the real ClientWidgetApi", () => {
        const TYPE = "io.element.call.encryption_keys";
        let client: MockedObject<MatrixClient>;
        let widget: StopGapWidget | undefined;
        let postMessage: jest.Mock;
        let nextId = 0;
        let widgetId: string;
        let driverSend: jest.SpyInstance;

        /** Everything the host posted to the iframe in answer to request `requestId`. */
        const answers = (requestId: string): any[] =>
            postMessage.mock.calls.map(([message]) => message).filter((message) => message.requestId === requestId);

        function start(): void {
            widgetId = `ec-${nextId++}`;
            widget = new StopGapWidget({
                app: {
                    id: widgetId,
                    creatorUserId: "@alice:example.org",
                    type: "example",
                    url: "https://example.org/element-call/index.html",
                    roomId: "!1:example.org",
                },
                room: mkRoom(client, "!1:example.org"),
                userId: "@alice:example.org",
                creatorUserId: "@alice:example.org",
                waitForIframeLoad: true,
                userWidget: false,
            });
            postMessage = jest.fn();
            const iframe = { contentWindow: { postMessage }, addEventListener: jest.fn() };
            widget.startMessaging(iframe as unknown as HTMLIFrameElement);
            // The capability negotiation is not what is under test: pretend EC was granted the to-device send.
            (widget.widgetApi as any).allowedEvents = [
                WidgetEventCapability.forToDeviceEvent(EventDirection.Send, TYPE),
            ];
        }

        /** EC's `sendToDevice(TYPE, encrypted, { user: { "*": keys } })`, as a postMessage from the widget. */
        async function widgetSendsToDevice(requestId: string, encrypted: boolean): Promise<void> {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {
                        api: "fromWidget",
                        widgetId,
                        requestId,
                        action: WidgetApiFromWidgetAction.SendToDevice,
                        data: {
                            type: TYPE,
                            encrypted,
                            messages: { "@rao:clarivahub.com": { "*": { keys: { index: 0, key: "AAAA" } } } },
                        },
                    },
                }),
            );
            await waitFor(() => expect(answers(requestId).length).toBeGreaterThan(0));
            await new Promise((resolve) => setTimeout(resolve, 0)); // a second (wrong) answer would land by now
        }

        beforeEach(() => {
            stubClient();
            client = mocked(MatrixClientPeg.safeGet());
            driverSend = jest.spyOn(StopGapWidgetDriver.prototype, "sendToDevice");
        });

        afterEach(() => {
            widget?.widgetApi?.stop();
            widget?.stopMessaging();
            widget = undefined;
            driverSend.mockRestore();
            SdkConfig.reset();
        });

        it("flag off, Rust crypto: the stock driver fails with the generic error EC swallows (the defect)", async () => {
            configureClariva({ features: { calls: false } });
            (client as any).crypto = undefined; // Rust crypto: initRustCrypto never sets client.crypto
            start();

            await widgetSendsToDevice("req-off", true);

            expect(driverSend).toHaveBeenCalledTimes(1); // the stock driver ran and threw a TypeError
            const replies = answers("req-off");
            expect(replies).toHaveLength(1);
            expect(replies[0].response).toEqual({ error: { message: "Error sending event" } });
            expect(replies[0].response.error.message).not.toContain("not supported");
        });

        it("flag on, Rust crypto: the encrypted send is answered 'not supported' once and the driver is not run", async () => {
            configureClariva({ features: { calls: true } });
            (client as any).crypto = undefined;
            start();

            await widgetSendsToDevice("req-on", true);

            expect(driverSend).not.toHaveBeenCalled();
            const replies = answers("req-on");
            expect(replies).toHaveLength(1);
            expect(replies[0].response).toEqual({ error: { message: ENCRYPTED_TO_DEVICE_UNSUPPORTED_MESSAGE } });
            expect(replies[0].response.error.message).toContain("not supported"); // what makes EC switch transports
            expect(replies[0].action).toBe("send_to_device");
        });

        it("flag on, legacy crypto present: the stock driver handles the encrypted send", async () => {
            configureClariva({ features: { calls: true } });
            expect((client as any).crypto).toBeDefined(); // the shared stub models a legacy-crypto client
            driverSend.mockResolvedValue(undefined);
            start();

            await widgetSendsToDevice("req-legacy", true);

            expect(driverSend).toHaveBeenCalledWith(TYPE, true, expect.any(Object));
            const replies = answers("req-legacy");
            expect(replies).toHaveLength(1);
            expect(replies[0].response).toEqual({});
        });

        it("flag on, unencrypted send: the stock driver handles it even without client.crypto", async () => {
            configureClariva({ features: { calls: true } });
            (client as any).crypto = undefined;
            driverSend.mockResolvedValue(undefined);
            start();

            await widgetSendsToDevice("req-plain", false);

            expect(driverSend).toHaveBeenCalledWith(TYPE, false, expect.any(Object));
            const replies = answers("req-plain");
            expect(replies).toHaveLength(1);
            expect(replies[0].response).toEqual({});
        });
    });
});
