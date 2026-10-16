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

import { getClarivaConfig } from "../config";

/**
 * Google Identity Services (GIS) loader. The script is loaded when the landing page mounts (not at app start-up) and
 * the OFFICIAL rendered button is used: it opens Google's account chooser in a popup and hands back an ID token (a
 * JWT whose `aud` is our web client ID) in `callback({ credential })`. That token is what `POST /v1/auth/google`
 * expects.
 *
 * Android deliberately shows every account and never auto-selects (spec 01 §6.7); so does this: no One Tap, no
 * `auto_select`, `ux_mode: "popup"`.
 *
 * CSP: needs `https://accounts.google.com/gsi/client` in script-src, `https://accounts.google.com/gsi/style` in
 * style-src, and `https://accounts.google.com/` in frame-src/connect-src (see docs/clariva/IMPLEMENTATION-NOTES.md).
 *
 * What can and cannot be detected (docs/clariva/IMPLEMENTATION-NOTES.md, "Google sign-in failure handling"): a script
 * that is blocked, hangs, or a button that never appears is reported through {@link GoogleUnavailableReason}. Google
 * refusing the page's ORIGIN (not listed under "Authorized JavaScript origins") happens inside Google's own code and
 * is not observable from here, so it is deliberately not guessed at.
 */

export const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

/** How long the GIS script may take to load before it counts as unreachable. */
export const SCRIPT_TIMEOUT_MS = 10_000;
/** How long Google's button may take to put something into its container before it counts as not rendered. */
export const RENDER_TIMEOUT_MS = 4_000;

export type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";

/** Why Google's button is not usable: the script was blocked / failed, never arrived in time, or drew nothing. */
export type GoogleUnavailableReason = "script_blocked" | "script_timeout" | "render_failed";

export class GoogleUnavailableError extends Error {
    public readonly name = "GoogleUnavailableError";

    public constructor(
        public readonly reason: GoogleUnavailableReason,
        message?: string,
        public readonly cause?: unknown,
    ) {
        super(message ?? `Google sign-in is unavailable (${reason})`);
        // down-levelled / extended built-ins: keep `instanceof` working in every environment
        Object.setPrototypeOf(this, GoogleUnavailableError.prototype);
    }
}

export type GoogleButtonOutcome = { ok: true } | { ok: false; reason: GoogleUnavailableReason };

interface GoogleCredentialResponse {
    credential?: string;
}

interface GoogleAccountsId {
    initialize(config: {
        client_id: string; // eslint-disable-line camelcase
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean; // eslint-disable-line camelcase
        ux_mode?: "popup" | "redirect"; // eslint-disable-line camelcase
        cancel_on_tap_outside?: boolean; // eslint-disable-line camelcase
    }): void;
    renderButton(
        parent: HTMLElement,
        options: {
            type?: "standard" | "icon";
            theme?: "outline" | "filled_blue" | "filled_black"; // eslint-disable-line camelcase
            size?: "large" | "medium" | "small";
            text?: GoogleButtonText;
            shape?: "rectangular" | "pill" | "circle" | "square";
            logo_alignment?: "left" | "center"; // eslint-disable-line camelcase
            width?: number;
        },
    ): void;
    disableAutoSelect?(): void;
}

function gis(): GoogleAccountsId | undefined {
    return (window as unknown as { google?: { accounts?: { id?: GoogleAccountsId } } }).google?.accounts?.id;
}

let loading: Promise<GoogleAccountsId> | null = null;
let loadTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Load the GIS script once. A failure (blocked, offline, no answer within {@link SCRIPT_TIMEOUT_MS}) rejects with a
 * {@link GoogleUnavailableError}, removes the `<script>` tag and forgets the attempt, so a retry starts clean. If the
 * script does arrive late, `window.google` appears anyway and the next call takes the `existing` fast path.
 */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
    const existing = gis();
    if (existing) return Promise.resolve(existing);
    if (loading) return loading;

    const attempt: Promise<GoogleAccountsId> = new Promise<GoogleAccountsId>((resolve, reject) => {
        const script = document.createElement("script");
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const succeed = (api: GoogleAccountsId): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(api);
        };
        const fail = (reason: GoogleUnavailableReason, message: string): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            script.remove();
            reject(new GoogleUnavailableError(reason, message));
        };

        script.src = GIS_SCRIPT_URL;
        script.async = true;
        script.defer = true;
        script.onload = (): void => {
            const api = gis();
            if (api) succeed(api);
            else fail("script_blocked", "Google Identity Services did not initialise");
        };
        script.onerror = (): void => fail("script_blocked", "Could not load Google Identity Services");
        timer = setTimeout(
            () => fail("script_timeout", `Google Identity Services did not load within ${SCRIPT_TIMEOUT_MS} ms`),
            SCRIPT_TIMEOUT_MS,
        );
        loadTimer = timer;
        document.head.appendChild(script);
    }).catch((e) => {
        if (loading === attempt) loading = null; // allow a retry
        throw e;
    });
    loading = attempt;
    return attempt;
}

/** True when the deployment configured a Google web client ID and the feature switch is on. */
export function isGoogleSignInConfigured(): boolean {
    const config = getClarivaConfig();
    return config.features.google_sign_in && !!config.google_client_id;
}

/** `window.location.origin`, behind a function so tests (and the dev hint) can substitute it. */
export function currentOrigin(): string {
    return window.location.origin;
}

function parseOrigin(origin: string): URL | null {
    try {
        return new URL(origin);
    } catch {
        return null;
    }
}

