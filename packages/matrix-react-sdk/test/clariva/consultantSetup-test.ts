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

import ToastStore from "../../src/stores/ToastStore";
import {
    type ConsultantSetupForm,
    EMPTY_CONSULTANT_SETUP,
    hasAnythingToSave,
    isSetupReady,
    isSetupValid,
    maxCreditsError,
    maxCreditsValue,
    resumeSetup,
    saveConsultantSetup,
    type SetupSaveApi,
    setupFailureText,
    setupToSave,
    showSetupFailure,
    skipSetup,
    unsavedSetupFailure,
    withSetupField,
} from "../../src/clariva/session/consultantSetup";
import { configureClariva, installFakeApi, mockResponse } from "./helpers";

const bank: Partial<ConsultantSetupForm> = {
    accountHolderName: "Jane Doe",
    bankName: "State Bank of India",
    accountNumber: "123456789012",
    ifscCode: "sbin0001234",
};
const form = (over: Partial<ConsultantSetupForm> = {}): ConsultantSetupForm => ({ ...EMPTY_CONSULTANT_SETUP, ...over });

describe("consultant setup form (Android ConsultantSetupForm.kt)", () => {
    it("max credits: empty is fine (set later), 1..100000 is a value, anything else an error", () => {
        expect(maxCreditsValue(form())).toBeNull();
        expect(maxCreditsError(form())).toBeNull();
        expect(maxCreditsValue(form({ maxCredits: "50" }))).toBe(50);
        expect(maxCreditsValue(form({ maxCredits: "100000" }))).toBe(100000);
        expect(maxCreditsError(form({ maxCredits: "0" }))).toBe("Enter a whole number from 1 to 100000");
        expect(maxCreditsError(form({ maxCredits: "100001" }))).toBe("Enter a whole number from 1 to 100000");
    });

    it("keystrokes: max credits digits only, at most 6; bank fields use the shared filter", () => {
        expect(withSetupField(form(), "maxCredits", "1,2a34567").maxCredits).toBe("123456");
        expect(withSetupField(form(), "ifscCode", "sbin 0001234").ifscCode).toBe("SBIN0001234");
    });

    it("empty, fully valid, or skipped is valid; half a bank account or a bad rate is not", () => {
        expect(isSetupValid(form())).toBe(true);
        expect(isSetupValid(form({ ...bank, maxCredits: "50" }))).toBe(true);
        expect(isSetupValid(form({ accountNumber: "123456789" }))).toBe(false);
        expect(isSetupValid(form({ maxCredits: "0" }))).toBe(false);
        expect(isSetupValid({ ...form({ maxCredits: "0" }), isSkipped: true })).toBe(true);
    });

    it("ready also waits for an IFSC lookup that blocks (checking / not found), unless skipped", () => {
        expect(isSetupReady(form({ ...bank }), true)).toBe(false);
        expect(isSetupReady(form({ ...bank }), false)).toBe(true);
        expect(isSetupReady(skipSetup(), true)).toBe(true);
    });

    it("skip drops what was typed; resume brings the fields back", () => {
        const skipped = skipSetup();
        expect(skipped).toEqual({ ...EMPTY_CONSULTANT_SETUP, isSkipped: true });
        expect(hasAnythingToSave(skipped)).toBe(false);
        expect(resumeSetup(skipped).isSkipped).toBe(false);
    });

    it("only a consultant with something typed has anything to save", () => {
        expect(setupToSave(true, form())).toBeNull();
        expect(setupToSave(false, form({ maxCredits: "50" }))).toBeNull();
        expect(setupToSave(true, form({ maxCredits: "50" }))?.maxCredits).toBe("50");
        expect(setupToSave(true, form({ branchName: "MG Road" }))).not.toBeNull();
    });
});

