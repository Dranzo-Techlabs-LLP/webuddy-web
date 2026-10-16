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
    MAX_CREDITS_LIMIT,
    canSave,
    displayedValue,
    isDirty,
    isTooLarge,
    parseDraft,
    sanitizeMaxCreditsInput,
} from "../../src/clariva/wallet/maxCredits";
import {
    EMPTY_BANK_FORM,
    canSaveBankForm,
    normalizeBankForm,
    sameBankForm,
    toBankDetailsBody,
    validateBankForm,
    type BankForm,
} from "../../src/clariva/wallet/bankDetails";

describe("max credits draft logic (spec 02 section 3.8)", () => {
    it("digits only: typed or pasted garbage is stripped", () => {
        expect(sanitizeMaxCreditsInput("1a2b3")).toBe("123");
        expect(sanitizeMaxCreditsInput("1,000")).toBe("1000");
        expect(sanitizeMaxCreditsInput("-5")).toBe("5");
        expect(sanitizeMaxCreditsInput("")).toBe("");
        expect(sanitizeMaxCreditsInput("123456789012")).toBe("12345678"); // 8 digits max (DECIMAL(10,2))
    });

    it("an untouched draft shows the saved value, a touched one shows what was typed", () => {
        expect(displayedValue(null, 100)).toBe("100");
        expect(displayedValue(null, 99.9)).toBe("99");
        expect(displayedValue(null, null)).toBe("");
        expect(displayedValue("150", 100)).toBe("150");
        expect(displayedValue("", 100)).toBe(""); // the user cleared the field: keep it empty
    });

    it("dirty = non-empty and different from the saved value", () => {
        expect(isDirty(null, 100)).toBe(false);
        expect(isDirty("", 100)).toBe(false); // empty hides Save/Cancel
        expect(isDirty("100", 100)).toBe(false);
        expect(isDirty("0100", 100)).toBe(false); // compared as numbers
        expect(isDirty("150", 100)).toBe(true);
        expect(isDirty("0", 100)).toBe(true);
        expect(isDirty("5", null)).toBe(true); // saved value unknown
    });

    it("a poll that changes the saved value moves the baseline, never the draft", () => {
        const draft = "150";
        expect(isDirty(draft, 100)).toBe(true);
        expect(displayedValue(draft, 100)).toBe("150");
        // the server value changed to 120 while the user was typing
        expect(displayedValue(draft, 120)).toBe("150");
        expect(isDirty(draft, 120)).toBe(true);
        // and if the server caught up with the draft, nothing is left to save
        expect(isDirty(draft, 150)).toBe(false);
    });

    it("parseDraft accepts whole numbers within what the column can store", () => {
        expect(parseDraft("0")).toBe(0);
        expect(parseDraft("150")).toBe(150);
        expect(parseDraft(String(MAX_CREDITS_LIMIT))).toBe(MAX_CREDITS_LIMIT);
        expect(parseDraft(String(MAX_CREDITS_LIMIT + 1))).toBeNull();
        expect(parseDraft("")).toBeNull();
        expect(parseDraft(null)).toBeNull();
        expect(parseDraft("1.5")).toBeNull();
    });

    it("too large is reported (Android's silent no-op above Int range is not copied)", () => {
        expect(isTooLarge("100000000")).toBe(true);
        expect(isTooLarge("99999999")).toBe(false);
        expect(isTooLarge(null)).toBe(false);
    });

    it("canSave needs a dirty valid draft and no save in flight", () => {
        expect(canSave("150", 100, false)).toBe(true);
        expect(canSave("150", 100, true)).toBe(false);
        expect(canSave("100", 100, false)).toBe(false);
        expect(canSave("", 100, false)).toBe(false);
        expect(canSave("100000000", 100, false)).toBe(false);
    });
});

describe("bank details form logic (spec 02 section 2.7, 7.2.7)", () => {
    const good: BankForm = {
        bankName: " State Bank of India ",
        accountNumber: "1234 5678 9012",
        ifscCode: " sbin0001234 ",
        accountHolderName: "A. Consultant",
        branchName: "Main Branch",
    };

    it("starts empty, so Save Details is disabled", () => {
        expect(canSaveBankForm(EMPTY_BANK_FORM, false)).toBe(false);
        expect(Object.keys(validateBankForm(EMPTY_BANK_FORM))).toHaveLength(5);
    });

    it("a complete, well formed form can be saved (once, not while saving)", () => {
        expect(validateBankForm(good)).toEqual({});
        expect(canSaveBankForm(good, false)).toBe(true);
        expect(canSaveBankForm(good, true)).toBe(false);
    });

    it("whitespace-only counts as blank", () => {
        expect(validateBankForm({ ...good, bankName: "   " }).bankName).toBeDefined();
        expect(canSaveBankForm({ ...good, branchName: " " }, false)).toBe(false);
    });

    it("checks the IFSC shape and that the account number is digits", () => {
        expect(validateBankForm({ ...good, ifscCode: "SBIN1001234" }).ifscCode).toBeDefined(); // 5th char must be 0
        expect(validateBankForm({ ...good, ifscCode: "SBIN000123" }).ifscCode).toBeDefined(); // too short
        expect(validateBankForm({ ...good, accountNumber: "12AB5678" }).accountNumber).toBeDefined();
        expect(validateBankForm({ ...good, accountNumber: "123" }).accountNumber).toBeDefined(); // too short
    });

    it("normalises what is sent: trimmed, IFSC upper-cased, account number without spaces", () => {
        expect(normalizeBankForm(good)).toEqual({
            bankName: "State Bank of India",
            accountNumber: "123456789012",
            ifscCode: "SBIN0001234",
            accountHolderName: "A. Consultant",
            branchName: "Main Branch",
        });
    });

    it("builds the request body with the Matrix id as expertId", () => {
        expect(toBankDetailsBody("@rao:clarivahub.com", good)).toEqual({
            expertId: "@rao:clarivahub.com",
            bankName: "State Bank of India",
            accountNumber: "123456789012",
            ifscCode: "SBIN0001234",
            accountHolderName: "A. Consultant",
            branchName: "Main Branch",
        });
    });

    it("sameBankForm ignores cosmetic differences", () => {
        expect(sameBankForm(good, { ...good, ifscCode: "SBIN0001234", bankName: "State Bank of India" })).toBe(true);
        expect(sameBankForm(good, { ...good, branchName: "Other" })).toBe(false);
    });
});