/** A developer's machine: `localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test`. Never true for a real host. */
export function isDevOrigin(origin: string): boolean {
    const hostname = parseOrigin(origin)?.hostname.toLowerCase();
    if (!hostname) return false;
    return (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "[::1]" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".test")
    );
}

/**
 * The "Authorized JavaScript origins" entries Google needs for `origin`. For `localhost` with a port Google's guidance
 * is to list both `http://localhost:<port>` and plain `http://localhost`; any other origin is listed as it is.
 */
export function originsToAuthorise(origin: string): string[] {
    const url = parseOrigin(origin);
    if (url && url.hostname.toLowerCase() === "localhost" && url.port) return [origin, `${url.protocol}//localhost`];
    return [origin];
}

// GIS has ONE global callback, so every rendered button routes through this holder. Only one button is live at a
// time (the landing page, or the deactivate dialog); a stale button's dispose() must not unplug the live one.
let activeHandler: ((idToken: string) => void) | null = null;
// `initialize()` belongs to ONE `google.accounts.id` object and ONE client id. A GIS script that finally arrives after
// a timed-out attempt was retried replaces `window.google.accounts.id` with a fresh, uninitialised object, so the
// object is tracked as well as the client id.
let initialisedFor: string | null = null;
let initialisedApi: GoogleAccountsId | null = null;

export interface RenderedGoogleButton {
    /** Removes THIS render's DOM only and stops listening for its outcome. Idempotent. */
    dispose(): void;
    /**
     * Resolves once Google has put something into the button's container (`{ ok: true }`), or after
     * {@link RENDER_TIMEOUT_MS} with nothing there (`{ ok: false, reason: "render_failed" }`). Never rejects. A
     * disposed button resolves `{ ok: true }`: there is nothing left to report on.
     */
    ready: Promise<GoogleButtonOutcome>;
}

/** Watch `host` until Google draws into it (or give up). `stop` settles a pending outcome and cleans up. */
function watchRender(host: HTMLElement): { ready: Promise<GoogleButtonOutcome>; stop: () => void } {
    let finish: (outcome: GoogleButtonOutcome) => void = () => {};
    const ready = new Promise<GoogleButtonOutcome>((resolve) => {
        finish = resolve;
    });
    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: GoogleButtonOutcome): void => {
        clearTimeout(timer);
        observer?.disconnect();
        finish(outcome);
    };

    if (host.childElementCount > 0) {
        settle({ ok: true });
    } else {
        observer = new MutationObserver(() => {
            if (host.childElementCount > 0) settle({ ok: true });
        });
        observer.observe(host, { childList: true });
        timer = setTimeout(
            () => settle(host.childElementCount > 0 ? { ok: true } : { ok: false, reason: "render_failed" }),
            RENDER_TIMEOUT_MS,
        );
    }
    return { ready, stop: () => settle({ ok: true }) };
}

/**
 * Render Google's button into `container` and route its ID token to `onCredential`. Rejects with a
 * {@link GoogleUnavailableError} when GIS cannot be loaded or drawn (the caller then explains and offers a retry).
 *
 * Every call draws into its OWN host element, so two overlapping renders (a mode toggle while the script is still
 * loading) can never wipe each other's DOM. Pass `signal` to cancel: a call aborted while the script was loading
 * returns an inert button and touches neither the DOM nor the credential handler.
 */
export async function renderGoogleButton(
    container: HTMLElement,
    options: { text: GoogleButtonText; onCredential: (idToken: string) => void; width?: number; signal?: AbortSignal },
): Promise<RenderedGoogleButton> {
    const clientId = getClarivaConfig().google_client_id;
    if (!clientId) throw new GoogleUnavailableError("render_failed", "Google sign-in is not configured");

    const api = await loadGoogleIdentity();
    if (options.signal?.aborted) return { dispose: () => {}, ready: Promise.resolve({ ok: true }) };

    if (initialisedApi !== api || initialisedFor !== clientId) {
        api.initialize({
            client_id: clientId,
            callback: (response) => {
                if (response.credential) activeHandler?.(response.credential);
                else logger.warn("Clariva: Google did not return an ID token");
            },
            auto_select: false,
            ux_mode: "popup",
            cancel_on_tap_outside: true,
        });
        initialisedFor = clientId;
        initialisedApi = api;
    }
    api.disableAutoSelect?.();

    const handler = (idToken: string): void => options.onCredential(idToken);
    const host = document.createElement("div");
    host.className = "mx_ClarivaAuth_googleHost";
    container.replaceChildren(host);
    activeHandler = handler;
    const width = Math.max(200, Math.min(400, Math.round(options.width ?? (container.clientWidth || 320))));
    try {
        api.renderButton(host, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: options.text,
            shape: "pill",
            logo_alignment: "left",
            width,
        });
    } catch (e) {
        host.remove();
        if (activeHandler === handler) activeHandler = null;
        throw new GoogleUnavailableError("render_failed", "Google could not draw its sign-in button", e);
    }

    const { ready, stop } = watchRender(host);
    let disposed = false;
    return {
        ready,
        dispose: (): void => {
            if (disposed) return;
            disposed = true;
            stop();
            if (activeHandler === handler) activeHandler = null;
            host.remove();
        },
    };
}

/** Test helper: forget every module-level trace of GIS (state, `<script>` tags, `window.google`). */
export function resetGoogleIdentityForTests(): void {
    clearTimeout(loadTimer);
    loadTimer = undefined;
    loading = null;
    activeHandler = null;
    initialisedFor = null;
    initialisedApi = null;
    document.querySelectorAll(`script[src="${GIS_SCRIPT_URL}"]`).forEach((script) => script.remove());
    delete (window as unknown as { google?: unknown }).google;
}
