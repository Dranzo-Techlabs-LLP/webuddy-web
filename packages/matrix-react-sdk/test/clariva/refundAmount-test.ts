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

import {
    formatPlainAmount,
    isAllowedRefundAmountInput,
    parseRefundAmountText,
    refundAmountSupportText,
    validateRefundAmount,
} from "../../src/clariva/refund/amount";

describe("Approve-refund amount (spec 03 U5 / L13)", () => {
    describe("input filter ^\\d*\\.?\\d*$", () => {
        it.each(["", "0", "12", "12.", ".5", "12.50", "007"])("accepts %j", (value) => {
            expect(isAllowedRefundAmountInput(value)).toBe(true);
        });

        it.each(["-1", "+1", "1e3", "1.2.3", "..", "a", "1a", " 1", "1 ", "1,5", "₹1"])("rejects %j", (value) => {
            expect(isAllowedRefundAmountInput(value)).toBe(false);
        });
    });

    describe("parse (Kotlin trim().toDoubleOrNull())", () => {
        it("parses digits with an optional dot", () => {
            expect(parseRefundAmountText("5.")).toBe(5);
            expect(parseRefundAmountText(".5")).toBe(0.5);
            expect(parseRefundAmountText("12.50")).toBe(12.5);
            expect(parseRefundAmountText("  7  ")).toBe(7);
        });

        it("returns null for blank, a lone dot and anything that is not a plain decimal", () => {
            expect(parseRefundAmountText("")).toBeNull(); // JS Number("") would be 0
            expect(parseRefundAmountText("   ")).toBeNull();
            expect(parseRefundAmountText(".")).toBeNull();
            expect(parseRefundAmountText("abc")).toBeNull();
            expect(parseRefundAmountText("0x10")).toBeNull();
            expect(parseRefundAmountText("1e5")).toBeNull();
        });
    });

    describe("validateRefundAmount (held = 50)", () => {
        const v = (text: string, held: number | null = 50) => validateRefundAmount(text, held);

        it("0 is invalid and shows the error (not blank)", () => {
            expect(v("0")).toEqual({ amount: 0, valid: false, showError: true });
            expect(v("0.00").valid).toBe(false);
        });

        it("blank is invalid but shows NO error", () => {
            expect(v("")).toEqual({ amount: null, valid: false, showError: false });
            expect(v("   ")).toEqual({ amount: null, valid: false, showError: false });
        });

        it('"5." is valid and means 5', () => {
            expect(v("5.")).toEqual({ amount: 5, valid: true, showError: false });
        });

        it('"." is invalid and shows the error', () => {
            expect(v(".")).toEqual({ amount: null, valid: false, showError: true });
        });

        it('"1.234" is rounded to 2 dp (server rule Math.round(x*100)/100) and is valid', () => {
            expect(v("1.234")).toEqual({ amount: 1.23, valid: true, showError: false });
            expect(v("1.236").amount).toBe(1.24);
        });

        it("a value that rounds to 0.00 is invalid (the server would 400)", () => {
            expect(v("0.004")).toEqual({ amount: 0, valid: false, showError: true });
        });

        it("more than the held amount is invalid; exactly the held amount is valid", () => {
            expect(v("50.01")).toEqual({ amount: 50.01, valid: false, showError: true });
            expect(v("51").valid).toBe(false);
            expect(v("50")).toEqual({ amount: 50, valid: true, showError: false });
            expect(v("49.99").valid).toBe(true);
        });

        it("a fractional held amount is honoured; sub-cent excess rounds away", () => {
            expect(v("12.5", 12.5).valid).toBe(true);
            expect(v("12.51", 12.5).valid).toBe(false);
            expect(v("50.004", 50).valid).toBe(true); // rounds to 50.00
        });

        it("with the held amount unknown there is no upper bound client-side", () => {
            expect(v("99999", null)).toEqual({ amount: 99999, valid: true, showError: false });
            expect(v("0", null).valid).toBe(false);
        });
    });

    describe("texts", () => {
        it("formatPlainAmount prints integers without decimals and decimals as-is", () => {
            expect(formatPlainAmount(20)).toBe("20");
            expect(formatPlainAmount(20.0)).toBe("20");
            expect(formatPlainAmount(12.5)).toBe("12.5");
            expect(formatPlainAmount(12.34)).toBe("12.34");
            expect(formatPlainAmount(0.1 + 0.2)).toBe("0.3"); // no float noise
        });

        it("supporting text, verbatim (U5)", () => {
            expect(refundAmountSupportText(false, 50)).toBe("The client gets this back; you keep the rest of ₹50.");
            expect(refundAmountSupportText(false, 12.5)).toBe("The client gets this back; you keep the rest of ₹12.5.");
            expect(refundAmountSupportText(false, null)).toBe("The client gets this back; you keep the remainder.");
            expect(refundAmountSupportText(true, 50)).toBe("Enter an amount greater than 0 and at most ₹50.");
            expect(refundAmountSupportText(true, null)).toBe("Enter an amount greater than 0.");
        });
    });
});
