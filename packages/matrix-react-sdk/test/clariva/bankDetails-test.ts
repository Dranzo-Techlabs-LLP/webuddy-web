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

import { ClarivaHttpError } from "../../src/clariva/api/http";
import {
    accountNumberError,
    applyIfscAutofill,
    BankAccountRules,
    bankSaveErrorText,
    type BankForm,
    canSaveBankDetails,
    EMPTY_BANK_FORM,
    hasBankDetails,
    ifscError,
    isBankDetailsComplete,
    isBankDetailsIncomplete,
    sanitizeBankInput,
    savedAccountDetails,
    savedAccountTitle,
    toMyBankDetailsBody,
} from "../../src/clariva/wallet/bankDetails";

const good: BankForm = {
    accountHolderName: " Jane Doe ",
    bankName: " State Bank of India ",
    accountNumber: "123456789012",
    ifscCode: " sbin0001234 ",
    branchName: "",
};

describe("BankAccountRules (Android BankDetails.kt, the API's AddMyBankDetailDto)", () => {
    it("account numbers are 9 to 18 digits", () => {
        expect(BankAccountRules.isValidAccountNumber("12345678")).toBe(false);
        expect(BankAccountRules.isValidAccountNumber("123456789")).toBe(true);
        expect(BankAccountRules.isValidAccountNumber("123456789012345678")).toBe(true);
        expect(BankAccountRules.isValidAccountNumber("1234567890123456789")).toBe(false);
        expect(BankAccountRules.isValidAccountNumber("12345678A")).toBe(false);
        expect(BankAccountRules.isValidAccountNumber(" 123456789 ")).toBe(true); // trimmed
    });

    it("IFSC is 4 letters, a zero, 6 letters or digits, checked upper-cased", () => {
        expect(BankAccountRules.isValidIfsc("SBIN0001234")).toBe(true);
        expect(BankAccountRules.isValidIfsc(" sbin0001234 ")).toBe(true);
        expect(BankAccountRules.isValidIfsc("SBIN1001234")).toBe(false); // 5th char must be 0
        expect(BankAccountRules.isValidIfsc("SBIN000123")).toBe(false);
        expect(BankAccountRules.isValidIfsc("SB1N0001234")).toBe(false);
    });

    it("names need at least 2 characters after trimming", () => {
        expect(BankAccountRules.isValidName(" A ")).toBe(false);
        expect(BankAccountRules.isValidName("Al")).toBe(true);
    });
});

describe("keystroke filter", () => {
    it("account number: digits only, at most 18 (a pasted spaced number keeps its digits)", () => {
        expect(sanitizeBankInput("accountNumber", "1234 5678 9012")).toBe("123456789012");
        expect(sanitizeBankInput("accountNumber", "1".repeat(25))).toHaveLength(18);
    });

    it("IFSC: letters and digits only, upper-cased, at most 11", () => {
        expect(sanitizeBankInput("ifscCode", "sbin-000 1234xyz")).toBe("SBIN0001234");
    });

    it("text fields: no line breaks, at most 120 characters", () => {
        expect(sanitizeBankInput("bankName", "State\nBank")).toBe("StateBank");
        expect(sanitizeBankInput("accountHolderName", "x".repeat(130))).toHaveLength(120);
    });
});

describe("field errors only once something is typed", () => {
    it("Android's exact copy", () => {
        expect(accountNumberError("")).toBeNull();
        expect(accountNumberError("1234")).toBe("Account number must be 9 to 18 digits");
        expect(ifscError("")).toBeNull();
        expect(ifscError("SBIN")).toBe("IFSC code looks like ABCD0123456");
        expect(ifscError("sbin0001234")).toBeNull();
    });
});

