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

import { parseUserDeepLinkPath, rewriteUserDeepLink, userDeepLinkHash } from "../../src/clariva/qr/deepLink";
import {
    clearPendingDeepLink,
    noteScreenShown,
    PENDING_DEEP_LINK_KEY,
    PENDING_DEEP_LINK_TTL_MS,
    peekPendingDeepLink,
    pendingDeepLinkScreen,
    stashPendingDeepLink,
    userScreen,
    withPendingDeepLink,
} from "../../src/clariva/qr/pendingDeepLink";

const JANE = "@jane:clarivahub.com";
const JANE_PATH = "/u/%40jane%3Aclarivahub.com";

describe("/u/<mxid> deep link (spec 04 §3.17 / §6.12)", () => {
    beforeEach(() => sessionStorage.clear());

    describe("parseUserDeepLinkPath", () => {
        it("turns the path form into the Element fragment route", () => {
            expect(parseUserDeepLinkPath(JANE_PATH)).toEqual({
                userId: JANE,
                hash: "#/user/%40jane%3Aclarivahub.com",
            });
            expect(userDeepLinkHash(JANE)).toBe("#/user/%40jane%3Aclarivahub.com");
        });

        it("accepts an unencoded id and trailing segments, like Android's pathSegments", () => {
            expect(parseUserDeepLinkPath("/u/@jane:clarivahub.com")?.userId).toBe(JANE);
            expect(parseUserDeepLinkPath(`${JANE_PATH}/`)?.userId).toBe(JANE);
            expect(parseUserDeepLinkPath(`${JANE_PATH}/more`)?.userId).toBe(JANE);
        });

        it("round-trips ids with characters that need percent-encoding", () => {
            const id = "@a+b=c/d:example.org:8448";
            expect(parseUserDeepLinkPath("/u/" + encodeURIComponent(id))?.userId).toBe(id);
        });

        it.each([
            ["the root", "/"],
            ["/u", "/u"],
            ["/u/", "/u/"],
            ["another route", "/room/%21abc%3Aclarivahub.com"],
            ["a nested /u", "/app/u/%40jane%3Aclarivahub.com"],
            ["an upper-case /U", "/U/%40jane%3Aclarivahub.com"],
            ["an id without @", "/u/jane%3Aclarivahub.com"],
            ["an id without a server", "/u/%40jane"],
            ["malformed percent-encoding", "/u/%E0%A4%A"],
            ["a hostile id", "/u/%40ja%E2%80%AEne%3Aclarivahub.com"],
            ["a room id", "/u/%21abc%3Aclarivahub.com"],
        ])("ignores %s", (_name, path) => {
            expect(parseUserDeepLinkPath(path)).toBeNull();
        });
    });

    describe("rewriteUserDeepLink", () => {
        const target = (pathname: string, search = "", hash = "") => ({
            location: { pathname, search, hash },
            history: { replaceState: jest.fn() },
        });

        it("replaces the URL by /#/user/<id> without adding a history entry and remembers the link", () => {
            const t = target(JANE_PATH, "?utm=qr");
            expect(rewriteUserDeepLink(t)).toEqual({ userId: JANE, hash: "#/user/%40jane%3Aclarivahub.com" });
            expect(t.history.replaceState).toHaveBeenCalledTimes(1);
            expect(t.history.replaceState).toHaveBeenCalledWith(null, "", "/#/user/%40jane%3Aclarivahub.com");
            expect(peekPendingDeepLink()).toBe(JANE);
        });

        it("does nothing for any other URL", () => {
            const t = target("/", "", "#/room/!abc:clarivahub.com");
            expect(rewriteUserDeepLink(t)).toBeNull();
            expect(t.history.replaceState).not.toHaveBeenCalled();
            expect(peekPendingDeepLink()).toBeNull();
        });

        it("never throws (e.g. a sandboxed frame where replaceState is forbidden)", () => {
            const t = target(JANE_PATH);
            t.history.replaceState.mockImplementation(() => {
                throw new DOMException("denied", "SecurityError");
            });
            expect(rewriteUserDeepLink(t)).toBeNull();
        });

        it("works against the real jsdom window", () => {
            window.history.replaceState(null, "", JANE_PATH);
            try {
                expect(rewriteUserDeepLink()).toMatchObject({ userId: JANE });
                expect(window.location.pathname).toBe("/");
                expect(window.location.hash).toBe("#/user/%40jane%3Aclarivahub.com");
            } finally {
                window.history.replaceState(null, "", "/");
            }
        });
    });

    describe("pending link across the sign-in", () => {
        it("stashes, peeks and clears", () => {
            expect(peekPendingDeepLink()).toBeNull();
            stashPendingDeepLink(JANE);
            expect(peekPendingDeepLink()).toBe(JANE);
            expect(pendingDeepLinkScreen()).toEqual({ screen: "user/@jane:clarivahub.com", params: {} });
            clearPendingDeepLink();
            expect(peekPendingDeepLink()).toBeNull();
            expect(pendingDeepLinkScreen()).toBeUndefined();
        });

        it("forgets a link that was never delivered after 30 minutes", () => {
            const t0 = 1_000_000;
            stashPendingDeepLink(JANE, t0);
            expect(peekPendingDeepLink(t0 + PENDING_DEEP_LINK_TTL_MS)).toBe(JANE);
            expect(peekPendingDeepLink(t0 + PENDING_DEEP_LINK_TTL_MS + 1)).toBeNull();
            expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull(); // expired records are removed
        });

        it("does not trust a record from the future (clock moved backwards)", () => {
            stashPendingDeepLink(JANE, 10_000_000);
            expect(peekPendingDeepLink(1_000)).toBeNull();
        });

        it.each([["not json"], ["null"], ['{"userId":5,"storedAt":1}'], ['{"userId":"@a:b.c"}']])(
            "ignores a corrupt record (%s)",
            (raw) => {
                sessionStorage.setItem(PENDING_DEEP_LINK_KEY, raw);
                expect(peekPendingDeepLink()).toBeNull();
                expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
            },
        );

        it("never throws when sessionStorage is unavailable", () => {
            const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
                throw new DOMException("quota", "QuotaExceededError");
            });
            const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
                throw new DOMException("denied", "SecurityError");
            });
            try {
                expect(() => stashPendingDeepLink(JANE)).not.toThrow();
                expect(peekPendingDeepLink()).toBeNull();
                expect(() => clearPendingDeepLink()).not.toThrow();
            } finally {
                set.mockRestore();
                get.mockRestore();
            }
        });

        it("noteScreenShown clears the link once a user profile is shown, but not for sign-in screens", () => {
            stashPendingDeepLink(JANE);
            noteScreenShown("login");
            noteScreenShown("welcome");
            noteScreenShown("home");
            expect(peekPendingDeepLink()).toBe(JANE);
            noteScreenShown(userScreen(JANE));
            expect(peekPendingDeepLink()).toBeNull();
        });

        describe("withPendingDeepLink (screen handed to MatrixChat as the screen after login)", () => {
            it("keeps Element's own stored destination when it is a real screen", () => {
                stashPendingDeepLink(JANE);
                const room = { screen: "room/!abc:clarivahub.com", params: {} };
                expect(withPendingDeepLink(room)).toBe(room);
                const other = { screen: "user/@bob:clarivahub.com", params: {} };
                expect(withPendingDeepLink(other)).toBe(other);
            });

            it("restores the user link when a reload onto the sign-in screen overwrote the stored screen", () => {
                stashPendingDeepLink(JANE);
                for (const screen of ["login", "register", "welcome", "forgot_password", "soft_logout", ""]) {
                    expect(withPendingDeepLink({ screen, params: {} })).toEqual({
                        screen: "user/@jane:clarivahub.com",
                        params: {},
                    });
                }
                expect(withPendingDeepLink(undefined)).toEqual({ screen: "user/@jane:clarivahub.com", params: {} });
            });

            it("is a no-op without a pending link", () => {
                const login = { screen: "login", params: {} };
                expect(withPendingDeepLink(login)).toBe(login);
                expect(withPendingDeepLink(undefined)).toBeUndefined();
            });
        });
    });
});
