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

import {
    currentOrigin,
    GIS_SCRIPT_URL,
    GoogleUnavailableError,
    isDevOrigin,
    isGoogleSignInConfigured,
    loadGoogleIdentity,
    originsToAuthorise,
    RENDER_TIMEOUT_MS,
    renderGoogleButton,
    resetGoogleIdentityForTests,
    SCRIPT_TIMEOUT_MS,
} from "../../src/clariva/session/googleIdentity";
import { configureClariva } from "./helpers";

/**
 * Tests the REAL googleIdentity module (the component suites mock it). jsdom never loads external scripts, so the test
 * plays Google's part: it captures the appended <script>, fires its load / error events by hand and installs a fake
 * `window.google.accounts.id`.
 */

const CLIENT_ID = "client-id.apps.googleusercontent.com";

interface FakeGis {
    initialize: jest.Mock;
    renderButton: jest.Mock;
    disableAutoSelect: jest.Mock;
}

/** Google's `google.accounts.id`: renderButton draws one element into the host it is given, like the real one. */
function makeFakeGis(): FakeGis {
    return {
        initialize: jest.fn(),
        renderButton: jest.fn((host: HTMLElement) => {
            const button = document.createElement("div");
            button.className = "fake-gsi-button";
            host.appendChild(button);
        }),
        disableAutoSelect: jest.fn(),
    };
}

/** The script finished downloading: Google's code runs (defines `window.google`) and the load event fires. */
function installGis(gis: FakeGis): void {
    (window as unknown as { google?: unknown }).google = { accounts: { id: gis } };
}

