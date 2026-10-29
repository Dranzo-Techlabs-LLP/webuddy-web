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

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import {
    calendarDaysBetween,
    formatLastSeen,
    userPresenceOf,
    visiblePresenceLabel,
    type VisiblePresenceInput,
} from "../../src/clariva/presence/lastSeen";
import {
    excludedContactIds,
    withExceptions,
    withLastSeenAudience,
    withOnlineAudience,
} from "../../src/clariva/presence/lastSeenPrivacy";
import { designationBadgeOf } from "../../src/clariva/presence/designation";
import { heartbeatState } from "../../src/clariva/presence/PresenceHeartbeat";
import { isPresenceContact, presenceContacts } from "../../src/clariva/presence/contacts";
import { isValidDesignation } from "../../src/clariva/components/settings/DesignationSettings";
import {
    DEFAULT_PRESENCE_PRIVACY,
    exceptToken,
    LastSeenAudience,
    OnlineAudience,
    type PresencePrivacy,
} from "../../src/clariva/profile/settings";
import { profileStrings } from "../../src/clariva/strings/profile";
import DMRoomMap from "../../src/utils/DMRoomMap";
import { CLIENT, CONSULTANT, ME } from "./helpers";

const privacy = (overrides: Partial<PresencePrivacy> = {}): PresencePrivacy => ({
    ...DEFAULT_PRESENCE_PRIVACY,
    lastSeenExcept: new Set(),
    ...overrides,
});

// local wall-clock times (the rules work in the local time zone, like Android's Calendar)
const at = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
const GB = { locale: "en-GB", showTwelveHour: false };

describe("userPresenceOf (Android MatrixPresenceService.getPresence)", () => {
    it("online only for 'online'; the last activity is the arrival time minus last_active_ago", () => {
        expect(userPresenceOf({ presence: "online", last_active_ago: 4000 }, 10_000)).toEqual({
            isOnline: true,
            lastActiveTs: 6000,
        });
        expect(userPresenceOf({ presence: "unavailable", last_active_ago: 1000 }, 10_000)).toEqual({
            isOnline: false,
            lastActiveTs: 9000,
        });
        expect(userPresenceOf({ presence: "offline" }, 10_000)).toEqual({ isOnline: false, lastActiveTs: null });
        expect(userPresenceOf(null, 10_000)).toEqual({ isOnline: false, lastActiveTs: null });
    });
});

describe("calendarDaysBetween", () => {
    it("counts calendar days, not 24 h blocks, and never goes negative", () => {
        expect(calendarDaysBetween(at(2026, 10, 29, 0, 5), at(2026, 10, 29, 23, 55))).toBe(0);
        expect(calendarDaysBetween(at(2026, 10, 28, 23, 59), at(2026, 10, 29, 0, 1))).toBe(1);
        expect(calendarDaysBetween(at(2026, 10, 22, 12), at(2026, 10, 29, 9))).toBe(7);
        expect(calendarDaysBetween(at(2026, 10, 30, 9), at(2026, 10, 29, 9))).toBe(0); // clock skew
    });

    it("is not thrown off by a 23 or 25 hour day (DST)", () => {
        // whatever the test machine's zone, a week of calendar days is 7
        expect(calendarDaysBetween(at(2026, 3, 25, 12), at(2026, 4, 1, 12))).toBe(7);
        expect(calendarDaysBetween(at(2026, 10, 21, 12), at(2026, 10, 28, 12))).toBe(7);
    });
});

