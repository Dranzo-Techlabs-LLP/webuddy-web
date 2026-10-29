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

import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react-hooks";

import {
    IFSC_LOOKUP_DEBOUNCE_MS,
    ifscBlocksSave,
    IfscLookup,
    ifscStatusText,
    ifscSummary,
    titleCase,
    useIfscLookup,
} from "../../src/clariva/wallet/ifsc";
import { installFakeApi, mockResponse } from "./helpers";

const SBI = { BANK: "State Bank of India", BRANCH: "HAJIGANJ", CITY: "PATNA", STATE: "BIHAR" };

describe("IFSC display helpers", () => {
    it("title-cases like Android", () => {
        expect(titleCase("HAJIGANJ ROAD")).toBe("Hajiganj Road");
        expect(titleCase(" new delhi ")).toBe("New Delhi");
    });

    it("summary: bank · branch, city (skipping what is missing)", () => {
        expect(ifscSummary({ bank: "State Bank of India", branch: "Hajiganj", city: "Patna" })).toBe(
            "State Bank of India · Hajiganj, Patna",
        );
        expect(ifscSummary({ bank: "SBI", branch: "", city: "Patna" })).toBe("SBI · Patna");
        expect(ifscSummary({ bank: "SBI", branch: "Fort", city: null })).toBe("SBI · Fort");
    });

    it("only not-found and checking block saving; an unreachable directory does not", () => {
        expect(ifscBlocksSave({ kind: "notFound" })).toBe(true);
        expect(ifscBlocksSave({ kind: "checking" })).toBe(true);
        expect(ifscBlocksSave({ kind: "unavailable" })).toBe(false);
        expect(ifscBlocksSave({ kind: "none" })).toBe(false);
        expect(ifscBlocksSave({ kind: "found", branch: { bank: "B", branch: "", city: null } })).toBe(false);
    });

    it("status lines are Android's copy", () => {
        expect(ifscStatusText({ kind: "none" })).toBeNull();
        expect(ifscStatusText({ kind: "checking" })).toBe("Checking IFSC…");
        expect(ifscStatusText({ kind: "notFound" })).toBe("No bank branch found for this IFSC. Please check the code.");
        expect(ifscStatusText({ kind: "unavailable" })).toBe(
            "Couldn't verify this IFSC right now. It will be checked when you save.",
        );
    });
});

