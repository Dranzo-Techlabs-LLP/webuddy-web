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

import { SyncState } from "matrix-js-sdk/src/matrix";

import Notifier from "../../src/Notifier";
import SdkConfig from "../../src/SdkConfig";
import { BackgroundAudio } from "../../src/audio/BackgroundAudio";
import { createAudioContext } from "../../src/audio/compat";
import { isRingSoundBlocked, setRingSoundBlocked, subscribeRingSoundBlocked } from "../../src/clariva/calls/callAudio";
import { closeCallNotification, isTabInBackground, showCallNotification } from "../../src/clariva/calls/desktopNotify";
import { CLOCK_SKEW_SLACK_MS, type LiveMembership, isUserAnsweringRing } from "../../src/clariva/calls/memberships";
import { nextSyncGate } from "../../src/clariva/calls/syncGate";
import { TITLE_FLASH_INTERVAL_MS, TitleFlasher, prefersReducedMotion } from "../../src/clariva/calls/titleFlash";

// Element's notification settings: the desktop-notifications switch and "show message content" (the real Notifier
// pulls in half of the app). desktopNotify reads them when a notification is about to be shown.
jest.mock("../../src/Notifier", () => ({
    __esModule: true,
    default: { isEnabled: jest.fn(() => true), isBodyEnabled: jest.fn(() => true) },
}));
// WebAudio does not exist in jsdom.
jest.mock("../../src/audio/compat", () => ({ createAudioContext: jest.fn() }));

/** The pieces of the receiving path that need no Matrix client: sync gate, answer detection, title, notification rules. */

describe("nextSyncGate (are timeline events live?)", () => {
    it("opens on every state in which a response may be delivered live", () => {
        for (const state of [SyncState.Syncing, SyncState.Prepared, SyncState.Catchup, SyncState.Reconnecting]) {
            expect(nextSyncGate(false, state)).toBe(true);
        }
    });

    it("closes only on Stopped", () => {
        expect(nextSyncGate(true, SyncState.Stopped)).toBe(false);
        expect(nextSyncGate(false, SyncState.Stopped)).toBe(false);
    });

    it("Error changes nothing: the response that recovers from an error is handled while the state is still Error", () => {
        expect(nextSyncGate(true, SyncState.Error)).toBe(true);
        // ...but it cannot open a gate that was never opened (an error during the initial load)
        expect(nextSyncGate(false, SyncState.Error)).toBe(false);
    });

    it("keeps its value for no state yet", () => {
        expect(nextSyncGate(false, null)).toBe(false);
        expect(nextSyncGate(true, null)).toBe(true);
        expect(nextSyncGate(true, undefined)).toBe(true);
    });

    it("a hiccup (Syncing -> Reconnecting -> Error -> Catchup -> Syncing) never closes it", () => {
        let open = false;
        const seen: boolean[] = [];
        for (const state of [
            SyncState.Prepared,
            SyncState.Syncing,
            SyncState.Reconnecting,
            SyncState.Error,
            SyncState.Catchup,
            SyncState.Syncing,
        ]) {
            open = nextSyncGate(open, state);
            seen.push(open);
        }
        expect(seen).toEqual([true, true, true, true, true, true]);
    });
});

describe("isUserAnsweringRing (has another device of mine answered this ring?)", () => {
    const NOW = 1_760_000_000_000;
    const ME = "@asha:clarivahub.com";
    const RING_TS = NOW - 2_000;

    const membership = (over: Partial<LiveMembership> = {}): LiveMembership => ({
        sender: ME,
        deviceId: "DEV",
        stateKey: `_${ME}_DEV_m.call`,
        createdTs: NOW,
        expiresAt: NOW + 7_200_000,
        media: null,
        ...over,
    });

    it("counts a live membership created after the ring", () => {
        expect(isUserAnsweringRing([membership()], ME, RING_TS, NOW)).toBe(true);
    });

    it("does not count one created before the ring: that is what a crashed tab leaves behind", () => {
        expect(isUserAnsweringRing([membership({ createdTs: NOW - 3_600_000 })], ME, RING_TS, NOW)).toBe(false);
    });

    it("forgives clock skew up to the slack, no more", () => {
        const slightlyBefore = membership({ createdTs: RING_TS - CLOCK_SKEW_SLACK_MS });
        const wellBefore = membership({ createdTs: RING_TS - CLOCK_SKEW_SLACK_MS - 1 });
        expect(isUserAnsweringRing([slightlyBefore], ME, RING_TS, NOW)).toBe(true);
        expect(isUserAnsweringRing([wellBefore], ME, RING_TS, NOW)).toBe(false);
    });

    it("does not count an expired membership, however new it is", () => {
        expect(isUserAnsweringRing([membership({ expiresAt: NOW })], ME, RING_TS, NOW)).toBe(false);
        expect(isUserAnsweringRing([membership({ expiresAt: NOW + 1 })], ME, RING_TS, NOW)).toBe(true);
    });

    it("only counts my own memberships", () => {
        expect(isUserAnsweringRing([membership({ sender: "@rao:clarivahub.com" })], ME, RING_TS, NOW)).toBe(false);
        expect(isUserAnsweringRing([], ME, RING_TS, NOW)).toBe(false);
    });

    it("one fresh device among stale ones is enough", () => {
        const stale = membership({ createdTs: NOW - 3_600_000, deviceId: "OLD" });
        expect(isUserAnsweringRing([stale, membership()], ME, RING_TS, NOW)).toBe(true);
    });
});

