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

import SdkConfig from "../../src/SdkConfig";

/** A minimal `Response` stand-in (jsdom has no fetch/Response). */
export function mockResponse(status: number, body?: unknown, statusText = ""): Response {
    const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, statusText, text: async () => text } as unknown as Response;
}

export type RouteHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/**
 * Install a fake `fetch` that dispatches on "METHOD /path" (path without query). Unmatched requests fail the test
 * loudly. Returns the jest mock so tests can assert calls.
 */
export function installFakeApi(routes: Record<string, RouteHandler>): jest.Mock {
    const mock = jest.fn(async (input: string, init: RequestInit = {}) => {
        const url = new URL(input);
        const key = `${init.method ?? "GET"} ${url.pathname}`;
        const handler = routes[key];
        if (!handler) throw new Error(`Unexpected request: ${key}${url.search}`);
        return handler(url, init);
    });
    (global as any).fetch = mock;
    return mock;
}

export function configureClariva(extra: Record<string, unknown> = {}): void {
    SdkConfig.reset();
    SdkConfig.add({ clariva: { api_base_url: "https://api.test", ...extra } } as any);
}

export const ME = "@me:clarivahub.com";
export const CONSULTANT = "@rao:clarivahub.com";
export const CLIENT = "@asha:clarivahub.com";

/** Wallet user payload as the API returns it (DECIMALs as strings). */
export function walletUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { Webuddy_name: ME, matrixUserId: ME, current_hold: "120.00", max_credits: "0.00", isConsultant: 0, ...overrides };
}