describe("formatLastSeen (Android formatLastSeen)", () => {
    const now = at(2026, 10, 29, 18, 0); // a Thursday

    it("today / yesterday / a weekday within the week / a short date before that", () => {
        expect(formatLastSeen(at(2026, 10, 29, 10, 30), now, GB)).toBe("last seen today at 10:30");
        expect(formatLastSeen(at(2026, 10, 28, 22, 45), now, GB)).toBe("last seen yesterday at 22:45");
        expect(formatLastSeen(at(2026, 10, 26, 9, 5), now, GB)).toBe("last seen Mon at 9:05");
        expect(formatLastSeen(at(2026, 10, 23, 7, 0), now, GB)).toBe("last seen Fri at 7:00");
        expect(formatLastSeen(at(2026, 10, 22, 10, 30), now, GB)).toBe("last seen 22/10/26, 10:30");
        expect(formatLastSeen(at(2025, 1, 3, 10, 30), now, GB)).toBe("last seen 03/01/25, 10:30");
    });

    it("follows the locale's date order and the 12 hour setting", () => {
        expect(formatLastSeen(at(2026, 10, 22, 10, 30), now, { locale: "en-US" })).toMatch(
            /^last seen 10\/22\/26, 10:30/,
        );
        expect(formatLastSeen(at(2026, 10, 29, 22, 15), now, { locale: "en-US", showTwelveHour: true })).toMatch(
            /^last seen today at 10:15\s?PM$/i,
        );
    });

    it("is null when the server gave no time", () => {
        expect(formatLastSeen(null, now, GB)).toBeNull();
    });
});

describe("visiblePresenceLabel (Android visiblePresenceLabel): both people's choices count", () => {
    const now = at(2026, 10, 29, 18, 0);
    const input = (overrides: Partial<VisiblePresenceInput> = {}): VisiblePresenceInput => ({
        presence: { isOnline: false, lastActiveTs: at(2026, 10, 29, 10, 30) },
        myId: ME,
        peerId: CONSULTANT,
        isContact: true,
        myPrivacy: privacy(),
        peerPrivacy: privacy(),
        now,
        format: GB,
        ...overrides,
    });
    const isOnline = { isOnline: true, lastActiveTs: now };

    it("everyone shares: 'online' or the last seen", () => {
        expect(visiblePresenceLabel(input({ presence: isOnline }))).toBe(profileStrings.presenceOnline);
        expect(visiblePresenceLabel(input())).toBe("last seen today at 10:30");
    });

    it("an unknown partner choice hides everything (fail closed)", () => {
        expect(visiblePresenceLabel(input({ peerPrivacy: undefined }))).toBeNull();
        expect(visiblePresenceLabel(input({ peerPrivacy: undefined, presence: isOnline }))).toBeNull();
    });

    it("the partner hides their last seen: no last seen, but 'online' still shows when online is for everyone", () => {
        const peerPrivacy = privacy({ lastSeen: LastSeenAudience.Nobody });
        expect(visiblePresenceLabel(input({ peerPrivacy }))).toBeNull();
        expect(visiblePresenceLabel(input({ peerPrivacy, presence: isOnline }))).toBe("online");
        // "same as last seen": online is hidden too, and never downgraded to a last seen
        const both = privacy({ lastSeen: LastSeenAudience.Nobody, online: OnlineAudience.SameAsLastSeen });
        expect(visiblePresenceLabel(input({ peerPrivacy: both, presence: isOnline }))).toBeNull();
    });

    it("reciprocal: if I hide my last seen I see nobody's (WhatsApp)", () => {
        const myPrivacy = privacy({ lastSeen: LastSeenAudience.Nobody });
        expect(visiblePresenceLabel(input({ myPrivacy }))).toBeNull();
        expect(visiblePresenceLabel(input({ myPrivacy, presence: isOnline }))).toBe("online");
        const mineHidden = privacy({ lastSeen: LastSeenAudience.Nobody, online: OnlineAudience.SameAsLastSeen });
        expect(visiblePresenceLabel(input({ myPrivacy: mineHidden, presence: isOnline }))).toBeNull();
    });

    it("'My contacts' needs both of us to have joined the chat", () => {
        const peerPrivacy = privacy({ lastSeen: LastSeenAudience.MyContacts, online: OnlineAudience.SameAsLastSeen });
        expect(visiblePresenceLabel(input({ peerPrivacy }))).toBe("last seen today at 10:30");
        expect(visiblePresenceLabel(input({ peerPrivacy, isContact: false }))).toBeNull();
        expect(visiblePresenceLabel(input({ peerPrivacy, isContact: false, presence: isOnline }))).toBeNull();
    });

    it("'My contacts except...' hides it from the excluded person only (their token, salted with the owner)", () => {
        const excludingMe = privacy({
            lastSeen: LastSeenAudience.MyContactsExcept,
            lastSeenExcept: new Set([exceptToken(CONSULTANT, ME)]),
        });
        expect(visiblePresenceLabel(input({ peerPrivacy: excludingMe }))).toBeNull();
        const excludingSomeoneElse = privacy({
            lastSeen: LastSeenAudience.MyContactsExcept,
            lastSeenExcept: new Set([exceptToken(CONSULTANT, CLIENT)]),
        });
        expect(visiblePresenceLabel(input({ peerPrivacy: excludingSomeoneElse }))).toBe("last seen today at 10:30");
        // my own exclusion of the partner works the same way
        const myExcludingPeer = privacy({
            lastSeen: LastSeenAudience.MyContactsExcept,
            lastSeenExcept: new Set([exceptToken(ME, CONSULTANT)]),
        });
        expect(visiblePresenceLabel(input({ myPrivacy: myExcludingPeer }))).toBeNull();
    });

    it("an offline partner without a last-active time shows nothing", () => {
        expect(visiblePresenceLabel(input({ presence: { isOnline: false, lastActiveTs: null } }))).toBeNull();
    });
});