const scripts = (): HTMLScriptElement[] =>
    Array.from(document.querySelectorAll<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`));

function loadScript(script: HTMLScriptElement): void {
    script.dispatchEvent(new Event("load"));
}

function failScript(script: HTMLScriptElement): void {
    script.dispatchEvent(new Event("error"));
}

/** The callback the module registered with `google.accounts.id.initialize` (GIS has exactly one, global). */
function gisCallback(gis: FakeGis): (response: { credential?: string }) => void {
    return gis.initialize.mock.calls[0][0].callback;
}

const hosts = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(".mx_ClarivaAuth_googleHost"));

/** Let promise continuations (and jsdom's promise-based MutationObserver delivery) run. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

function containerOfWidth(clientWidth: number): HTMLElement {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: clientWidth, configurable: true });
    document.body.appendChild(container);
    return container;
}

describe("googleIdentity (real module)", () => {
    let container: HTMLElement;

    beforeEach(() => {
        configureClariva({ google_client_id: CLIENT_ID });
        resetGoogleIdentityForTests();
        container = document.createElement("div");
        document.body.appendChild(container);
        jest.spyOn(logger, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        resetGoogleIdentityForTests(); // before the timers go back to real ones: it clears the load timer
        jest.useRealTimers();
        jest.restoreAllMocks();
        document.body.innerHTML = "";
    });

    describe("loadGoogleIdentity", () => {
        it("appends ONE script for concurrent callers and resolves them all with the same API on load", async () => {
            const first = loadGoogleIdentity();
            const second = loadGoogleIdentity();
            const third = renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
            expect(scripts()).toHaveLength(1);
            expect(scripts()[0].async).toBe(true);

            const gis = makeFakeGis();
            installGis(gis);
            loadScript(scripts()[0]);

            await expect(first).resolves.toBe(gis);
            await expect(second).resolves.toBe(gis);
            await third;
            expect(gis.renderButton).toHaveBeenCalledTimes(1);
            expect(scripts()).toHaveLength(1);
        });

        it("takes the fast path (no <script>) when Google is already there", async () => {
            const gis = makeFakeGis();
            installGis(gis);
            await expect(loadGoogleIdentity()).resolves.toBe(gis);
            expect(scripts()).toHaveLength(0);
        });

        it("a load event without window.google counts as blocked, not as success", async () => {
            const attempt = loadGoogleIdentity().catch((e: unknown) => e);
            loadScript(scripts()[0]); // the script ran but defined nothing (e.g. an extension replaced it)
            const error = await attempt;
            expect(error).toBeInstanceOf(GoogleUnavailableError);
            expect((error as GoogleUnavailableError).reason).toBe("script_blocked");
            expect(scripts()).toHaveLength(0);
        });

        it("an error event rejects with script_blocked, removes the tag, and a retry appends a fresh one", async () => {
            const attempt = loadGoogleIdentity().catch((e: unknown) => e);
            const firstTag = scripts()[0];
            failScript(firstTag);

            const error = await attempt;
            expect(error).toBeInstanceOf(GoogleUnavailableError);
            expect((error as GoogleUnavailableError).reason).toBe("script_blocked");
            expect(error).toBeInstanceOf(Error);
            expect(scripts()).toHaveLength(0); // no failed tags pile up

            const retry = loadGoogleIdentity();
            expect(scripts()).toHaveLength(1);
            expect(scripts()[0]).not.toBe(firstTag);
            const gis = makeFakeGis();
            installGis(gis);
            loadScript(scripts()[0]);
            await expect(retry).resolves.toBe(gis);
        });

        it("gives up after 10 s with script_timeout; a LATE load still recovers through window.google", async () => {
            jest.useFakeTimers();
            let outcome: unknown;
            loadGoogleIdentity().then(
                (api) => (outcome = api),
                (e: unknown) => (outcome = e),
            );
            const tag = scripts()[0];

            jest.advanceTimersByTime(SCRIPT_TIMEOUT_MS - 1);
            await flush();
            expect(outcome).toBeUndefined(); // still waiting

            jest.advanceTimersByTime(1);
            await flush();
            expect(outcome).toBeInstanceOf(GoogleUnavailableError);
            expect((outcome as GoogleUnavailableError).reason).toBe("script_timeout");
            expect(scripts()).toHaveLength(0);

            // the slow download finally lands: its load event is ignored, but Google's code defined window.google
            const gis = makeFakeGis();
            installGis(gis);
            loadScript(tag);
            await flush();
            expect(outcome).toBeInstanceOf(GoogleUnavailableError); // the settled attempt is not rewritten

            await expect(loadGoogleIdentity()).resolves.toBe(gis);
            expect(scripts()).toHaveLength(0); // recovered without another download
        });

        it("a timed-out attempt is forgotten: the next call starts a clean download", async () => {
            jest.useFakeTimers();
            const first = loadGoogleIdentity().catch((e: unknown) => e);
            jest.advanceTimersByTime(SCRIPT_TIMEOUT_MS);
            expect(await first).toBeInstanceOf(GoogleUnavailableError);

            const second = loadGoogleIdentity();
            expect(scripts()).toHaveLength(1);
            const gis = makeFakeGis();
            installGis(gis);
            loadScript(scripts()[0]);
            await expect(second).resolves.toBe(gis);
        });

        it("a successful load cancels the timeout", async () => {
            jest.useFakeTimers();
            const attempt = loadGoogleIdentity();
            const gis = makeFakeGis();
            installGis(gis);
            loadScript(scripts()[0]);
            await expect(attempt).resolves.toBe(gis);
            expect(jest.getTimerCount()).toBe(0);
        });

        it("resetGoogleIdentityForTests removes the tags, window.google and the pending attempt", async () => {
            void loadGoogleIdentity(); // abandoned by the reset below: never settles, so it is not awaited
            expect(scripts()).toHaveLength(1);
            installGis(makeFakeGis());
            resetGoogleIdentityForTests();
            expect(scripts()).toHaveLength(0);
            expect((window as unknown as { google?: unknown }).google).toBeUndefined();

            // starts over instead of joining the forgotten attempt
            const fresh = loadGoogleIdentity().catch((e: unknown) => e);
            expect(scripts()).toHaveLength(1);
            failScript(scripts()[0]);
            expect(await fresh).toBeInstanceOf(GoogleUnavailableError);
        });
    });

    describe("renderGoogleButton", () => {
        let gis: FakeGis;

        beforeEach(() => {
            gis = makeFakeGis();
            installGis(gis);
        });

        it("rejects when no client id is configured, without touching the page", async () => {
            resetGoogleIdentityForTests();
            configureClariva(); // no google_client_id
            const error = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() }).catch(
                (e: unknown) => e,
            );
            expect(error).toBeInstanceOf(GoogleUnavailableError);
            expect((error as GoogleUnavailableError).reason).toBe("render_failed");
            expect(scripts()).toHaveLength(0);
            expect(container.childElementCount).toBe(0);
        });

        it("initialises Google ONCE across renders: popup mode, no auto select, the configured client id", async () => {
            await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
            await renderGoogleButton(container, { text: "signup_with", onCredential: jest.fn() });
            await renderGoogleButton(containerOfWidth(300), { text: "continue_with", onCredential: jest.fn() });

            expect(gis.initialize).toHaveBeenCalledTimes(1);
            expect(gis.initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    // eslint-disable-next-line camelcase
                    client_id: CLIENT_ID,
                    // eslint-disable-next-line camelcase
                    auto_select: false,
                    // eslint-disable-next-line camelcase
                    ux_mode: "popup",
                    callback: expect.any(Function),
                }),
            );
            // Android never auto-selects: every render also clears a remembered auto-select
            expect(gis.disableAutoSelect).toHaveBeenCalledTimes(3);
        });

        it("initialises again when a late GIS script REPLACED window.google.accounts.id after initialize() ran", async () => {
            jest.useFakeTimers();
            resetGoogleIdentityForTests();
            const lateGis = makeFakeGis();
            const retryGis = makeFakeGis();

            // 1. the first download hangs: the attempt times out and its tag is removed, but the download goes on
            const timedOut = loadGoogleIdentity().catch((e: unknown) => e);
            const firstTag = scripts()[0];
            jest.advanceTimersByTime(SCRIPT_TIMEOUT_MS);
            expect(await timedOut).toBeInstanceOf(GoogleUnavailableError);

            // 2. Try again: a clean download that arrives first, and the button is initialised on THAT object
            const retried = renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
            expect(scripts()).toHaveLength(1);
            installGis(retryGis);
            loadScript(scripts()[0]);
            await retried;
            expect(retryGis.initialize).toHaveBeenCalledTimes(1);

            // 3. the slow first download lands now and redefines window.google with a fresh, uninitialised object
            installGis(lateGis);
            loadScript(firstTag);

            // 4. the next render must initialise the object that is current, not trust the one it initialised before
            await renderGoogleButton(container, { text: "signup_with", onCredential: jest.fn() });
            expect(lateGis.initialize).toHaveBeenCalledTimes(1);
            expect(lateGis.initialize).toHaveBeenCalledWith(
                // eslint-disable-next-line camelcase
                expect.objectContaining({ client_id: CLIENT_ID, ux_mode: "popup", callback: expect.any(Function) }),
            );
            expect(lateGis.renderButton).toHaveBeenCalledTimes(1);
            expect(retryGis.renderButton).toHaveBeenCalledTimes(1); // the first render only
            expect(retryGis.initialize).toHaveBeenCalledTimes(1); // and the replaced object is not touched again

            // 5. and once the current object is initialised it is not initialised again
            await renderGoogleButton(container, { text: "continue_with", onCredential: jest.fn() });
            expect(lateGis.initialize).toHaveBeenCalledTimes(1);
        });

        it("the callback registered on the replacement object still routes to the live handler", async () => {
            const first = gis;
            await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
            const replacement = makeFakeGis();
            installGis(replacement); // e.g. a late GIS script redefined window.google
            const onCredential = jest.fn();
            await renderGoogleButton(container, { text: "signup_with", onCredential });

            expect(first.initialize).toHaveBeenCalledTimes(1);
            expect(replacement.initialize).toHaveBeenCalledTimes(1);
            replacement.initialize.mock.calls[0][0].callback({ credential: "id-token" });
            expect(onCredential).toHaveBeenCalledWith("id-token");
        });

        it("initialises again when the client id changes", async () => {
            await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
            configureClariva({ google_client_id: "other-client.apps.googleusercontent.com" });
            await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
            expect(gis.initialize).toHaveBeenCalledTimes(2);
            expect(gis.initialize.mock.calls[1][0].client_id).toBe("other-client.apps.googleusercontent.com");
        });

        it("passes the button text through and draws into its own host inside the container", async () => {
            await renderGoogleButton(container, { text: "signup_with", onCredential: jest.fn() });
            expect(gis.renderButton).toHaveBeenCalledTimes(1);
            const [host, options] = gis.renderButton.mock.calls[0];
            expect(options).toEqual(
                expect.objectContaining({ text: "signup_with", type: "standard", theme: "outline", size: "large" }),
            );
            expect(hosts(container)).toEqual([host]);
        });

        it.each([
            [0, 320], // jsdom / not laid out yet
            [120, 200], // narrower than Google's minimum
            [900, 400], // wider than Google's maximum
            [350, 350],
        ])("sizes the button from the container: clientWidth %s => width %s", async (clientWidth, expected) => {
            await renderGoogleButton(containerOfWidth(clientWidth), { text: "signin_with", onCredential: jest.fn() });
            expect(gis.renderButton.mock.calls[0][1].width).toBe(expected);
        });

        it.each([
            [250, 250],
            [150, 200],
            [999, 400],
        ])("an explicit width of %s is honoured and clamped to %s", async (width, expected) => {
            await renderGoogleButton(containerOfWidth(700), { text: "signin_with", onCredential: jest.fn(), width });
            expect(gis.renderButton.mock.calls[0][1].width).toBe(expected);
        });

        describe("credential routing", () => {
            it("goes to the latest render's onCredential only", async () => {
                const first = jest.fn();
                const second = jest.fn();
                await renderGoogleButton(container, { text: "signin_with", onCredential: first });
                await renderGoogleButton(container, { text: "signup_with", onCredential: second });

                gisCallback(gis)({ credential: "id-token" });
                expect(second).toHaveBeenCalledWith("id-token");
                expect(first).not.toHaveBeenCalled();
            });

            it("is dropped after dispose()", async () => {
                const onCredential = jest.fn();
                const rendered = await renderGoogleButton(container, { text: "signin_with", onCredential });
                rendered.dispose();
                gisCallback(gis)({ credential: "late-token" });
                expect(onCredential).not.toHaveBeenCalled();
            });

            it("a response without a credential is ignored (logged, never thrown)", async () => {
                const onCredential = jest.fn();
                await renderGoogleButton(container, { text: "signin_with", onCredential });
                expect(() => gisCallback(gis)({})).not.toThrow();
                expect(() => gisCallback(gis)({ credential: "" })).not.toThrow();
                expect(onCredential).not.toHaveBeenCalled();
                expect(logger.warn).toHaveBeenCalled();
            });
        });

        describe("overlapping renders into one container (stale dispose must not unplug the live button)", () => {
            it("a second render while the first still awaits the script leaves ONE live host and a working handler", async () => {
                gis = makeFakeGis();
                resetGoogleIdentityForTests(); // the script is NOT there yet
                const onFirst = jest.fn();
                const onSecond = jest.fn();

                const first = renderGoogleButton(container, { text: "signin_with", onCredential: onFirst });
                const second = renderGoogleButton(container, { text: "signup_with", onCredential: onSecond });
                expect(scripts()).toHaveLength(1);

                installGis(gis);
                loadScript(scripts()[0]);
                const [firstRendered, secondRendered] = await Promise.all([first, second]);

                // the stale (first) render is disposed, exactly like the component's effect cleanup does
                firstRendered.dispose();

                expect(hosts(container)).toHaveLength(1);
                expect(hosts(container)[0].querySelector(".fake-gsi-button")).not.toBeNull();
                gisCallback(gis)({ credential: "live-token" });
                expect(onSecond).toHaveBeenCalledWith("live-token");
                expect(onFirst).not.toHaveBeenCalled();

                // and the live one can still be torn down normally
                secondRendered.dispose();
                expect(hosts(container)).toHaveLength(0);
            });

            it("disposing the OLD render after the new one is up leaves the new host and handler alone", async () => {
                const onOld = jest.fn();
                const onNew = jest.fn();
                const old = await renderGoogleButton(container, { text: "signin_with", onCredential: onOld });
                await renderGoogleButton(container, { text: "signup_with", onCredential: onNew });
                const liveHost = hosts(container)[0];

                old.dispose();

                expect(hosts(container)).toEqual([liveHost]);
                gisCallback(gis)({ credential: "t" });
                expect(onNew).toHaveBeenCalledWith("t");
                expect(onOld).not.toHaveBeenCalled();
            });

            it("an aborted call that resolves AFTER the script loaded leaves the container and handler untouched", async () => {
                gis = makeFakeGis();
                resetGoogleIdentityForTests();
                const controller = new AbortController();
                const stale = renderGoogleButton(container, {
                    text: "signin_with",
                    onCredential: jest.fn(),
                    signal: controller.signal,
                });
                controller.abort(); // the component re-rendered before Google arrived
                installGis(gis);
                loadScript(scripts()[0]);

                const rendered = await stale;
                expect(gis.initialize).not.toHaveBeenCalled();
                expect(gis.renderButton).not.toHaveBeenCalled();
                expect(container.childElementCount).toBe(0);
                await expect(rendered.ready).resolves.toEqual({ ok: true });
                expect(() => rendered.dispose()).not.toThrow();
            });

            it("an abort that lands while another render is live touches neither its DOM nor its handler", async () => {
                const onLive = jest.fn();
                await renderGoogleButton(container, { text: "signin_with", onCredential: onLive });
                const liveHost = hosts(container)[0];

                const controller = new AbortController();
                const stale = renderGoogleButton(container, {
                    text: "signup_with",
                    onCredential: jest.fn(),
                    signal: controller.signal,
                });
                controller.abort(); // set before the await in renderGoogleButton resumes
                const rendered = await stale;
                rendered.dispose();

                expect(gis.renderButton).toHaveBeenCalledTimes(1);
                expect(hosts(container)).toEqual([liveHost]);
                gisCallback(gis)({ credential: "t" });
                expect(onLive).toHaveBeenCalledWith("t");
            });
        });

        describe("ready (did Google actually draw something?)", () => {
            it("is { ok: true } when renderButton puts an element into the host", async () => {
                const rendered = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
                await expect(rendered.ready).resolves.toEqual({ ok: true });
            });

            it("is { ok: true } when Google draws a moment later (asynchronously)", async () => {
                jest.useFakeTimers();
                gis.renderButton.mockImplementation(() => {}); // draws nothing yet
                const rendered = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
                let outcome: unknown;
                void rendered.ready.then((o) => (outcome = o));

                jest.advanceTimersByTime(1500);
                await flush();
                expect(outcome).toBeUndefined();

                hosts(container)[0].appendChild(document.createElement("iframe"));
                await flush();
                expect(outcome).toEqual({ ok: true });
                jest.advanceTimersByTime(RENDER_TIMEOUT_MS * 2); // the timer was cleared: nothing changes
                await flush();
                expect(outcome).toEqual({ ok: true });
            });

            it("is { ok: false, render_failed } when nothing appears within 4 s", async () => {
                jest.useFakeTimers();
                gis.renderButton.mockImplementation(() => {});
                const rendered = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
                let outcome: unknown;
                void rendered.ready.then((o) => (outcome = o));

                jest.advanceTimersByTime(RENDER_TIMEOUT_MS - 1);
                await flush();
                expect(outcome).toBeUndefined();

                jest.advanceTimersByTime(1);
                await flush();
                expect(outcome).toEqual({ ok: false, reason: "render_failed" });
            });

            it("rejects with render_failed when renderButton throws, and leaves nothing behind", async () => {
                const boom = new Error("gsi exploded");
                const onCredential = jest.fn();
                gis.renderButton.mockImplementation(() => {
                    throw boom;
                });

                const error = await renderGoogleButton(container, { text: "signin_with", onCredential }).catch(
                    (e: unknown) => e,
                );

                expect(error).toBeInstanceOf(GoogleUnavailableError);
                expect((error as GoogleUnavailableError).reason).toBe("render_failed");
                expect((error as GoogleUnavailableError).cause).toBe(boom);
                expect(container.childElementCount).toBe(0);
                gisCallback(gis)({ credential: "t" });
                expect(onCredential).not.toHaveBeenCalled(); // the handler was unplugged again
            });

            it("a disposed button resolves its pending ready with { ok: true } (nothing left to report)", async () => {
                gis.renderButton.mockImplementation(() => {});
                const rendered = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
                rendered.dispose();
                await expect(rendered.ready).resolves.toEqual({ ok: true });
            });
        });

        describe("dispose", () => {
            it("removes only its own host and is idempotent", async () => {
                const otherContainer = document.createElement("div");
                document.body.appendChild(otherContainer);
                const a = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
                await renderGoogleButton(otherContainer, { text: "signin_with", onCredential: jest.fn() });
                expect(hosts(container)).toHaveLength(1);
                expect(hosts(otherContainer)).toHaveLength(1);

                a.dispose();
                a.dispose();

                expect(hosts(container)).toHaveLength(0);
                expect(hosts(otherContainer)).toHaveLength(1);
            });

            it("does not remove nodes it does not own", async () => {
                const bystander = document.createElement("span");
                const a = await renderGoogleButton(container, { text: "signin_with", onCredential: jest.fn() });
                container.appendChild(bystander);
                a.dispose();
                expect(container.contains(bystander)).toBe(true);
            });
        });
    });

    describe("configuration and origin helpers", () => {
        it("isGoogleSignInConfigured needs the switch AND a client id", () => {
            expect(isGoogleSignInConfigured()).toBe(true);
            configureClariva({ google_client_id: CLIENT_ID, features: { google_sign_in: false } });
            expect(isGoogleSignInConfigured()).toBe(false);
            configureClariva();
            expect(isGoogleSignInConfigured()).toBe(false);
            configureClariva({ google_client_id: "   " });
            expect(isGoogleSignInConfigured()).toBe(false);
        });

        it("currentOrigin is window.location.origin", () => {
            expect(currentOrigin()).toBe(window.location.origin);
        });

        it.each([
            "http://localhost",
            "http://localhost:8090",
            "http://127.0.0.1:8080",
            "http://[::1]:3000",
            "http://a.localhost",
            "https://x.test",
            "http://HOST.TEST:8080",
        ])("isDevOrigin is true for %s", (origin) => {
            expect(isDevOrigin(origin)).toBe(true);
        });

        it.each([
            "https://clarivahub.com",
            "https://web.clarivahub.com",
            "https://localhost.evil.com",
            "https://evil.test.com",
            "http://localhost@evil.com", // "localhost" is the userinfo; the host is evil.com
            "http://localhost.", // the trailing-dot FQDN form is not what a developer's machine is called
            "http://[::ffff:127.0.0.1]", // an IPv4-mapped IPv6 literal, not [::1]
            "https://evil.com#@localhost", // "localhost" is in the fragment
            "http://192.168.1.5",
            "http://192.168.1.5:8090",
            "not an origin",
            "",
        ])("isDevOrigin is false for %j", (origin) => {
            expect(isDevOrigin(origin)).toBe(false);
        });

        it("originsToAuthorise lists localhost with its port AND without, any other origin as it is", () => {
            expect(originsToAuthorise("http://localhost:8090")).toEqual(["http://localhost:8090", "http://localhost"]);
            expect(originsToAuthorise("https://web.clarivahub.com")).toEqual(["https://web.clarivahub.com"]);
            expect(originsToAuthorise("http://localhost")).toEqual(["http://localhost"]);
            expect(originsToAuthorise("http://127.0.0.1:8080")).toEqual(["http://127.0.0.1:8080"]);
            expect(originsToAuthorise("garbage")).toEqual(["garbage"]);
        });
    });
});
