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

import Notifier from "../../Notifier";
import SdkConfig from "../../SdkConfig";

/**
 * Browser notifications for rings and missed calls while the tab is in the background (Android shows a heads-up call
 * notification; the web has no push, so this works only while a tab is open). "In the background" means hidden OR not
 * focused: a visible tab in a window that is behind another one (or whose focus is in another window) is just as easy
 * to miss. It never asks for permission: Element's own notification toast does that. Without permission the in-app
 * toast, the ringtone and the flashing page title still work.
 *
 * It follows the user's notification settings like every other Element notification: nothing at all unless desktop
 * notifications are enabled (`Notifier.isEnabled()`, which also covers the browser permission), and when the user
 * keeps message content out of notifications (`Notifier.isBodyEnabled()` is false) the title is the brand name, not
 * the caller's name or Matrix id.
 *
 * (`Notifier` imports the call runtime, which imports this file: the import cycle is harmless, `Notifier` is only
 * touched when a notification is about to be shown.)
 */

export interface CallNotificationOptions {
    title: string;
    body: string;
    /** Same tag = replaces the previous notification (a missed call replaces its ring). */
    tag: string;
    /** Keep the notification until the user acts (rings). */
    sticky?: boolean;
    /**
     * Show it even when the tab is in the foreground. For a call the user never saw ring: a consultant on a web call
     * keeps the focus inside the Element Call iframe, so "visible and focused" does not mean they saw anything. The
     * permission and the Notifier setting are still required.
     */
    always?: boolean;
    onClick?: () => void;
}

const open = new Map<string, Notification>();

/** Is the tab out of the user's sight: hidden, or visible but without focus? */
export function isTabInBackground(): boolean {
    if (typeof document === "undefined") return false;
    return document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus());
}

/** Has the user turned desktop notifications on (setting + browser permission)? Never throws. */
function notificationsEnabled(): boolean {
    try {
        return Notifier.isEnabled();
    } catch (e) {
        logger.debug("Clariva calls: could not read the notification setting", e);
        return false;
    }
}

function canNotify(always: boolean): boolean {
    return (
        (always || isTabInBackground()) &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        notificationsEnabled()
    );
}

/** The caller's name, or the brand when the user keeps message content out of notifications. */
function visibleTitle(title: string): string {
    try {
        if (Notifier.isBodyEnabled()) return title;
    } catch (e) {
        logger.debug("Clariva calls: could not read the notification body setting", e);
    }
    return SdkConfig.get("brand");
}

/**
 * Show a notification if the user wants them (setting + permission) and the tab is in the background (hidden or
 * unfocused), or `options.always` is set.
 */
export function showCallNotification(options: CallNotificationOptions): void {
    if (!canNotify(options.always ?? false)) return;
    try {
        open.get(options.tag)?.close();
        const notification = new Notification(visibleTitle(options.title), {
            body: options.body,
            tag: options.tag,
            requireInteraction: options.sticky ?? false,
        });
        notification.onclick = (): void => {
            window.focus();
            options.onClick?.();
            notification.close();
        };
        notification.onclose = (): void => {
            if (open.get(options.tag) === notification) open.delete(options.tag);
        };
        open.set(options.tag, notification);
    } catch (e) {
        logger.debug("Clariva calls: could not show a browser notification", e);
    }
}

/** Close a notification, e.g. when the ring ended. */
export function closeCallNotification(tag: string): void {
    open.get(tag)?.close();
    open.delete(tag);
}