describe("IfscLookup", () => {
    it("does not look up a code that is not well-formed", async () => {
        const fetch = installFakeApi({});
        expect(await new IfscLookup().lookup("SBIN00")).toEqual({ kind: "none" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("GET https://ifsc.razorpay.com/<IFSC> (upper-cased): found, title-cased, cached", async () => {
        const fetch = installFakeApi({ "GET /SBIN0001234": () => mockResponse(200, SBI) });
        const lookup = new IfscLookup();
        const status = await lookup.lookup(" sbin0001234 ");
        expect(status).toEqual({
            kind: "found",
            branch: { bank: "State Bank of India", branch: "Hajiganj", city: "Patna" },
        });
        expect(fetch.mock.calls[0][0]).toBe("https://ifsc.razorpay.com/SBIN0001234");
        expect(fetch.mock.calls[0][1].credentials).toBe("omit");
        await lookup.lookup("SBIN0001234");
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("404 is a definite 'no such branch' and is cached", async () => {
        const fetch = installFakeApi({ "GET /ABCD0123456": () => mockResponse(404, "Not Found") });
        const lookup = new IfscLookup();
        expect(await lookup.lookup("ABCD0123456")).toEqual({ kind: "notFound" });
        expect(await lookup.lookup("ABCD0123456")).toEqual({ kind: "notFound" });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("a 5xx, a network failure or a body without a bank is 'unavailable' and is retried next time", async () => {
        let answer: () => Response = () => mockResponse(503);
        const fetch = installFakeApi({ "GET /SBIN0001234": () => answer() });
        const lookup = new IfscLookup();
        expect(await lookup.lookup("SBIN0001234")).toEqual({ kind: "unavailable" });
        answer = () => mockResponse(200, { BANK: "" });
        expect(await lookup.lookup("SBIN0001234")).toEqual({ kind: "unavailable" });
        answer = () => {
            throw new TypeError("Failed to fetch");
        };
        expect(await lookup.lookup("SBIN0001234")).toEqual({ kind: "unavailable" });
        answer = () => mockResponse(200, SBI);
        expect((await lookup.lookup("SBIN0001234")).kind).toBe("found");
        expect(fetch).toHaveBeenCalledTimes(4);
    });
});

describe("useIfscLookup", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("none -> checking (300 ms debounce) -> found, and reports the branch once", async () => {
        const fetch = installFakeApi({ "GET /SBIN0001234": () => mockResponse(200, SBI) });
        const onFound = jest.fn();
        const lookup = new IfscLookup();
        const { result, rerender } = renderHook(({ code }) => useIfscLookup(code, onFound, lookup), {
            initialProps: { code: "SBIN000" },
        });
        expect(result.current).toEqual({ kind: "none" });

        rerender({ code: "SBIN0001234" });
        expect(result.current).toEqual({ kind: "checking" });
        await act(async () => {
            jest.advanceTimersByTime(IFSC_LOOKUP_DEBOUNCE_MS - 1);
        });
        expect(fetch).not.toHaveBeenCalled();
        await act(async () => {
            jest.advanceTimersByTime(1);
        });
        expect(result.current.kind).toBe("found");
        expect(onFound).toHaveBeenCalledTimes(1);
        expect(onFound).toHaveBeenCalledWith({ bank: "State Bank of India", branch: "Hajiganj", city: "Patna" });
    });

    it("fast typing looks up only the code the user settled on, and a stale answer is never shown", async () => {
        const fetch = installFakeApi({
            "GET /SBIN0001234": () => mockResponse(200, SBI),
            "GET /ABCD0123456": () => mockResponse(404),
        });
        const lookup = new IfscLookup();
        const { result, rerender } = renderHook(({ code }) => useIfscLookup(code, undefined, lookup), {
            initialProps: { code: "SBIN0001234" },
        });
        await act(async () => {
            jest.advanceTimersByTime(100);
        });
        rerender({ code: "ABCD0123456" });
        await act(async () => {
            jest.advanceTimersByTime(IFSC_LOOKUP_DEBOUNCE_MS);
        });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe("https://ifsc.razorpay.com/ABCD0123456");
        expect(result.current).toEqual({ kind: "notFound" });

        // clearing the field goes straight back to "none"
        rerender({ code: "" });
        expect(result.current).toEqual({ kind: "none" });
    });

    it("a code typed again is checked again: an old 'unavailable' never shows while the new lookup runs", async () => {
        let calls = 0;
        installFakeApi({
            "GET /SBIN0001234": () => (++calls === 1 ? mockResponse(503) : mockResponse(200, SBI)),
        });
        const lookup = new IfscLookup();
        const { result, rerender } = renderHook(({ code }) => useIfscLookup(code, undefined, lookup), {
            initialProps: { code: "SBIN0001234" },
        });
        await act(async () => {
            jest.advanceTimersByTime(IFSC_LOOKUP_DEBOUNCE_MS);
        });
        expect(result.current).toEqual({ kind: "unavailable" });

        rerender({ code: "SBIN000123" }); // edited away...
        expect(result.current).toEqual({ kind: "none" });
        rerender({ code: "SBIN0001234" }); // ...and back: "checking" (which blocks saving), not the old answer
        expect(result.current).toEqual({ kind: "checking" });
        await act(async () => {
            jest.advanceTimersByTime(IFSC_LOOKUP_DEBOUNCE_MS - 1);
        });
        expect(result.current).toEqual({ kind: "checking" });
        await act(async () => {
            jest.advanceTimersByTime(1);
        });
        expect(result.current.kind).toBe("found");
        expect(calls).toBe(2);
    });
});