describe("saveConsultantSetup", () => {
    const fakeApi = (over: Partial<SetupSaveApi> = {}): jest.Mocked<SetupSaveApi> =>
        ({
            updateMaxCredits: jest.fn().mockResolvedValue({}),
            saveBankDetails: jest.fn().mockResolvedValue({}),
            ...over,
        }) as jest.Mocked<SetupSaveApi>;

    it("saves the rate and the bank account (with the sign-up JWT) and reports nothing on success", async () => {
        const api = fakeApi();
        const result = await saveConsultantSetup({
            matrixUserId: "@jane:clarivahub.com",
            jwt: "jwt-1",
            setup: form({ ...bank, maxCredits: "50" }),
            api,
        });
        expect(result).toBeNull();
        expect(api.updateMaxCredits).toHaveBeenCalledWith("@jane:clarivahub.com", 50, 10_000);
        expect(api.saveBankDetails).toHaveBeenCalledWith(
            "jwt-1",
            {
                accountHolderName: "Jane Doe",
                bankName: "State Bank of India",
                accountNumber: "123456789012",
                ifscCode: "SBIN0001234",
            },
            10_000,
        );
    });

    it("runs both in parallel", async () => {
        const order: string[] = [];
        let releaseRate!: () => void;
        const api = fakeApi({
            updateMaxCredits: jest.fn(
                () =>
                    new Promise<void>((resolve) => {
                        order.push("rate started");
                        releaseRate = resolve;
                    }),
            ),
            saveBankDetails: jest.fn(async () => {
                order.push("bank started");
            }),
        });
        const pending = saveConsultantSetup({
            matrixUserId: "@j:x",
            jwt: "jwt",
            setup: form({ ...bank, maxCredits: "5" }),
            api,
        });
        await Promise.resolve();
        expect(order).toEqual(["rate started", "bank started"]);
        releaseRate();
        await expect(pending).resolves.toBeNull();
    });

    it("maps failures to rate / bank / both, and never throws", async () => {
        const fail = jest.fn().mockRejectedValue(new Error("nope"));
        const setup = form({ ...bank, maxCredits: "50" });
        expect(
            await saveConsultantSetup({
                matrixUserId: "@j:x",
                jwt: "t",
                setup,
                api: fakeApi({ updateMaxCredits: fail }),
            }),
        ).toBe("rate");
        expect(
            await saveConsultantSetup({
                matrixUserId: "@j:x",
                jwt: "t",
                setup,
                api: fakeApi({ saveBankDetails: fail }),
            }),
        ).toBe("bank");
        expect(
            await saveConsultantSetup({
                matrixUserId: "@j:x",
                jwt: "t",
                setup,
                api: fakeApi({ updateMaxCredits: fail, saveBankDetails: fail }),
            }),
        ).toBe("both");
    });

    it("without a JWT the bank account counts as not saved (nothing is sent)", async () => {
        const api = fakeApi();
        expect(await saveConsultantSetup({ matrixUserId: "@j:x", jwt: null, setup: form({ ...bank }), api })).toBe(
            "bank",
        );
        expect(api.saveBankDetails).not.toHaveBeenCalled();
    });

    it("only what was typed is saved", async () => {
        const api = fakeApi();
        await saveConsultantSetup({ matrixUserId: "@j:x", jwt: "t", setup: form({ maxCredits: "9" }), api });
        expect(api.saveBankDetails).not.toHaveBeenCalled();
        await saveConsultantSetup({ matrixUserId: "@j:x", jwt: "t", setup: form({ ...bank }), api });
        expect(api.updateMaxCredits).toHaveBeenCalledTimes(1);
    });

    it("each call is bounded: a hung request counts as not saved after the timeout", async () => {
        jest.useFakeTimers();
        try {
            const api = fakeApi({ updateMaxCredits: jest.fn(() => new Promise(() => {})) });
            const pending = saveConsultantSetup({
                matrixUserId: "@j:x",
                jwt: "t",
                setup: form({ ...bank, maxCredits: "50" }),
                api,
            });
            // let the bank save (which answers at once) settle before the clock jumps
            for (let i = 0; i < 5; i++) await Promise.resolve();
            jest.advanceTimersByTime(9_999);
            for (let i = 0; i < 5; i++) await Promise.resolve();
            let settled = false;
            void pending.then(() => (settled = true));
            for (let i = 0; i < 5; i++) await Promise.resolve();
            expect(settled).toBe(false);
            jest.advanceTimersByTime(1);
            await expect(pending).resolves.toBe("rate");
        } finally {
            jest.useRealTimers();
        }
    });

    it("by default: PATCH v1/users/<id> {max_credits} and POST v1/experts/me/bank-details with Bearer <jwt>", async () => {
        configureClariva();
        const fetch = installFakeApi({
            "PATCH /v1/users/%40jane%3Aclarivahub.com": () => mockResponse(200, {}),
            "PATCH /v1/users/@jane:clarivahub.com": () => mockResponse(200, {}),
            "POST /v1/experts/me/bank-details": () => mockResponse(201, { id: "b1", accountNumberLast4: "9012" }),
        });
        const result = await saveConsultantSetup({
            matrixUserId: "@jane:clarivahub.com",
            jwt: "jwt-1",
            setup: form({ ...bank, maxCredits: "50" }),
        });
        expect(result).toBeNull();
        const patch = fetch.mock.calls.find(([, init]) => init.method === "PATCH");
        expect(JSON.parse(patch[1].body)).toEqual({ max_credits: 50 });
        const post = fetch.mock.calls.find(([, init]) => init.method === "POST");
        expect(post[1].headers.Authorization).toBe("Bearer jwt-1");
        expect(JSON.parse(post[1].body).ifscCode).toBe("SBIN0001234");
    });
});

describe("failure notice", () => {
    it("a setup that was never saved fails for exactly what it asked for", () => {
        expect(unsavedSetupFailure(null)).toBeNull();
        expect(unsavedSetupFailure(form())).toBeNull();
        expect(unsavedSetupFailure(form({ ...bank, maxCredits: "50", isSkipped: true }))).toBeNull();
        expect(unsavedSetupFailure(form({ maxCredits: "50" }))).toBe("rate");
        expect(unsavedSetupFailure(form(bank))).toBe("bank");
        expect(unsavedSetupFailure(form({ ...bank, maxCredits: "50" }))).toBe("both");
    });

    it("Android's snackbar copy", () => {
        expect(setupFailureText(null)).toBeNull();
        expect(setupFailureText("rate")).toBe(
            "Account created, but your chat rate wasn't saved. Set it in Settings › Billing and payments.",
        );
        expect(setupFailureText("bank")).toBe(
            "Account created, but your bank details weren't saved. Please add them again later.",
        );
        expect(setupFailureText("both")).toBe(
            "Account created, but your chat rate and bank details weren't saved. Please add them again later.",
        );
    });

    it("is one global toast, and nothing at all on success", () => {
        const store = ToastStore.sharedInstance();
        store.reset();
        showSetupFailure(null);
        expect(store.getToasts()).toHaveLength(0);
        showSetupFailure("bank");
        showSetupFailure("bank");
        expect(store.getToasts()).toHaveLength(1);
        expect(store.getToasts()[0].props?.description).toBe(setupFailureText("bank"));
        store.reset();
    });
});