describe("TitleFlasher", () => {
    const prefix = (): string => "(Incoming call) ";

    beforeEach(() => {
        jest.useFakeTimers();
        document.title = "Clariva";
    });

    afterEach(() => {
        jest.useRealTimers();
        document.title = "";
    });

    it("shows the prefixed title at once and alternates with the plain one", () => {
        const flasher = new TitleFlasher(prefix);
        flasher.start();
        expect(flasher.active).toBe(true);
        expect(document.title).toBe("(Incoming call) Clariva");
        jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
        expect(document.title).toBe("Clariva");
        jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
        expect(document.title).toBe("(Incoming call) Clariva");
        flasher.stop();
    });

    it("stop() restores the original title whatever phase it is in, and clears its timer", () => {
        const flasher = new TitleFlasher(prefix);
        flasher.start();
        flasher.stop();
        expect(document.title).toBe("Clariva");
        expect(flasher.active).toBe(false);
        expect(jest.getTimerCount()).toBe(0);

        flasher.start();
        jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
        flasher.stop();
        expect(document.title).toBe("Clariva");
    });

    it("restores the last title Element set while flashing (unread count), not the one from the start", () => {
        const flasher = new TitleFlasher(prefix);
        flasher.start();
        document.title = "Clariva [2]"; // Element rewrote it while the prefixed form was showing
        flasher.stop();
        expect(document.title).toBe("Clariva [2]");

        flasher.start();
        jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS); // plain phase
        document.title = "Clariva [5] | Dr Rao";
        jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS); // next flash picks the new title up
        expect(document.title).toBe("(Incoming call) Clariva [5] | Dr Rao");
        flasher.stop();
        expect(document.title).toBe("Clariva [5] | Dr Rao");
    });

    it("never mistakes its own write for Element's when document.title normalises whitespace", () => {
        document.title = "  Clariva   chats ";
        const flasher = new TitleFlasher(() => "(Incoming   call) "); // the getter collapses the double spaces
        flasher.start();
        expect(document.title).toBe("(Incoming call) Clariva chats");
        for (let i = 0; i < 6; i++) jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
        expect(document.title).not.toContain("call) (Incoming");
        flasher.stop();
        expect(document.title).toBe("Clariva chats"); // what document.title reports for the original
    });

    describe("with prefers-reduced-motion", () => {
        it("keeps the prefix for as long as it rings instead of alternating", () => {
            const flasher = new TitleFlasher(prefix, TITLE_FLASH_INTERVAL_MS, () => true);
            flasher.start();
            expect(document.title).toBe("(Incoming call) Clariva");
            for (let i = 0; i < 5; i++) {
                jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
                expect(document.title).toBe("(Incoming call) Clariva");
            }
            flasher.stop();
            expect(document.title).toBe("Clariva");
            expect(jest.getTimerCount()).toBe(0);
        });

        it("puts the prefix back when Element rewrites the title, and restores that title on stop", () => {
            const flasher = new TitleFlasher(prefix, TITLE_FLASH_INTERVAL_MS, () => true);
            flasher.start();
            document.title = "Clariva [2]"; // an unread count, without our prefix
            jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
            expect(document.title).toBe("(Incoming call) Clariva [2]");
            flasher.stop();
            expect(document.title).toBe("Clariva [2]");
        });

        it("is read on every tick: turning the setting on while it flashes stops the flashing at the prefixed form", () => {
            let reduced = false;
            const flasher = new TitleFlasher(prefix, TITLE_FLASH_INTERVAL_MS, () => reduced);
            flasher.start();
            jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
            expect(document.title).toBe("Clariva"); // plain phase of the alternation
            reduced = true;
            jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
            expect(document.title).toBe("(Incoming call) Clariva");
            jest.advanceTimersByTime(TITLE_FLASH_INTERVAL_MS);
            expect(document.title).toBe("(Incoming call) Clariva");
            flasher.stop();
        });

        it("prefersReducedMotion() reads the media query, and is false where there is no matchMedia", () => {
            const original = window.matchMedia;
            try {
                window.matchMedia = jest.fn((query: string) => ({ matches: query.includes("reduce") })) as any;
                expect(prefersReducedMotion()).toBe(true);
                expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");

                window.matchMedia = jest.fn(() => ({ matches: false })) as any;
                expect(prefersReducedMotion()).toBe(false);

                window.matchMedia = jest.fn(() => {
                    throw new Error("nope");
                }) as any;
                expect(prefersReducedMotion()).toBe(false);

                (window as any).matchMedia = undefined;
                expect(prefersReducedMotion()).toBe(false);
            } finally {
                window.matchMedia = original;
            }
        });
    });

    it("start() twice and stop() without start() are harmless", () => {
        const flasher = new TitleFlasher(prefix);
        flasher.stop();
        expect(document.title).toBe("Clariva");
        flasher.start();
        flasher.start();
        expect(jest.getTimerCount()).toBe(1);
        flasher.stop();
        expect(document.title).toBe("Clariva");
    });
});