describe("completeness and Save", () => {
    it("an empty form has nothing; any one field (even the optional branch) counts as started", () => {
        expect(hasBankDetails(EMPTY_BANK_FORM)).toBe(false);
        expect(hasBankDetails({ ...EMPTY_BANK_FORM, branchName: "MG Road" })).toBe(true);
        expect(hasBankDetails({ ...EMPTY_BANK_FORM, bankName: "  " })).toBe(false);
    });

    it("complete needs holder, bank, account number and IFSC; the branch is optional", () => {
        expect(isBankDetailsComplete(good)).toBe(true);
        expect(isBankDetailsComplete({ ...good, bankName: "S" })).toBe(false);
        expect(isBankDetailsIncomplete({ ...EMPTY_BANK_FORM, accountNumber: "123456789" })).toBe(true);
        expect(isBankDetailsIncomplete(EMPTY_BANK_FORM)).toBe(false);
        expect(isBankDetailsIncomplete(good)).toBe(false);
    });

    it("Save Details: valid, not saving, and an IFSC not blocked by the lookup", () => {
        expect(canSaveBankDetails(good, false, false)).toBe(true);
        expect(canSaveBankDetails(good, false, true)).toBe(false);
        expect(canSaveBankDetails(good, true, false)).toBe(false);
        expect(canSaveBankDetails(EMPTY_BANK_FORM, false, false)).toBe(false);
    });
});

describe("request body", () => {
    it("trims, upper-cases the IFSC, and omits a blank branch (never sent blank)", () => {
        expect(toMyBankDetailsBody(good)).toEqual({
            accountHolderName: "Jane Doe",
            bankName: "State Bank of India",
            accountNumber: "123456789012",
            ifscCode: "SBIN0001234",
        });
        expect(toMyBankDetailsBody({ ...good, branchName: " MG Road " }).branchName).toBe("MG Road");
    });
});

describe("IFSC autofill never overwrites what the user typed", () => {
    const found = { bank: "State Bank of India", branch: "Hajiganj" };

    it("fills blank fields", () => {
        expect(applyIfscAutofill({ bankName: "", branchName: " " }, found, null)).toEqual({
            bankName: "State Bank of India",
            branchName: "Hajiganj",
        });
    });

    it("keeps typed values", () => {
        expect(applyIfscAutofill({ bankName: "SBI", branchName: "Main" }, found, null)).toEqual({
            bankName: "SBI",
            branchName: "Main",
        });
    });

    it("replaces only what the previous lookup filled in", () => {
        const previous = { bank: "HDFC Bank", branch: "Fort" };
        expect(applyIfscAutofill({ bankName: "HDFC Bank", branchName: "My branch" }, found, previous)).toEqual({
            bankName: "State Bank of India",
            branchName: "My branch",
        });
    });

    it("keeps the other fields of the form", () => {
        const result = applyIfscAutofill({ ...good, bankName: "" }, found, null);
        expect(result.accountNumber).toBe(good.accountNumber);
        expect(result.bankName).toBe("State Bank of India");
    });
});

describe("saved account card", () => {
    const account = {
        bankName: "State Bank of India",
        accountNumberLast4: "9012",
        ifscCode: "SBIN0001234",
        accountHolderName: "Jane Doe",
        branchName: "MG Road",
    };

    it("shows the last 4 digits only", () => {
        expect(savedAccountTitle(account)).toBe("State Bank of India •••• 9012");
        expect(savedAccountDetails(account)).toBe("Jane Doe · IFSC SBIN0001234 · MG Road");
        expect(savedAccountDetails({ ...account, branchName: null })).toBe("Jane Doe · IFSC SBIN0001234");
    });
});

describe("save error text", () => {
    it("the API's own reason for a 4xx", () => {
        const e = new ClarivaHttpError(400, "HTTP 400", "http", "No bank branch found for IFSC ABCD0123456");
        expect(bankSaveErrorText(e)).toBe("No bank branch found for IFSC ABCD0123456");
    });

    it("the generic line for a 5xx, a network failure or anything else", () => {
        const generic = "Couldn't save your bank details. Check your connection and try again.";
        expect(bankSaveErrorText(new ClarivaHttpError(502, "HTTP 502", "http", "Bad gateway"))).toBe(generic);
        expect(bankSaveErrorText(new ClarivaHttpError(0, "offline", "network"))).toBe(generic);
        expect(bankSaveErrorText(new ClarivaHttpError(403, "HTTP 403", "http"))).toBe(generic);
        expect(bankSaveErrorText(new Error("boom"))).toBe(generic);
    });
});
