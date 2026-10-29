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

import { createHash } from "crypto";

import { sha256Hex } from "../../src/clariva/profile/sha256";
import {
    DEFAULT_PRESENCE_PRIVACY,
    LastSeenAudience,
    OnlineAudience,
    designationOf,
    exceptToken,
    mergeSettings,
    normalizeDesignation,
    presencePrivacyOf,
    presencePrivacyToJson,
    sharesLastSeenWith,
    sharesOnlineWith,
    sharesWithAnyone,
    type PresencePrivacy,
} from "../../src/clariva/profile/settings";
import { WalletStore, WalletStoreEvent } from "../../src/clariva/stores/WalletStore";
import { CONSULTANT, ME, configureClariva, installFakeApi, mockResponse, walletUser } from "./helpers";

const enc = encodeURIComponent;
const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

/** Android `PresencePrivacy.exceptToken`: MessageDigest SHA-256, first 16 bytes, "%02x" each. */
const androidToken = (owner: string, viewer: string): string =>
    createHash("sha256").update(`clariva-last-seen|${owner}|${viewer}`, "utf8").digest().subarray(0, 16).toString("hex");

const privacy = (p: Partial<PresencePrivacy>): PresencePrivacy => ({ ...DEFAULT_PRESENCE_PRIVACY, ...p });

