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

import { compareAmounts, formatCredits, formatRupees, isLess, parseAmount, round2 } from "../../src/clariva/money";

describe("clariva money helpers", () => {
    describe("parseAmount", () => {
        it("parses DECIMAL strings and numbers", () => {
            expect(parseAmount("250.00")).toBe(250);
            expect(parseAmount(" 12.5 ")).toBe(12.5);
            expect(parseAmount(40)).toBe(40);
        });

        it("returns null (never 0) for unknown / garbage so callers cannot clobber a good value", () => {
            expect(parseAmount(null)).toBeNull();
            expect(parseAmount(undefined)).toBeNull();
            expect(parseAmount("")).toBeNull();
            expect(parseAmount("abc")).toBeNull();
            expect(parseAmount(NaN)).toBeNull();
            expect(parseAmount({})).toBeNull();
        });
    });

    it("round2 rounds half-up like the server (JS Math.round)", () => {
        expect(round2(1.005 * 1000) / 1000).toBeCloseTo(1.005, 3);
        expect(round2(12.345)).toBe(12.35);
        expect(round2(0.004)).toBe(0);
        expect(round2(0.005)).toBe(0.01);
    });

    it("compares at the server's 2-decimal precision", () => {
        expect(compareAmounts(0.1 + 0.2, 0.3)).toBe(0);
        expect(isLess(49.99, 50)).toBe(true);
        expect(isLess(50, 50)).toBe(false);
        // Android truncated both sides to ints and let 50.00 pass a 50.90 price; the web must not.
        expect(isLess(50, 50.9)).toBe(true);
    });

    it("formats credits: integers plain, cents only when present", () => {
        expect(formatCredits(1195)).toBe("1195");
        expect(formatCredits(99.99)).toBe("99.99");
        expect(formatCredits(20.0)).toBe("20");
        expect(formatCredits(12.5)).toBe("12.50");
        // grouping follows the runtime locale (1,234,567 / 12,34,567 / 1.234.567): only assert the digits
        expect(formatCredits(1234567, true).replace(/\D/g, "")).toBe("1234567");
        expect(formatRupees(50)).toBe("₹50");
    });
});
