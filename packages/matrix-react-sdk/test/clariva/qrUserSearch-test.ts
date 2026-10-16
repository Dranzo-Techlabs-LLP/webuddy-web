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
    ClarivaUserSearch,
    EMPTY_SEARCH_STATE,
    planSearch,
    SEARCH_DEBOUNCE_MS,
    SEARCH_LIMIT,
    SEARCH_MIN_CHARS,
    serverNameOf,
    type DirectoryResult,
    type SearchDeps,
    type SearchState,
    type UserProfile,
} from "../../src/clariva/qr/userSearch";
import { ME } from "./helpers";

describe("Clariva user search (spec 04 §3.15)", () => {
    it("uses Android's constants", () => {
        expect(SEARCH_MIN_CHARS).toBe(3);
        expect(SEARCH_DEBOUNCE_MS).toBe(250);
        expect(SEARCH_LIMIT).toBe(10);
    });

    describe("planSearch", () => {
        it("trims the query and applies the 3 character minimum to the trimmed text", () => {
            expect(planSearch("  abc  ", ME).trimmed).toBe("abc");
            expect(planSearch("  abc  ", ME).shouldFetch).toBe(true);
            expect(planSearch("ab", ME).shouldFetch).toBe(false);
            expect(planSearch("  a b  ", ME).shouldFetch).toBe(true); // "a b" is 3 characters
            expect(planSearch("", ME).shouldFetch).toBe(false);
        });

        it("recognises an explicit Matrix id, but never my own", () => {
            expect(planSearch("@jane:clarivahub.com", ME)).toMatchObject({ isFullUserId: true, derivedUserId: null });
            expect(planSearch(ME, ME)).toMatchObject({ isFullUserId: false, derivedUserId: null });
            expect(planSearch("@jane", ME).isFullUserId).toBe(false);
        });

        it("derives @<lower-cased username>:<my server> for a bare username", () => {
            expect(planSearch("mohamed.shimil4", ME).derivedUserId).toBe("@mohamed.shimil4:clarivahub.com");
            expect(planSearch("Mohamed.Shimil4", ME).derivedUserId).toBe("@mohamed.shimil4:clarivahub.com");
            expect(planSearch("a_b-c=d/e+f", ME).derivedUserId).toBe("@a_b-c=d/e+f:clarivahub.com");
        });

        it("takes the server name from the session user id (incl. a port), never from a constant", () => {
            expect(planSearch("jane", "@me:other.org").derivedUserId).toBe("@jane:other.org");
            expect(planSearch("jane", "@me:clarivahub.com:8448").derivedUserId).toBe("@jane:clarivahub.com:8448");
            expect(serverNameOf("@me:clarivahub.com:8448")).toBe("clarivahub.com:8448");
            expect(planSearch("jane", "no-colon").derivedUserId).toBeNull();
        });

        it("derives nothing for free text, e-mail addresses, my own username or an explicit id", () => {
            expect(planSearch("john smith", ME).derivedUserId).toBeNull();
            expect(planSearch("jane@example.org", ME).derivedUserId).toBeNull();
            expect(planSearch("me", ME).derivedUserId).toBeNull(); // would be myself
            expect(planSearch("jane!", ME).derivedUserId).toBeNull();
            expect(planSearch("@jane:clarivahub.com", ME).derivedUserId).toBeNull();
        });
    });

    describe("ClarivaUserSearch", () => {
        let states: SearchState[];
        let searchDirectory: jest.Mock<Promise<DirectoryResult[]>, [string, number]>;
        let getProfile: jest.Mock<Promise<UserProfile | null | undefined>, [string]>;
        let search: ClarivaUserSearch;

        const row = (id: string, name?: string): DirectoryResult => ({ user_id: id, display_name: name });
        const last = (): SearchState => states[states.length - 1];
        const settle = async (ms = SEARCH_DEBOUNCE_MS): Promise<void> => {
            await jest.advanceTimersByTimeAsync(ms);
        };

        beforeEach(() => {
            jest.useFakeTimers();
            states = [];
            searchDirectory = jest.fn<Promise<DirectoryResult[]>, [string, number]>(async () => []);
            getProfile = jest.fn<Promise<UserProfile | null | undefined>, [string]>(async () => {
                throw new Error("M_NOT_FOUND");
            });
            const deps: SearchDeps = {
                myUserId: ME,
                searchDirectory,
                getProfile,
                onState: (s) => states.push(s),
            };
            search = new ClarivaUserSearch(deps);
        });

        afterEach(() => {
            search.dispose();
            jest.useRealTimers();
        });

        it("emits nothing but an empty state below 3 characters and never calls the server", async () => {
            search.update("ab");
            await settle(1000);
            expect(states).toEqual([EMPTY_SEARCH_STATE]);
            expect(searchDirectory).not.toHaveBeenCalled();
            expect(getProfile).not.toHaveBeenCalled();
        });

        it("waits for the 250 ms debounce before it asks the directory (limit 10)", async () => {
            search.update("abc");
            expect(last()).toEqual({ top: [], directory: [], isSearching: true }); // emit #1: spinner

            await settle(SEARCH_DEBOUNCE_MS - 1);
            expect(searchDirectory).not.toHaveBeenCalled();

            await settle(1);
            expect(searchDirectory).toHaveBeenCalledTimes(1);
            expect(searchDirectory).toHaveBeenCalledWith("abc", 10);
            expect(last()).toEqual({ top: [], directory: [], isSearching: false });
        });

        it("is a real debounce: only the last keystroke reaches the server", async () => {
            search.update("abc");
            await settle(100);
            search.update("abcd");
            await settle(100);
            search.update("abcde");
            await settle(SEARCH_DEBOUNCE_MS);
            expect(searchDirectory).toHaveBeenCalledTimes(1);
            expect(searchDirectory).toHaveBeenCalledWith("abcde", 10);
        });

        it("sends the trimmed term", async () => {
            search.update("   jane   ");
            await settle();
            expect(searchDirectory).toHaveBeenCalledWith("jane", 10);
        });

        it("clears stale results when the query drops below the minimum again", async () => {
            searchDirectory.mockResolvedValue([row("@abby:clarivahub.com", "Abby")]);
            search.update("abb");
            await settle();
            expect(last().directory).toHaveLength(1);
            search.update("ab");
            expect(last()).toEqual(EMPTY_SEARCH_STATE);
        });

        it("returns directory rows without me, in server order", async () => {
            searchDirectory.mockResolvedValue([
                row("@zed:clarivahub.com", "Zed"),
                row(ME, "Me"),
                row("@amy:clarivahub.com"),
            ]);
            search.update("clar");
            await settle();
            expect(last().directory.map((r) => r.userId)).toEqual(["@zed:clarivahub.com", "@amy:clarivahub.com"]);
            expect(last().directory[0]).toMatchObject({ displayName: "Zed" });
        });

        it("treats a failing directory search as no results", async () => {
            searchDirectory.mockRejectedValue(new Error("500"));
            search.update("abc");
            await settle();
            expect(last()).toEqual({ top: [], directory: [], isSearching: false });
        });

        it("survives a directory search that throws synchronously", async () => {
            searchDirectory.mockImplementation(() => {
                throw new Error("boom");
            });
            search.update("abc");
            await settle();
            expect(last()).toEqual({ top: [], directory: [], isSearching: false });
        });

        describe("bare username (Clariva-only)", () => {
            it("puts @username:<my server> first when its profile exists", async () => {
                searchDirectory.mockResolvedValue([row("@other:clarivahub.com", "Other")]);
                getProfile.mockResolvedValue({ displayname: "Mohamed", avatar_url: "mxc://x/y" });
                search.update("mohamed.shimil4");
                await settle();
                expect(getProfile).toHaveBeenCalledWith("@mohamed.shimil4:clarivahub.com");
                expect(last().top).toEqual([
                    { userId: "@mohamed.shimil4:clarivahub.com", displayName: "Mohamed", avatarUrl: "mxc://x/y" },
                ]);
                expect(last().directory.map((r) => r.userId)).toEqual(["@other:clarivahub.com"]);
            });

            it("shows no phantom row when the profile does not resolve", async () => {
                getProfile.mockRejectedValue(new Error("M_NOT_FOUND"));
                search.update("nobody.here");
                await settle();
                expect(getProfile).toHaveBeenCalledWith("@nobody.here:clarivahub.com");
                expect(last()).toEqual({ top: [], directory: [], isSearching: false });
            });

            it("also treats a null profile as unresolved", async () => {
                getProfile.mockResolvedValue(null);
                search.update("nobody.here");
                await settle();
                expect(last().top).toEqual([]);
            });

            it("does not duplicate a user the directory already returned", async () => {
                searchDirectory.mockResolvedValue([row("@jane:clarivahub.com", "Jane")]);
                getProfile.mockResolvedValue({ displayname: "Jane" });
                search.update("jane");
                await settle();
                expect(last().top).toEqual([]);
                expect(last().directory.map((r) => r.userId)).toEqual(["@jane:clarivahub.com"]);
            });

            it("looks nothing up for a query that cannot be a username", async () => {
                search.update("john smith");
                await settle();
                expect(getProfile).not.toHaveBeenCalled();
                expect(searchDirectory).toHaveBeenCalledWith("john smith", 10);
            });

            it("never offers myself", async () => {
                getProfile.mockResolvedValue({ displayname: "Me" });
                search.update("me");
                await settle();
                expect(getProfile).not.toHaveBeenCalled();
                expect(last().top).toEqual([]);
            });
        });

        describe("explicit Matrix id", () => {
            const JANE = "@jane:clarivahub.com";

            it("shows a bare row immediately (emit #1), before any server round trip", () => {
                search.update(JANE);
                expect(states).toEqual([{ top: [{ userId: JANE }], directory: [], isSearching: true }]);
                expect(searchDirectory).not.toHaveBeenCalled();
            });

            it("replaces it by the profile row once resolved", async () => {
                getProfile.mockResolvedValue({ displayname: "Jane", avatar_url: "mxc://a/b" });
                search.update(JANE);
                await settle();
                expect(last().top).toEqual([{ userId: JANE, displayName: "Jane", avatarUrl: "mxc://a/b" }]);
            });

            it("falls back to an UNRESOLVED row (warning) when the profile lookup fails", async () => {
                search.update(JANE);
                await settle();
                expect(last().top).toEqual([{ userId: JANE, unresolved: true }]);
            });

            it("keeps the directory's own row when the directory returned the id", async () => {
                searchDirectory.mockResolvedValue([row(JANE, "Jane D.")]);
                getProfile.mockResolvedValue({ displayname: "Jane" });
                search.update(JANE);
                await settle();
                expect(last().top).toEqual([]);
                expect(last().directory).toEqual([{ userId: JANE, displayName: "Jane D.", avatarUrl: undefined }]);
            });

            it("does not offer myself as an explicit id", async () => {
                search.update(ME);
                expect(last().top).toEqual([]);
                await settle();
                expect(getProfile).not.toHaveBeenCalled();
            });
        });

        describe("races and clean-up", () => {
            it("discards the results of an older query that arrive late", async () => {
                let releaseFirst: (rows: DirectoryResult[]) => void = () => undefined;
                searchDirectory.mockImplementationOnce(() => new Promise<DirectoryResult[]>((r) => (releaseFirst = r)));
                searchDirectory.mockResolvedValueOnce([row("@second:clarivahub.com")]);

                search.update("first");
                await settle();
                search.update("second");
                await settle();
                expect(last().directory.map((r) => r.userId)).toEqual(["@second:clarivahub.com"]);

                releaseFirst([row("@first:clarivahub.com")]);
                await settle(10);
                expect(last().directory.map((r) => r.userId)).toEqual(["@second:clarivahub.com"]);
            });

            it("dispose() cancels the pending lookup and silences late results", async () => {
                search.update("abc");
                search.dispose();
                const before = states.length;
                await settle(1000);
                expect(searchDirectory).not.toHaveBeenCalled();
                expect(states).toHaveLength(before);

                search.update("abcd"); // ignored once disposed
                await settle(1000);
                expect(states).toHaveLength(before);
            });

            it("dispose() during an in-flight lookup drops its result", async () => {
                let release: (rows: DirectoryResult[]) => void = () => undefined;
                searchDirectory.mockImplementationOnce(() => new Promise<DirectoryResult[]>((r) => (release = r)));
                search.update("abc");
                await settle();
                const before = states.length;
                search.dispose();
                release([row("@abby:clarivahub.com")]);
                await settle(10);
                expect(states).toHaveLength(before);
            });
        });
    });
});