describe("sha256Hex", () => {
    it.each(["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "ünïcödé ✓ 𝄞"])(
        "matches Node's crypto for %j",
        (input) => {
            expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
        },
    );
});

describe("exceptToken", () => {
    it("is byte-identical to Android's token", () => {
        expect(exceptToken("@alice:clarivahub.com", "@bob:clarivahub.com")).toBe(
            androidToken("@alice:clarivahub.com", "@bob:clarivahub.com"),
        );
        expect(exceptToken("@alice:clarivahub.com", "@bob:clarivahub.com")).toHaveLength(32);
    });

    it("is salted with the owner", () => {
        expect(exceptToken("@a:x", "@v:x")).not.toBe(exceptToken("@b:x", "@v:x"));
    });
});

describe("settings JSON", () => {
    it("reads a trimmed designation and ignores blanks and non-strings", () => {
        expect(designationOf({ designation: "  Cardiologist " })).toBe("Cardiologist");
        expect(designationOf({ designation: "   " })).toBeNull();
        expect(designationOf({ designation: 42 })).toBeNull();
        expect(designationOf(null)).toBeNull();
        expect(designationOf("not an object")).toBeNull();
    });

    it("normalises a designation and refuses one over 40 characters", () => {
        expect(normalizeDesignation("  Dentist ")).toBe("Dentist");
        expect(normalizeDesignation("   ")).toBeNull();
        expect(normalizeDesignation(null)).toBeNull();
        expect(normalizeDesignation("x".repeat(40))).toHaveLength(40);
        expect(() => normalizeDesignation("x".repeat(41))).toThrow(/at most 40/);
    });

    it("merges one key and keeps every other key (the server replaces the whole object)", () => {
        const current = { designation: "Dentist", presencePrivacy: { lastSeen: "nobody" }, theme: "dark" };
        expect(mergeSettings(current, "designation", "Surgeon")).toEqual({ ...current, designation: "Surgeon" });
        expect(mergeSettings(current, "designation", null)).toEqual({ presencePrivacy: { lastSeen: "nobody" }, theme: "dark" });
        expect(mergeSettings(null, "designation", "Surgeon")).toEqual({ designation: "Surgeon" });
    });

    it("parses the stored privacy, falling back to Everyone for anything unknown", () => {
        expect(presencePrivacyOf(undefined)).toEqual(DEFAULT_PRESENCE_PRIVACY);
        expect(presencePrivacyOf({ presencePrivacy: { lastSeen: "weird", online: 3 } })).toEqual(DEFAULT_PRESENCE_PRIVACY);
        const parsed = presencePrivacyOf({
            presencePrivacy: { lastSeen: "contacts_except", online: "same_as_last_seen", lastSeenExcept: ["t1", 5, "t2"] },
        });
        expect(parsed.lastSeen).toBe(LastSeenAudience.MyContactsExcept);
        expect(parsed.online).toBe(OnlineAudience.SameAsLastSeen);
        expect([...parsed.lastSeenExcept]).toEqual(["t1", "t2"]);
    });

    it("writes the Android JSON shape (except list only with 'My contacts except', sorted)", () => {
        expect(presencePrivacyToJson(privacy({ lastSeen: LastSeenAudience.Nobody }))).toEqual({
            lastSeen: "nobody",
            online: "everyone",
        });
        expect(
            presencePrivacyToJson(
                privacy({ lastSeen: LastSeenAudience.MyContactsExcept, lastSeenExcept: new Set(["b", "a"]) }),
            ),
        ).toEqual({ lastSeen: "contacts_except", online: "everyone", lastSeenExcept: ["a", "b"] });
        // a stale except list is never written for another audience
        expect(
            presencePrivacyToJson(privacy({ lastSeen: LastSeenAudience.MyContacts, lastSeenExcept: new Set(["a"]) })),
        ).toEqual({ lastSeen: "contacts", online: "everyone" });
    });
});

describe("presence privacy rules (Android PresencePrivacy)", () => {
    const owner = "@owner:x";
    const viewer = "@viewer:x";

    it("last seen per audience", () => {
        expect(sharesLastSeenWith(privacy({ lastSeen: LastSeenAudience.Everyone }), owner, viewer, false)).toBe(true);
        expect(sharesLastSeenWith(privacy({ lastSeen: LastSeenAudience.MyContacts }), owner, viewer, false)).toBe(false);
        expect(sharesLastSeenWith(privacy({ lastSeen: LastSeenAudience.MyContacts }), owner, viewer, true)).toBe(true);
        expect(sharesLastSeenWith(privacy({ lastSeen: LastSeenAudience.Nobody }), owner, viewer, true)).toBe(false);
        const except = privacy({
            lastSeen: LastSeenAudience.MyContactsExcept,
            lastSeenExcept: new Set([exceptToken(owner, viewer)]),
        });
        expect(sharesLastSeenWith(except, owner, viewer, true)).toBe(false);
        expect(sharesLastSeenWith(except, owner, "@other:x", true)).toBe(true);
        expect(sharesLastSeenWith(except, owner, "@other:x", false)).toBe(false);
    });

    it("online: Everyone, or the same audience as last seen", () => {
        const nobodyButOnline = privacy({ lastSeen: LastSeenAudience.Nobody, online: OnlineAudience.Everyone });
        expect(sharesOnlineWith(nobodyButOnline, owner, viewer, false)).toBe(true);
        const nobodySame = privacy({ lastSeen: LastSeenAudience.Nobody, online: OnlineAudience.SameAsLastSeen });
        expect(sharesOnlineWith(nobodySame, owner, viewer, true)).toBe(false);
        expect(sharesWithAnyone(nobodySame)).toBe(false);
        expect(sharesWithAnyone(nobodyButOnline)).toBe(true);
        expect(sharesWithAnyone(privacy({ lastSeen: LastSeenAudience.MyContacts, online: OnlineAudience.SameAsLastSeen }))).toBe(true);
    });
});

describe("WalletStore settings", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        configureClariva();
        WalletStore.resetForTests();
    });
    afterEach(() => {
        WalletStore.resetForTests();
        jest.useRealTimers();
    });

    it("loads my designation and privacy from my wallet row", async () => {
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () =>
                mockResponse(200, walletUser({ isConsultant: 1, settings: { designation: "Dentist", presencePrivacy: { lastSeen: "nobody" } } })),
            "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
        });
        const store = WalletStore.instance;
        store.start(ME);
        await settle();
        expect(store.getSnapshot().designation).toBe("Dentist");
        expect(store.getSnapshot().presencePrivacy?.lastSeen).toBe(LastSeenAudience.Nobody);
    });

    it("updateDesignation re-reads settings and PATCHes the merged object", async () => {
        const patches: unknown[] = [];
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () =>
                mockResponse(200, walletUser({ isConsultant: 1, settings: { presencePrivacy: { lastSeen: "contacts" }, other: 1 } })),
            [`PATCH /v1/users/${enc(ME)}`]: (_url, init) => {
                patches.push(JSON.parse(String(init.body)));
                return mockResponse(200, walletUser());
            },
            "GET /v1/refund/pending-for-consultant": () => mockResponse(200, { clientIds: [] }),
        });
        const store = WalletStore.instance;
        store.start(ME);
        await settle();
        await store.updateDesignation("  Surgeon ");
        expect(patches).toEqual([
            { settings: { presencePrivacy: { lastSeen: "contacts" }, other: 1, designation: "Surgeon" } },
        ]);
        expect(store.getSnapshot().designation).toBe("Surgeon");

        await store.updateDesignation("");
        expect(patches[1]).toEqual({ settings: { presencePrivacy: { lastSeen: "contacts" }, other: 1 } });
        expect(store.getSnapshot().designation).toBeNull();
    });

    it("updatePresencePrivacy keeps the designation and stores the Android JSON", async () => {
        const patches: any[] = [];
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ settings: { designation: "Dentist" } })),
            [`PATCH /v1/users/${enc(ME)}`]: (_url, init) => {
                patches.push(JSON.parse(String(init.body)));
                return mockResponse(200, walletUser());
            },
        });
        const store = WalletStore.instance;
        store.start(ME);
        await settle();
        await store.updatePresencePrivacy(
            privacy({ lastSeen: LastSeenAudience.MyContactsExcept, lastSeenExcept: new Set(["tok"]) }),
        );
        expect(patches[0]).toEqual({
            settings: {
                designation: "Dentist",
                presencePrivacy: { lastSeen: "contacts_except", online: "everyone", lastSeenExcept: ["tok"] },
            },
        });
        expect(store.getSnapshot().presencePrivacy?.lastSeen).toBe(LastSeenAudience.MyContactsExcept);
    });

    it("a failed save throws and keeps the old value", async () => {
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser({ settings: { designation: "Dentist" } })),
            [`PATCH /v1/users/${enc(ME)}`]: () => mockResponse(500, { message: "boom" }),
        });
        const store = WalletStore.instance;
        store.start(ME);
        await settle();
        await expect(store.updateDesignation("Surgeon")).rejects.toBeTruthy();
        expect(store.getSnapshot().designation).toBe("Dentist");
    });

    it("peer lookups carry designation and privacy, emit Peer on change, and refreshPeer bypasses the cache", async () => {
        let designation = "Cardiologist";
        let lookups = 0;
        installFakeApi({
            [`GET /v1/users/${enc(ME)}`]: () => mockResponse(200, walletUser()),
            [`GET /v1/users/${enc(CONSULTANT)}`]: () => {
                lookups++;
                return mockResponse(200, walletUser({ isConsultant: 1, max_credits: "100.00", settings: { designation } }));
            },
        });
        const store = WalletStore.instance;
        store.start(ME);
        await settle();
        const changed: string[] = [];
        store.on(WalletStoreEvent.Peer, (id) => changed.push(id));

        const first = await store.getPeer(CONSULTANT);
        expect(first?.designation).toBe("Cardiologist");
        expect(first?.presencePrivacy).toEqual(DEFAULT_PRESENCE_PRIVACY);
        await store.getPeer(CONSULTANT); // cached
        expect(lookups).toBe(1);

        designation = "Surgeon";
        const refreshed = await store.refreshPeer(CONSULTANT);
        expect(lookups).toBe(2);
        expect(refreshed?.designation).toBe("Surgeon");
        expect(changed).toEqual([CONSULTANT, CONSULTANT]);

        await store.refreshPeer(CONSULTANT); // unchanged: no event
        expect(changed).toHaveLength(2);
    });
});