describe("browser call notifications (desktopNotify)", () => {
    const created: Array<{ title: string; options: NotificationOptions; close: jest.Mock }> = [];
    let permission: NotificationPermission;
    let hidden: boolean;
    let focused: boolean;

    beforeEach(() => {
        created.length = 0;
        permission = "granted";
        hidden = false;
        focused = true;
        jest.mocked(Notifier.isEnabled).mockReturnValue(true);
        jest.mocked(Notifier.isBodyEnabled).mockReturnValue(true);
        jest.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
        jest.spyOn(document, "hasFocus").mockImplementation(() => focused);
        const NotificationMock = jest.fn(function (this: any, title: string, options: NotificationOptions) {
            this.close = jest.fn();
            created.push({ title, options, close: this.close });
        });
        // a live getter: Object.assign would copy the value it has right now
        Object.defineProperty(NotificationMock, "permission", { get: () => permission });
        (global as any).Notification = NotificationMock;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete (global as any).Notification;
    });

    const ring = (tag = "clariva_ring_$a"): void =>
        showCallNotification({ title: "Dr Rao", body: "Incoming voice call", tag, sticky: true });

    it("a visible, focused tab gets no notification: the toast is right there", () => {
        ring();
        expect(created).toHaveLength(0);
        expect(isTabInBackground()).toBe(false);
    });

    it("a hidden tab does", () => {
        hidden = true;
        ring();
        expect(created).toHaveLength(1);
        expect(created[0].title).toBe("Dr Rao");
        expect(created[0].options).toMatchObject({ body: "Incoming voice call", tag: "clariva_ring_$a" });
        expect(created[0].options.requireInteraction).toBe(true);
    });

    it("so does a visible tab that does not have focus (a window behind another one)", () => {
        focused = false;
        expect(isTabInBackground()).toBe(true);
        ring();
        expect(created).toHaveLength(1);
    });

    it("never without permission, and it never asks for it", () => {
        hidden = true;
        focused = false;
        permission = "default";
        ring();
        permission = "denied";
        ring();
        expect(created).toHaveLength(0);
        expect((global as any).Notification.requestPermission).toBeUndefined();
    });

    it("a notification with the same tag replaces the previous one, and closeCallNotification closes it", () => {
        hidden = true;
        ring("t");
        ring("t");
        expect(created[0].close).toHaveBeenCalledTimes(1); // the first one was closed for the second
        closeCallNotification("t");
        expect(created[1].close).toHaveBeenCalledTimes(1);
    });

    describe("always (a call the user never saw ring)", () => {
        const missed = (): void =>
            showCallNotification({ title: "Dr Rao", body: "Missed call", tag: "clariva_missed_!r", always: true });

        it("is shown even in a visible, focused tab: a consultant on a web call keeps the focus inside the call frame", () => {
            missed();
            expect(created).toHaveLength(1);
            expect(created[0].options).toMatchObject({ body: "Missed call", tag: "clariva_missed_!r" });
            expect(created[0].options.requireInteraction).toBe(false);
        });

        it("a notification without it still waits for the tab to be in the background", () => {
            showCallNotification({ title: "Dr Rao", body: "Missed call", tag: "t" });
            showCallNotification({ title: "Dr Rao", body: "Missed call", tag: "t", always: false });
            expect(created).toHaveLength(0);
        });

        it("still needs the browser permission", () => {
            permission = "default";
            missed();
            permission = "denied";
            missed();
            expect(created).toHaveLength(0);
        });

        it("still needs Element's desktop-notifications setting", () => {
            jest.mocked(Notifier.isEnabled).mockReturnValue(false);
            missed();
            expect(created).toHaveLength(0);
        });
    });

    describe("Element's notification settings", () => {
        it("nothing is shown while desktop notifications are switched off, hidden tab and permission or not", () => {
            hidden = true;
            focused = false;
            jest.mocked(Notifier.isEnabled).mockReturnValue(false);
            ring();
            expect(created).toHaveLength(0);

            jest.mocked(Notifier.isEnabled).mockReturnValue(true);
            ring();
            expect(created).toHaveLength(1);
        });

        it("a Notifier that cannot answer counts as switched off", () => {
            hidden = true;
            jest.mocked(Notifier.isEnabled).mockImplementation(() => {
                throw new Error("no platform");
            });
            ring();
            expect(created).toHaveLength(0);
        });

        it("with message content allowed the title is the caller", () => {
            hidden = true;
            showCallNotification({ title: "Dr Rao", body: "Incoming voice call", tag: "t" });
            expect(created[0].title).toBe("Dr Rao");
        });

        it("with message content switched off the title is the brand, never the caller's name or Matrix id", () => {
            hidden = true;
            jest.mocked(Notifier.isBodyEnabled).mockReturnValue(false);
            showCallNotification({ title: "Dr Rao", body: "Incoming voice call", tag: "a" });
            showCallNotification({ title: "@rao:clarivahub.com", body: "Missed call", tag: "b", always: true });
            expect(created.map((n) => n.title)).toEqual(["Clariva", "Clariva"]);
            expect(created.map((n) => n.title)).toEqual([SdkConfig.get("brand"), SdkConfig.get("brand")]);
            // what the notification is still says so: only the caller is held back
            expect(created.map((n) => n.options.body)).toEqual(["Incoming voice call", "Missed call"]);
        });

        it("a Notifier that cannot tell about the body setting does not leak the caller either", () => {
            hidden = true;
            jest.mocked(Notifier.isBodyEnabled).mockImplementation(() => {
                throw new Error("no platform");
            });
            showCallNotification({ title: "Dr Rao", body: "Incoming voice call", tag: "t" });
            expect(created[0].title).toBe("Clariva");
        });

        it("the brand follows the configuration", () => {
            hidden = true;
            jest.mocked(Notifier.isBodyEnabled).mockReturnValue(false);
            SdkConfig.add({ brand: "Dr Rao Clinic" });
            try {
                showCallNotification({ title: "Dr Rao", body: "Incoming voice call", tag: "t" });
                expect(created[0].title).toBe("Dr Rao Clinic");
            } finally {
                SdkConfig.reset();
            }
        });
    });

    it("a browser without hasFocus() still works on visibility alone", () => {
        (document as any).hasFocus = undefined;
        hidden = true;
        ring();
        expect(created).toHaveLength(1);
        hidden = false;
        expect(isTabInBackground()).toBe(false);
    });
});

