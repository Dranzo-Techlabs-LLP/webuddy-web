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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { mocked, type Mocked } from "jest-mock";
import { type MatrixClient, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import RoomTile from "../../src/components/views/rooms/RoomTile";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import { DefaultTagID } from "../../src/stores/room-list/models";
import DMRoomMap from "../../src/utils/DMRoomMap";
import PlatformPeg from "../../src/PlatformPeg";
import type BasePlatform from "../../src/BasePlatform";
import { SDKContext } from "../../src/contexts/SDKContext";
import { TestSdkContext } from "../TestSdkContext";
import { flushPromises, mkMessage, stubClient } from "../test-utils";
import { ROOM_TILE_AVATAR_SIZE } from "../../src/clariva/components/chats/RoomTileContent";
import { configureClariva } from "./helpers";

describe("RoomTile in the Clariva Chats list", () => {
    let client: Mocked<MatrixClient>;
    let room: Room;
    let sdkContext: TestSdkContext;

    jest.spyOn(PlatformPeg, "get").mockReturnValue({
        overrideBrowserShortcuts: () => false,
    } as unknown as BasePlatform);

    beforeEach(() => {
        sdkContext = new TestSdkContext();
        client = mocked(stubClient());
        sdkContext.client = client;
        DMRoomMap.makeShared(client);
        room = new Room("!1:example.org", client, "@alice:example.org", {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        client.getRoom.mockImplementation((roomId) => (roomId === room.roomId ? room : null));
        client.getRooms.mockReturnValue([room]);
        room.name = "Dr. Rao";
    });

    afterEach(() => {
        cleanup();
        SdkConfig.reset();
        jest.clearAllMocks();
    });

    function renderTile(): ReturnType<typeof render> {
        return render(
            <SDKContext.Provider value={sdkContext}>
                <RoomTile room={room} showMessagePreview={false} isMinimized={false} tag={DefaultTagID.DM} />
            </SDKContext.Provider>,
        );
    }

    it("keeps the stock row when Clariva is not configured", () => {
        SdkConfig.reset();
        const { container } = renderTile();
        expect(container.querySelector(".mx_RoomTile_clariva")).toBeNull();
        expect(container.querySelector(".mx_RoomTile_titleContainer")).not.toBeNull();
    });

    it("renders the Android-style row: name, time, preview and the same treeitem semantics", async () => {
        configureClariva();
        room.timeline.push(
            mkMessage({ event: true, room: room.roomId, msg: "Hi doctor", user: "@alice:example.org", ts: Date.now() }),
        );
        const { container } = renderTile();
        await act(async () => {
            await flushPromises();
        });

        const row = screen.getByRole("treeitem", { name: /Dr. Rao/ });
        expect(row).toHaveClass("mx_RoomTile", "mx_RoomTile_clariva");
        expect(row).toHaveAttribute("aria-selected", "false");

        // name row, meta (time / credits), preview row, indicators: the four cells of the grid
        for (const cell of ["nameRow", "meta", "previewRow", "indicators"]) {
            expect(container.querySelector(`.mx_ClarivaRoomTile_${cell}`)).not.toBeNull();
        }
        expect(container.querySelector(".mx_ClarivaRoomTile_nameRow .mx_RoomTile_title")).toHaveTextContent("Dr. Rao");
        // today's message: a <time> with a machine-readable value
        const time = container.querySelector("time.mx_ClarivaRoomTile_time");
        expect(time).not.toBeNull();
        expect(time).toHaveAttribute("datetime");
        // the stock title container is not rendered in this layout
        expect(container.querySelector(".mx_RoomTile_titleContainer")).toBeNull();
    });

    it("wraps a 52px avatar in the element the presence ring is drawn on, and keeps the unread badge in its own cell", async () => {
        configureClariva();
        const { container } = renderTile();
        await act(async () => {
            await flushPromises();
        });

        const ring = container.querySelector(".mx_ClarivaRoomTile_avatar");
        expect(ring).not.toBeNull();
        expect(ROOM_TILE_AVATAR_SIZE).toBe("52px");
        const avatar = ring!.querySelector<HTMLElement>(".mx_BaseAvatar");
        expect(avatar).not.toBeNull();
        // Compound's Avatar takes its size from a custom property on the element
        expect(avatar!.getAttribute("style")).toContain("52px");
        // the presence dot of the stock avatar is hidden by CSS (the ring replaces it), but it stays in the DOM for its tooltip
        expect(container.querySelector(".mx_ClarivaRoomTile_indicators")).not.toBeNull();
    });

    it("opens the room when the row is clicked, like the stock row", async () => {
        configureClariva();
        const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        renderTile();
        await act(async () => {
            fireEvent.click(screen.getByRole("treeitem", { name: /Dr. Rao/ }));
            await flushPromises();
        });
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: room.roomId, show_room_tile: true }),
        );
    });
});
