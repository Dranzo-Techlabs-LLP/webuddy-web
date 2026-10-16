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
import { ClarivaAuthApi, SIGN_IN_TIMEOUT_MS } from "../../src/clariva/api/auth";
import {
    ClarivaHttpError,
    buildQuery,
    clarivaGet,
    clarivaPost,
    extractServerMessage,
    seg,
} from "../../src/clariva/api/http";
import { mockResponse } from "./helpers";

describe("clariva http", () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        (global as any).fetch = fetchMock;
        SdkConfig.reset();
        SdkConfig.add({ clariva: { api_base_url: "https://api.test/" } });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("builds URLs from the configured base (trailing slash tolerated) with encoded query values", async () => {
        fetchMock.mockResolvedValue(mockResponse(200, { exists: true }));
        const res = await clarivaGet<{ exists: boolean }>("/v1/pending-holds/exists", {
            query: { clientId: "@a:clarivahub.com", consultantId: "@b:clarivahub.com", skip: undefined },
        });
        expect(res).toEqual({ exists: true });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
            "https://api.test/v1/pending-holds/exists?clientId=%40a%3Aclarivahub.com&consultantId=%40b%3Aclarivahub.com",
        );
        expect(init.method).toBe("GET");
        expect(init.credentials).toBe("omit");
        // nothing identifying leaks to the API (no cookies, no Referer) and nothing is cached
        expect(init.referrerPolicy).toBe("no-referrer");
        expect(init.cache).toBe("no-store");
        expect(init.headers.Authorization).toBeUndefined();
    });

    it("sends JSON bodies with a content type, and nothing for an absent body", async () => {
        fetchMock.mockResolvedValue(mockResponse(201, { ok: true }));
        await clarivaPost("/v1/x", { a: 1, b: undefined });
        expect(fetchMock.mock.calls[0][1].body).toBe('{"a":1}');
        expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
        expect(fetchMock.mock.calls[0][1].credentials).toBe("omit");
        expect(fetchMock.mock.calls[0][1].referrerPolicy).toBe("no-referrer");
        expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");

        await clarivaPost("/v1/y");
        expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
        expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBeUndefined();
    });

    it("treats any 2xx with an empty body as success", async () => {
        fetchMock.mockResolvedValue(mockResponse(201));
        await expect(clarivaPost("/v1/refund/request", {})).resolves.toBeUndefined();
    });

    it("maps Nest error envelopes (string and array messages)", async () => {
        fetchMock.mockResolvedValueOnce(mockResponse(400, { statusCode: 400, message: "Bad things" }));
        await expect(clarivaGet("/v1/a")).rejects.toMatchObject({ status: 400, serverMessage: "Bad things" });

        fetchMock.mockResolvedValueOnce(mockResponse(400, { message: ["a is wrong", "b is wrong"] }));
        await expect(clarivaGet("/v1/a")).rejects.toMatchObject({ serverMessage: "a is wrong\nb is wrong" });

        fetchMock.mockResolvedValueOnce(mockResponse(502, "<html>bad gateway</html>", "Bad Gateway"));
        const err: any = await clarivaGet("/v1/a").catch((e): any => e);
        expect(err).toBeInstanceOf(ClarivaHttpError);
        expect(err.message).toBe("HTTP 502 Bad Gateway");
        expect(err.isServerError).toBe(true);
    });

    it("reports a missing HTTP response (offline / CORS rejection) as status 0, never as an HTTP status", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        const err: any = await clarivaGet("/v1/a").catch((e): any => e);
        expect(err).toBeInstanceOf(ClarivaHttpError);
        expect(err.status).toBe(0);
        expect(err.isNetwork).toBe(true);
    });

    it("times out", async () => {
        jest.useFakeTimers();
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                }),
        );
        const promise = clarivaGet("/v1/a", { timeoutMs: 1000 }).catch((e): any => e);
        await jest.advanceTimersByTimeAsync(1001);
        const err: any = await promise;
        expect(err).toBeInstanceOf(ClarivaHttpError);
        expect(err.kind).toBe("timeout");
        expect(err.isNetwork).toBe(true);
    });

    it("fails fast and clearly when no API is configured", async () => {
        SdkConfig.reset();
        const err: any = await clarivaGet("/v1/a").catch((e): any => e);
        expect(err).toBeInstanceOf(ClarivaHttpError);
        expect(err.isNetwork).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("helpers", () => {
        expect(seg("@a:b.c")).toBe("%40a%3Ab.c");
        expect(buildQuery({ a: 1, b: false, c: null })).toBe("?a=1&b=false");
        expect(buildQuery(undefined)).toBe("");
        expect(extractServerMessage({ message: "  " })).toBeUndefined();
        expect(extractServerMessage(null)).toBeUndefined();
    });

    describe("ClarivaAuthApi sign-in timeouts (Android allows 60 s for the Google exchange and the Matrix session)", () => {
        /** A fetch that never answers; it only ends when the request is aborted (i.e. when the timeout fires). */
        const hangUntilAborted = (): void => {
            fetchMock.mockImplementation(
                (_url: string, init: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                    }),
            );
        };

        /** Runs `call` against a hanging server and returns how long (ms) it took to give up. */
        const timeToGiveUp = async (
            call: () => Promise<unknown>,
            limit: number,
        ): Promise<{ at: number; error: any }> => {
            jest.useFakeTimers();
            hangUntilAborted();
            let error: any;
            let finishedAt: number | undefined;
            const started = Date.now();
            call().catch((e: unknown) => {
                error = e;
                finishedAt = Date.now() - started;
            });
            await jest.advanceTimersByTimeAsync(limit - 1);
            expect(finishedAt).toBeUndefined(); // still waiting one millisecond before the limit
            await jest.advanceTimersByTimeAsync(1);
            return { at: finishedAt!, error };
        };

        it("the sign-in timeout is 60 s", () => {
            expect(SIGN_IN_TIMEOUT_MS).toBe(60_000);
        });

        it.each([
            ["google", (): Promise<unknown> => ClarivaAuthApi.google({ idToken: "t" }), 60_000],
            ["matrixSession", (): Promise<unknown> => ClarivaAuthApi.matrixSession("jwt"), 60_000],
            // everything else keeps the flat default
            ["login", (): Promise<unknown> => ClarivaAuthApi.login({ identifier: "jane", password: "pw" }), 30_000],
            ["reauthMethod", (): Promise<unknown> => ClarivaAuthApi.reauthMethod("@j:clarivahub.com"), 30_000],
        ])("%s waits %s ms before it reports a timeout", async (_name, call, limit) => {
            const { at, error } = await timeToGiveUp(call, limit);
            expect(at).toBe(limit);
            expect(error).toBeInstanceOf(ClarivaHttpError);
            expect(error.kind).toBe("timeout");
            expect(error.isNetwork).toBe(true);
        });

        it("a caller-supplied timeout still wins", async () => {
            const { at } = await timeToGiveUp(
                () => ClarivaAuthApi.google({ idToken: "t" }, { timeoutMs: 5_000 }),
                5_000,
            );
            expect(at).toBe(5_000);
        });

        it("matrixSession still sends the Bearer JWT (and any extra header) while keeping its timeout", async () => {
            fetchMock.mockResolvedValue(mockResponse(200, { userId: "@j:x", accessToken: "t", deviceId: "D" }));
            await ClarivaAuthApi.matrixSession("the-jwt", { headers: { "X-Trace": "1" } });
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("https://api.test/v1/auth/matrix-session");
            expect(init.method).toBe("POST");
            expect(init.headers.Authorization).toBe("Bearer the-jwt");
            expect(init.headers["X-Trace"]).toBe("1");
            expect(init.body).toBeUndefined();
        });
    });
});