describe("the ring-sound hint flag", () => {
    afterEach(() => setRingSoundBlocked(false));

    it("starts false, notifies subscribers only on real changes and stops notifying after unsubscribe", () => {
        const listener = jest.fn();
        const unsubscribe = subscribeRingSoundBlocked(listener);
        expect(isRingSoundBlocked()).toBe(false);

        setRingSoundBlocked(false);
        expect(listener).not.toHaveBeenCalled();
        setRingSoundBlocked(true);
        setRingSoundBlocked(true);
        expect(isRingSoundBlocked()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        setRingSoundBlocked(false);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe("BackgroundAudio (the ringtone's AudioContext)", () => {
    const makeContext = (state: string) => ({
        state,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    });

    it("reports a context that is not running as blocked", () => {
        const context = makeContext("suspended");
        jest.mocked(createAudioContext).mockReturnValue(context as any);
        const audio = new BackgroundAudio();
        expect(audio.isBlocked).toBe(true);
        context.state = "running";
        expect(audio.isBlocked).toBe(false);
    });

    it("onStateChange follows the context's statechange event until it is unsubscribed", () => {
        const context = makeContext("suspended");
        jest.mocked(createAudioContext).mockReturnValue(context as any);
        const audio = new BackgroundAudio();
        const listener = jest.fn();

        const unsubscribe = audio.onStateChange(listener);
        expect(context.addEventListener).toHaveBeenCalledWith("statechange", listener);
        expect(context.removeEventListener).not.toHaveBeenCalled();

        unsubscribe();
        expect(context.removeEventListener).toHaveBeenCalledWith("statechange", listener);
    });
});
