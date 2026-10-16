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

import { getClarivaConfig } from "../config";

export type QueryValue = string | number | boolean | null | undefined;
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Android uses connect 30 s / read 60 s / write 60 s; a single 30 s budget per request is plenty for a browser. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export type ClarivaHttpErrorKind = "network" | "timeout" | "http";

/**
 * Thrown for every failed Wallet-API call.
 *
 * - `status === 0` means the request never produced an HTTP response (offline, DNS, CORS rejection, timeout).
 *   Callers treat that as "unknown", never as "no" (lesson L5/L1: unknown must not restrict or bill).
 * - `serverMessage` is the user-facing text from the Nest error envelope (`{ statusCode, message }`), where
 *   `message` is either a string or an array of validation messages (joined by newlines).
 */
export class ClarivaHttpError extends Error {
    public readonly name = "ClarivaHttpError";

    public constructor(
        public readonly status: number,
        message: string,
        public readonly kind: ClarivaHttpErrorKind,
        public readonly serverMessage?: string,
        public readonly body?: unknown,
        public readonly url?: string,
    ) {
        super(message);
        // down-levelled / extended built-ins: keep `instanceof` working in every environment
        Object.setPrototypeOf(this, ClarivaHttpError.prototype);
    }

    /** No HTTP response was received. */
    public get isNetwork(): boolean {
        return this.kind === "network" || this.kind === "timeout";
    }

    public get isServerError(): boolean {
        return this.status >= 500;
    }

    public get isNotFound(): boolean {
        return this.status === 404;
    }
}

export interface RequestOptions {
    query?: Record<string, QueryValue>;
    /** JSON body. `undefined` values are dropped by JSON.stringify, which is what the server's whitelist wants. */
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
}

/** `encodeURIComponent` for one path segment (Matrix IDs contain `@` and `:`). */
export function seg(value: string): string {
    return encodeURIComponent(value);
}

export function buildQuery(query: Record<string, QueryValue> | undefined): string {
    if (!query) return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        params.append(key, String(value));
    }
    const str = params.toString();
    return str ? `?${str}` : "";
}

/**
 * Pull a human-readable message out of Nest's error envelope. `message` may be a string or a list.
 * Mirrors Android's `serverMessage()` in ClarivaAuthService.
 */
export function extractServerMessage(body: unknown): string | undefined {
    if (!body || typeof body !== "object") return undefined;
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message.trim() || undefined;
    if (Array.isArray(message)) {
        const joined = message
            .filter((m): m is string => typeof m === "string")
            .join("\n")
            .trim();
        return joined || undefined;
    }
    return undefined;
}

function joinUrl(base: string, path: string): string {
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The single place that talks to the Wallet-API.
 *
 * - No cookies, no `Authorization` header unless the caller passes one (only `/v1/auth/matrix-session` needs it).
 * - Success is any 2xx (the API answers 201 for most POSTs); an empty body resolves to `undefined`.
 */
export async function clarivaRequest<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const base = getClarivaConfig().api_base_url;
    if (!base) {
        throw new ClarivaHttpError(0, "Clariva API is not configured (clariva.api_base_url)", "network");
    }
    const url = joinUrl(base, path) + buildQuery(options.query);

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onCallerAbort);
    if (options.signal?.aborted) controller.abort();

    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    let body: string | undefined;
    if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
            credentials: "omit",
            cache: "no-store",
            referrerPolicy: "no-referrer",
        });
    } catch (e) {
        if (timedOut) throw new ClarivaHttpError(0, `Request timed out after ${timeoutMs} ms`, "timeout", undefined, undefined, url);
        // A caller-initiated abort should surface as an AbortError so callers can ignore it.
        if (options.signal?.aborted) throw e;
        throw new ClarivaHttpError(0, e instanceof Error ? e.message : "Network error", "network", undefined, undefined, url);
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onCallerAbort);
    }

    let parsed: unknown;
    try {
        const text = await response.text();
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
        }
    } catch {
        // body unreadable: treat like an empty body
    }

    if (!response.ok) {
        const serverMessage = extractServerMessage(parsed);
        throw new ClarivaHttpError(
            response.status,
            serverMessage ?? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
            "http",
            serverMessage,
            parsed,
            url,
        );
    }
    return parsed as T;
}

export const clarivaGet = <T>(path: string, options?: RequestOptions): Promise<T> =>
    clarivaRequest<T>("GET", path, options);
export const clarivaPost = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    clarivaRequest<T>("POST", path, { ...options, body });
export const clarivaPatch = <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    clarivaRequest<T>("PATCH", path, { ...options, body });
