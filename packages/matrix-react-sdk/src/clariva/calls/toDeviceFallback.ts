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

import { logger } from "matrix-js-sdk/src/logger";
import { MatrixClient } from "matrix-js-sdk/src/matrix";
import { ClientWidgetApi, ISendToDeviceFromWidgetActionRequest, WidgetApiFromWidgetAction } from "matrix-widget-api";

import { isClarivaCallsEnabled } from "./config";

/**
 * Element Call 0.16.3 sends its end-to-end media keys as ENCRYPTED to-device messages by default. Element Web 3.108's
 * `StopGapWidgetDriver.sendToDevice(encrypted = true)` encrypts through the legacy `client.crypto.deviceList`, which
 * the Rust crypto stack Clariva Web runs on never sets up: the driver throws a `TypeError`, `matrix-widget-api` turns
 * that into the generic reply `{ error: { message: "Error sending event" } }`, and EC swallows that error as if the
 * keys had been sent. The call then connects, the web hears the other side, but nobody receives the web's keys:
 * one-way media.
 *
 * EC switches to its ROOM-EVENT key transport (`io.element.call.encryption_keys`, which the capability set in
 * `capabilities.ts` already permits) only when the reply message contains "not supported" (or contains both
 * "unknown variant" and "send_to_device"). So the host must answer that way, honestly, when it cannot do the encrypted
 * send. This module installs that answer as a listener on the widget messaging; it runs before the widget API's own
 * default handling and `preventDefault()`s it, the same pattern `StopGapWidget` already uses for
 * `update_always_on_screen`.
 *
 * Kept out of `StopGapWidget.ts` so the upstream file only carries a one-line, flag-guarded call.
 */

/** Must contain "not supported": that substring is what makes Element Call fall back to room-event key transport. */
export const ENCRYPTED_TO_DEVICE_UNSUPPORTED_MESSAGE = "Encrypted to-device messages are not supported by this client";

/** The part of `ClientWidgetApi` the listener needs (so tests can pass a plain object). */
export type ToDeviceReplyTarget = Pick<ClientWidgetApi, "transport">;

export type SendToDeviceListener = (ev: CustomEvent<ISendToDeviceFromWidgetActionRequest>) => void;

/**
 * The listener for `action:send_to_device`. For an encrypted request on a client without the legacy crypto the
 * driver needs: stop the default handling and reply once with the "not supported" error. Everything else (unencrypted
 * requests, a client that does have `client.crypto`, malformed events) is left untouched for the stock handler.
 */
export function createEncryptedToDeviceFallback(
    messaging: ToDeviceReplyTarget,
    hasLegacyCrypto: () => boolean,
): SendToDeviceListener {
    return (ev) => {
        if (ev.detail?.data?.encrypted !== true || hasLegacyCrypto()) return;
        // Stop the widget API from running the driver, which would throw and reply "Error sending event".
        ev.preventDefault();
        logger.info(
            `Clariva calls: encrypted to-device send of ${ev.detail.data.type} is not supported (Rust crypto); ` +
                "the widget falls back to room-event key transport",
        );
        messaging.transport.reply(ev.detail, { error: { message: ENCRYPTED_TO_DEVICE_UNSUPPORTED_MESSAGE } });
    };
}

/**
 * Register the fallback on a widget's messaging. A no-op (and returns false) unless Clariva calls are enabled, so with
 * the flag off the widget host behaves exactly like stock Element Web. Returns whether the listener was registered.
 */
export function registerEncryptedToDeviceFallback(
    messaging: ClientWidgetApi,
    client: Pick<MatrixClient, "crypto">,
): boolean {
    if (!isClarivaCallsEnabled()) return false;
    messaging.on(
        `action:${WidgetApiFromWidgetAction.SendToDevice}`,
        createEncryptedToDeviceFallback(messaging, () => !!client.crypto),
    );
    return true;
}
