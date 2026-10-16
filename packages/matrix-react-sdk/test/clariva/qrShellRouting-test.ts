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

// the Element Web shell (src/vector) is compiled with the SDK's jest setup: the shell's own jest config cannot
// transform the hoisted matrix-js-sdk sources in this workspace layout
import { getInitialScreenAfterLogin, onNewScreen } from "../../../../src/vector/routing";
import { rewriteUserDeepLink } from "../../src/clariva/qr/deepLink";
import { peekPendingDeepLink, stashPendingDeepLink } from "../../src/clariva/qr/pendingDeepLink";

/**
 * Clariva: a `/u/<mxid>` user link (QR code / "Share link") must open that user's profile, also when the visitor has
 * to sign in first. The pure logic is tested in qrDeepLink-test.ts; this file covers the shell wiring
 * (src/vector/index.ts + routing.ts).
 */
describe("Clariva user deep link in the shell", () => {
    const JANE = "@jane:clarivahub.com";

    const makeLocation = (hash = "") => {
        const url = new URL("https://app.test.org");
        url.hash = hash;
        return url as unknown as Location;
    };

    beforeEach(() => {
        sessionStorage.clear();
    });

    describe("/u/<mxid> -> #/user/<mxid>", () => {
        it("the path form becomes the fragment route that getInitialScreenAfterLogin hands to MatrixChat", () => {
            const target = {
                location: { pathname: "/u/%40jane%3Aclarivahub.com", search: "", hash: "" },
                history: { replaceState: jest.fn() },
            };
            expect(rewriteUserDeepLink(target)).toMatchObject({ userId: JANE });
            expect(target.history.replaceState).toHaveBeenCalledWith(null, "", "/#/user/%40jane%3Aclarivahub.com");

            // what the browser shows after the rewrite is parsed by the stock fragment routing
            expect(getInitialScreenAfterLogin(makeLocation("#/user/%40jane%3Aclarivahub.com"))).toEqual({
                screen: "user/@jane:clarivahub.com",
                params: {},
            });
        });
    });

    describe("surviving the sign-in", () => {
        it("a reload onto the sign-in screen does not lose the pending link", () => {
            stashPendingDeepLink(JANE);
            // the fragment is now #/login (MatrixChat navigated there), Element would overwrite the stored screen
            expect(getInitialScreenAfterLogin(makeLocation("#/login"))).toEqual({
                screen: "user/@jane:clarivahub.com",
                params: {},
            });
            expect(peekPendingDeepLink()).toBe(JANE); // still pending until the profile is shown
        });

        it("a newer real destination wins over the pending link", () => {
            stashPendingDeepLink(JANE);
            expect(getInitialScreenAfterLogin(makeLocation("#/room/!abc:clarivahub.com"))).toEqual({
                screen: "room/!abc:clarivahub.com",
                params: {},
            });
        });

        it("without a pending link the stock behaviour is unchanged", () => {
            expect(getInitialScreenAfterLogin(makeLocation("#/login"))).toEqual({ screen: "login", params: {} });
            expect(getInitialScreenAfterLogin(makeLocation(""))).toEqual({ screen: "login", params: {} }); // from storage
        });

        it("showing the user's profile completes the delivery", () => {
            stashPendingDeepLink(JANE);
            Object.defineProperty(window, "location", {
                value: { hash: "", replace: jest.fn(), assign: jest.fn() },
                writable: true,
            });
            onNewScreen("home");
            expect(peekPendingDeepLink()).toBe(JANE);
            onNewScreen("user/@jane:clarivahub.com");
            expect(peekPendingDeepLink()).toBeNull();
        });
    });
});