describe("the 'Last seen and online' page's decisions (Android LastSeenPrivacyPresenter)", () => {
    const except = (ids: string[]): PresencePrivacy =>
        privacy({
            lastSeen: LastSeenAudience.MyContactsExcept,
            lastSeenExcept: new Set(ids.map((id) => exceptToken(ME, id))),
        });

    it("picking a last-seen option: nothing for the selected one or 'except' (it opens the picker); others drop the list", () => {
        expect(withLastSeenAudience(privacy(), LastSeenAudience.Everyone)).toBeNull();
        expect(withLastSeenAudience(privacy(), LastSeenAudience.MyContactsExcept)).toBeNull();
        const next = withLastSeenAudience(except([CLIENT]), LastSeenAudience.Nobody)!;
        expect(next.lastSeen).toBe(LastSeenAudience.Nobody);
        expect(next.lastSeenExcept.size).toBe(0);
        expect(next.online).toBe(OnlineAudience.Everyone);
    });

    it("picking an online option", () => {
        expect(withOnlineAudience(privacy(), OnlineAudience.Everyone)).toBeNull();
        expect(withOnlineAudience(privacy(), OnlineAudience.SameAsLastSeen)?.online).toBe(
            OnlineAudience.SameAsLastSeen,
        );
    });

    it("the picker starts from the saved exclusions of the people it lists", () => {
        expect([...excludedContactIds(except([CLIENT]), ME, [CLIENT, CONSULTANT])]).toEqual([CLIENT]);
        expect(excludedContactIds(privacy(), ME, [CLIENT]).size).toBe(0);
    });

    it("Done saves 'except' with the ticked people and keeps exclusions of people it did not list", () => {
        const hidden = "@gone:clarivahub.com"; // excluded earlier, not in the list now (a chat not loaded yet)
        const saved = except([hidden, CLIENT]);
        const next = withExceptions(saved, ME, [CLIENT, CONSULTANT], [CONSULTANT]);
        expect(next.lastSeen).toBe(LastSeenAudience.MyContactsExcept);
        expect(next.lastSeenExcept).toEqual(new Set([exceptToken(ME, hidden), exceptToken(ME, CONSULTANT)]));
        // coming from another option, nothing old is carried over
        const fresh = withExceptions(privacy({ lastSeen: LastSeenAudience.Nobody }), ME, [CLIENT], [CLIENT]);
        expect(fresh.lastSeenExcept).toEqual(new Set([exceptToken(ME, CLIENT)]));
    });
});

