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

import SdkConfig from "../SdkConfig";
import { markClarivaRoot } from "./rootMarker";

/* eslint-disable camelcase */
/* eslint @typescript-eslint/naming-convention: ["error", { "selector": "property", "format": ["snake_case"] } ] */

/**
 * Polling cadence. Android's own history shows that polling the Wallet-API faster than this starved the MySQL
 * connection pool (see docs/clariva/spec/03-chat-gate-holds-refunds.md, lesson L7), so treat these as floors
 * and never poll faster. All timers are paused while the tab is hidden.
 */
export interface IClarivaPollingConfig {
    /** Own balance + role refresh. Android: 8 s on the home screen. */
    balance_ms: number;
    /** Consultant "Refund" pills in the room list. Android: 8 s. */
    refund_pills_ms: number;
    /** Hold / refund status of the open DM. Android: 15 s. */
    hold_status_ms: number;
    /** Composer gate revalidation (balance + hold-exists + peer rate) for confirmed clients. Android: 60 s. */
    gate_ms: number;
    /** How long a peer's rate / role may be served from cache for an open chat. Android: forever (a known quirk). */
    peer_rate_ttl_ms: number;
    /** How long a peer's rate / role may be served from cache for room-list labels. */
    peer_rate_list_ttl_ms: number;
}

/**
 * The `clariva` section of config.json. Everything is optional; `getClarivaConfig()` applies the defaults.
 * See config.clariva.json for a documented example.
 */
export interface IClarivaConfig {
    /**
     * Base URL of the Clariva Wallet-API (auth + wallet + holds + refunds + call type), e.g.
     * "https://wallet.dranzo.com" (needs CORS enabled server-side, see Wallet-API CORS_ORIGINS) or a same-origin
     * reverse-proxy path such as "/clariva-api". When unset the Clariva features are disabled and the app behaves
     * like stock Element Web.
     */
    api_base_url?: string;

    /** Public Google OAuth *Web* client ID for "Sign in with Google" (Google Identity Services). Optional. */
    google_client_id?: string;

    /** Razorpay Checkout script. Defaults to the official URL. */
    razorpay_checkout_url?: string;

    /** Matrix server_name used for "You will be @name:server" previews. Defaults to the homeserver's name. */
    matrix_server_name?: string;

    /** Base URL for user deep links / QR payloads, e.g. "https://clarivahub.com/u/". */
    user_link_base?: string;

    /** Polling overrides (see IClarivaPollingConfig). */
    polling?: Partial<IClarivaPollingConfig>;

    /**
     * Hold-first billing (decision D5): for a client without a covering hold, `await POST /pending-holds/initiate`
     * *before* sending the first message of a session and only send on success. Network/5xx failures stay
     * fail-open (the message is sent), only a definitive "insufficient credits" blocks. Android sends first and
     * ignores the hold result. Default true.
     */
    hold_first?: boolean;

    /**
     * Only gate / bill / show refund UI when the DM peer is a consultant with a price > 0 (decision D5). Android
     * applies the money logic to every DM, which creates zero-value holds in client-to-client chats. Default true.
     */
    bill_consultants_only?: boolean;

    /** Feature switches for the pieces that need extra infrastructure. */
    features?: {
        /** Voice / video calls through Element Call. Default false until the call interop spike is signed off. */
        calls?: boolean;
        /** "My QR code" + QR scanner. Default true. */
        qr?: boolean;
        /** Google sign-in button (also requires google_client_id). Default true. */
        google_sign_in?: boolean;
        /**
         * Group rooms and spaces (Android `ClarivaConfig.GROUP_ROOMS_ENABLED`). Default false: the "Rooms" chat-list
         * filter and the "New room" / "Join room by address" / room directory entries are hidden. 1:1 chats are
         * unaffected, and group rooms a user is already in keep appearing in the chat list.
         */
        group_rooms?: boolean;
    };
}

export interface IResolvedClarivaConfig {
    api_base_url: string;
    google_client_id: string | undefined;
    razorpay_checkout_url: string;
    matrix_server_name: string | undefined;
    user_link_base: string;
    polling: IClarivaPollingConfig;
    hold_first: boolean;
    bill_consultants_only: boolean;
    features: { calls: boolean; qr: boolean; google_sign_in: boolean; group_rooms: boolean };
}

export const DEFAULT_POLLING: Readonly<IClarivaPollingConfig> = Object.freeze({
    balance_ms: 15_000,
    refund_pills_ms: 10_000,
    hold_status_ms: 15_000,
    gate_ms: 60_000,
    peer_rate_ttl_ms: 60_000,
    peer_rate_list_ttl_ms: 5 * 60_000,
});

const DEFAULT_RAZORPAY_URL = "https://checkout.razorpay.com/v1/checkout.js";
const DEFAULT_USER_LINK_BASE = "https://clarivahub.com/u/";

/** Never let a config typo turn into an aggressive poll loop: clamp to a sane floor. */
const MIN_POLL_MS = 5_000;

function clampPoll(value: unknown, fallback: number): number {
    const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.max(MIN_POLL_MS, Math.round(n));
}

/**
 * Resolve the Clariva configuration from the loaded config.json (`SdkConfig`). Cheap enough to call on every use,
 * which keeps tests simple (they can `SdkConfig.put(...)` freely).
 */
export function getClarivaConfig(): IResolvedClarivaConfig {
    const raw = (SdkConfig.get() as { clariva?: IClarivaConfig }).clariva ?? {};
    const polling = raw.polling ?? {};
    return {
        api_base_url: (raw.api_base_url ?? "").trim().replace(/\/+$/, ""),
        google_client_id: raw.google_client_id?.trim() || undefined,
        razorpay_checkout_url: raw.razorpay_checkout_url?.trim() || DEFAULT_RAZORPAY_URL,
        matrix_server_name: raw.matrix_server_name?.trim() || undefined,
        user_link_base: raw.user_link_base?.trim() || DEFAULT_USER_LINK_BASE,
        polling: {
            balance_ms: clampPoll(polling.balance_ms, DEFAULT_POLLING.balance_ms),
            refund_pills_ms: clampPoll(polling.refund_pills_ms, DEFAULT_POLLING.refund_pills_ms),
            hold_status_ms: clampPoll(polling.hold_status_ms, DEFAULT_POLLING.hold_status_ms),
            gate_ms: clampPoll(polling.gate_ms, DEFAULT_POLLING.gate_ms),
            peer_rate_ttl_ms: Math.max(0, polling.peer_rate_ttl_ms ?? DEFAULT_POLLING.peer_rate_ttl_ms),
            peer_rate_list_ttl_ms: Math.max(0, polling.peer_rate_list_ttl_ms ?? DEFAULT_POLLING.peer_rate_list_ttl_ms),
        },
        hold_first: raw.hold_first ?? true,
        bill_consultants_only: raw.bill_consultants_only ?? true,
        features: {
            calls: raw.features?.calls ?? false,
            qr: raw.features?.qr ?? true,
            google_sign_in: raw.features?.google_sign_in ?? true,
            group_rooms: raw.features?.group_rooms ?? false,
        },
    };
}

/** True when the deployment configured a Clariva API; otherwise every Clariva feature stays dormant. */
export function isClarivaEnabled(): boolean {
    const enabled = getClarivaConfig().api_base_url.length > 0;
    if (enabled) markClarivaRoot(); // CLARIVA: `:root[data-clariva]` scopes the Clariva look-and-feel overrides
    return enabled;
}
