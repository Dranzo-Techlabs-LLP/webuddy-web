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

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { mocked } from "jest-mock";
import { type MatrixClient, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import DecoratedRoomAvatar from "../../src/components/views/avatars/DecoratedRoomAvatar";
import EntityTile from "../../src/components/views/rooms/EntityTile";
import DMRoomMap from "../../src/utils/DMRoomMap";
import { MemberListStore } from "../../src/stores/MemberListStore";
import { showsStockPresence } from "../../src/clariva/presence/stockPresence";
import { stubClient } from "../test-utils";
import { TestSdkContext } from "../TestSdkContext";
import { configureClariva } from "./helpers";

jest.mock("../../src/utils/room/getJoinedNonFunctionalMembers", () => ({
    getJoinedNonFunctionalMembers: jest.fn().mockReturnValue([0, 1]),
}));

/**
 * Android shows presence ONLY in the open DM's top bar (with both people's "Last seen and online" choices applied). The
 * production homeserver has presence enabled, so Element's stock presence UIs (member list labels and ordering, the dot
 * on DM avatars in Spotlight and breadcrumbs) must stay off under Clariva: they would ignore those choices.
 */

const HS = "https://hs.test";
let client: MatrixClient;

beforeEach(() => {
    client = stubClient();
    client.baseUrl = HS;
});

afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    SdkConfig.reset();
});

const withPresenceOn = (clariva: boolean): void => {
    if (clariva) configureClariva();
    else SdkConfig.reset();
    SdkConfig.add({ enable_presence_by_hs_url: { [HS]: true } } as any);
};

describe("stock presence UI under Clariva", () => {
    it("showsStockPresence: off under Clariva, Element's own choice otherwise", () => {
        withPresenceOn(true);
        expect(showsStockPresence(true)).toBe(false);
        SdkConfig.reset();
        expect(showsStockPresence(true)).toBe(true);
        expect(showsStockPresence(false)).toBe(false);
    });

    it("the member list gets no presence labels or presence ordering", () => {
        const context = new TestSdkContext();
        context.client = client;
        const store = new MemberListStore(context);
        withPresenceOn(true);
        expect(store.isPresenceEnabled()).toBe(false);
        withPresenceOn(false);
        expect(store.isPresenceEnabled()).toBe(true);
    });

    it("a member tile without presence shows no 'Online' / 'Away' label", () => {
        const { container } = render(
            <EntityTile
                name="Asha"
                showPresence={false}
                presenceState="online"
                presenceCurrentlyActive={true}
                presenceLastActiveAgo={0}
                presenceLastTs={Date.now()}
            />,
        );
        expect(container.querySelector(".mx_PresenceLabel")).toBeNull();
        expect(container.querySelector(".mx_EntityTile_online")).toBeNull();
    });

    it("DM avatars (Spotlight, breadcrumbs) get no presence dot", () => {
        const peg = mocked(MatrixClientPeg.safeGet());
        const room = new Room("!dm:hs.test", peg, peg.getUserId() ?? "", {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        jest.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => "@asha:hs.test",
        } as unknown as DMRoomMap);
        jest.spyOn(DecoratedRoomAvatar.prototype as any, "getPresenceIcon").mockImplementation(() => "ONLINE");

        withPresenceOn(true);
        const clariva = render(<DecoratedRoomAvatar room={room} size="32px" />);
        expect(clariva.container.querySelector(".mx_DecoratedRoomAvatar_icon")).toBeNull();
        clariva.unmount();

        withPresenceOn(false);
        const stock = render(<DecoratedRoomAvatar room={room} size="32px" />);
        expect(stock.container.querySelector(".mx_DecoratedRoomAvatar_icon_online")).not.toBeNull();
    });
});