describe("designation", () => {
    it("the badge: a consultant's designation, 'Consultant' without one, nothing for a client or unknown role", () => {
        expect(designationBadgeOf({ isConsultant: true, designation: "Cardiologist" })).toBe("Cardiologist");
        expect(designationBadgeOf({ isConsultant: true, designation: null })).toBe("Consultant");
        expect(designationBadgeOf({ isConsultant: true })).toBe("Consultant");
        expect(designationBadgeOf({ isConsultant: false, designation: "Cardiologist" })).toBeNull();
        expect(designationBadgeOf({ isConsultant: null })).toBeNull();
        expect(designationBadgeOf(undefined)).toBeNull();
    });

    it("the editor accepts up to 40 characters (trimmed); blank restores the default", () => {
        expect(isValidDesignation("")).toBe(true);
        expect(isValidDesignation("x".repeat(40))).toBe(true);
        expect(isValidDesignation(`  ${"x".repeat(40)}  `)).toBe(true);
        expect(isValidDesignation("x".repeat(41))).toBe(false);
    });
});

describe("heartbeatState (Android PresenceHeartbeat)", () => {
    it("online while visible or in a call, offline otherwise, hidden whenever nobody may see it", () => {
        expect(heartbeatState({ visible: true, inCall: false, visibleToAnyone: true })).toBe("online");
        expect(heartbeatState({ visible: false, inCall: true, visibleToAnyone: true })).toBe("online");
        expect(heartbeatState({ visible: false, inCall: false, visibleToAnyone: true })).toBe("offline");
        expect(heartbeatState({ visible: true, inCall: true, visibleToAnyone: false })).toBe("hidden");
    });
});

describe("presence contacts", () => {
    interface FakeRoom {
        roomId: string;
        myMembership: string;
        joined: number;
        peer: string | null;
        peerMembership: string;
        peerName?: string;
    }
    const mkRoom = (r: FakeRoom): Room =>
        ({
            roomId: r.roomId,
            myUserId: ME,
            getMyMembership: () => r.myMembership,
            getJoinedMemberCount: () => r.joined,
            getInvitedAndJoinedMemberCount: () => r.joined,
            getMember: (id: string) =>
                id === r.peer ? { membership: r.peerMembership, rawDisplayName: r.peerName ?? id } : null,
        }) as unknown as Room;

    const rooms: FakeRoom[] = [
        { roomId: "!z", myMembership: "join", joined: 2, peer: "@zed:x", peerMembership: "join", peerName: "Zed" },
        { roomId: "!a", myMembership: "join", joined: 2, peer: "@amy:x", peerMembership: "join", peerName: "amy" },
        { roomId: "!a2", myMembership: "join", joined: 2, peer: "@amy:x", peerMembership: "join", peerName: "amy" },
        { roomId: "!n", myMembership: "join", joined: 2, peer: "@noname:x", peerMembership: "join" },
        { roomId: "!inv", myMembership: "join", joined: 1, peer: "@req:x", peerMembership: "invite" },
        { roomId: "!left", myMembership: "leave", joined: 1, peer: "@old:x", peerMembership: "join" },
        { roomId: "!group", myMembership: "join", joined: 2, peer: null, peerMembership: "join" },
    ];

    beforeEach(() => {
        DMRoomMap.setShared({
            getUserIdForRoomId: (roomId: string) => rooms.find((r) => r.roomId === roomId)?.peer ?? undefined,
        } as unknown as DMRoomMap);
    });

    it("are the people of joined 1:1 chats both sides joined, once each, sorted by name", () => {
        const client = { getUserId: () => ME, getRooms: () => rooms.map(mkRoom) } as unknown as MatrixClient;
        const contacts = presenceContacts(client);
        expect(contacts.map((c) => [c.userId, c.name])).toEqual([
            // like Android: by display name, or the user ID without one ("@" sorts first)
            ["@noname:x", null],
            ["@amy:x", "amy"],
            ["@zed:x", "Zed"],
        ]);
    });

    it("an unanswered chat request is not a contact", () => {
        expect(isPresenceContact(mkRoom(rooms[0]), "@zed:x")).toBe(true);
        expect(isPresenceContact(mkRoom(rooms[4]), "@req:x")).toBe(false);
        expect(isPresenceContact(mkRoom(rooms[5]), "@old:x")).toBe(false);
    });
});
