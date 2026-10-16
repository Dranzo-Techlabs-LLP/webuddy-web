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

import { focusLockWhitelist, loadRazorpay, resetRazorpayLoaderForTests } from "../../src/clariva/razorpay";

const URL = "https://checkout.razorpay.com/v1/checkout.js";
const tags = (): HTMLScriptElement[] => Array.from(document.querySelectorAll("script[data-clariva-razorpay]"));

class FakeCheckout {}

describe("loadRazorpay (Checkout.js on demand)", () => {
    beforeEach(() => {
        tags().forEach((t) => t.remove());
        delete (window as { Razorpay?: unknown }).Razorpay;
        resetRazorpayLoaderForTests();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("injects ONE script tag however many callers ask, and resolves them all", async () => {
        const a = loadRazorpay(URL);
        const b = loadRazorpay(URL);
        expect(tags()).toHaveLength(1);
        expect(tags()[0].src).toBe(URL);

        (window as { Razorpay?: unknown }).Razorpay = FakeCheckout;
        tags()[0].dispatchEvent(new Event("load"));
        await expect(a).resolves.toBe(FakeCheckout);
        await expect(b).resolves.toBe(FakeCheckout);
        expect(tags()).toHaveLength(1);
    });

    it("is idempotent once loaded: no new tag, immediate resolution", async () => {
        (window as { Razorpay?: unknown }).Razorpay = FakeCheckout;
        await expect(loadRazorpay(URL)).resolves.toBe(FakeCheckout);
        expect(tags()).toHaveLength(0);
    });

    it("rejects when the script errors, removes the broken tag, and a later call tries again", async () => {
        const first = loadRazorpay(URL);
        tags()[0].dispatchEvent(new Event("error"));
        await expect(first).rejects.toThrow(/Could not load/);
        expect(tags()).toHaveLength(0);

        const second = loadRazorpay(URL);
        expect(tags()).toHaveLength(1);
        (window as { Razorpay?: unknown }).Razorpay = FakeCheckout;
        tags()[0].dispatchEvent(new Event("load"));
        await expect(second).resolves.toBe(FakeCheckout);
    });

    it("rejects when the script loads but defines no Razorpay global", async () => {
        const p = loadRazorpay(URL);
        tags()[0].dispatchEvent(new Event("load"));
        await expect(p).rejects.toThrow(/did not define/);
        expect(tags()).toHaveLength(0);
    });

    it("times out after 20 s", async () => {
        jest.useFakeTimers();
        const p = loadRazorpay(URL);
        const assertion = expect(p).rejects.toThrow(/Timed out/);
        jest.advanceTimersByTime(20_001);
        await assertion;
        expect(tags()).toHaveLength(0);
    });
});

describe("focusLockWhitelist (lets the Razorpay iframe keep focus inside an Element dialog)", () => {
    it("excludes elements inside .razorpay-container and razorpay iframes, keeps everything else managed", () => {
        document.body.innerHTML = `
            <div id="dialog"><button id="inside">x</button></div>
            <div class="razorpay-container"><iframe id="frame" class="razorpay-checkout-frame"></iframe></div>
            <iframe id="other" src="https://checkout.razorpay.com/v1/checkout.html"></iframe>`;
        expect(focusLockWhitelist(document.getElementById("inside")!)).toBe(true);
        expect(focusLockWhitelist(document.getElementById("frame")!)).toBe(false);
        expect(focusLockWhitelist(document.getElementById("other")!)).toBe(false);
        document.body.innerHTML = "";
    });
});
