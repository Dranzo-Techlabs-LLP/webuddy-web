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

import SdkConfig from "../../src/SdkConfig";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import SettingsStore from "../../src/settings/SettingsStore";
import { SettingLevel } from "../../src/settings/SettingLevel";
import SpaceStore from "../../src/stores/spaces/SpaceStore";
import { MetaSpace } from "../../src/stores/spaces";
import DMRoomMap from "../../src/utils/DMRoomMap";
import _RoomListHeader from "../../src/components/views/rooms/RoomListHeader";
import { shouldShowComponent } from "../../src/customisations/helpers/UIComponents";
import { UIComponent } from "../../src/settings/UIFeature";
import { clarivaHidesComponent, clarivaHidesGroupRooms } from "../../src/clariva/chat/groupRooms";
import { stubClient, wrapInMatrixClientContext } from "../test-utils";
import { configureClariva } from "./helpers";

const RoomListHeader = wrapInMatrixClientContext(_RoomListHeader);

afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    SdkConfig.reset();
});

describe("group rooms are hidden while features.group_rooms is off (Android GROUP_ROOMS_ENABLED)", () => {
    it("is off by default for Clariva, never for stock Element Web, and can be switched back on", () => {
        SdkConfig.reset();
        expect(clarivaHidesGroupRooms()).toBe(false);
        configureClariva();
        expect(clarivaHidesGroupRooms()).toBe(true);
        configureClariva({ features: { group_rooms: true } });
        expect(clarivaHidesGroupRooms()).toBe(false);
    });

    it("hides the room directory and space creation through shouldShowComponent, nothing else", () => {
        configureClariva();
        expect(clarivaHidesComponent(UIComponent.ExploreRooms)).toBe(true);
        expect(clarivaHidesComponent(UIComponent.CreateSpaces)).toBe(true);
        expect(shouldShowComponent(UIComponent.ExploreRooms)).toBe(false);
        expect(shouldShowComponent(UIComponent.CreateSpaces)).toBe(false);
        // "Create rooms" also gates Start chat: it must stay
        expect(shouldShowComponent(UIComponent.CreateRooms)).toBe(true);
        expect(shouldShowComponent(UIComponent.InviteUsers)).toBe(true);

        configureClariva({ features: { group_rooms: true } });
        expect(shouldShowComponent(UIComponent.ExploreRooms)).toBe(true);
        expect(shouldShowComponent(UIComponent.CreateSpaces)).toBe(true);

        SdkConfig.reset();
        expect(shouldShowComponent(UIComponent.ExploreRooms)).toBe(true);
    });

    describe("Home shows every room (spaces cannot be opened)", () => {
        let allRoomsInHome = false;
        const realGetValue = SettingsStore.getValue;

        const changeSetting = async (value: boolean): Promise<void> => {
            allRoomsInHome = value;
            // @ts-ignore calling a protected function, as the stock SpaceStore tests do
            await SpaceStore.instance.onAction({
                action: Action.SettingUpdated,
                settingName: "Spaces.allRoomsInHome",
                roomId: null,
                level: SettingLevel.DEVICE,
                newValueAtLevel: SettingLevel.DEVICE,
                newValue: value,
            });
        };

        beforeEach(async () => {
            DMRoomMap.setShared({ getUserIdForRoomId: jest.fn(), getDMRoomsForUserId: jest.fn() } as any);
            jest.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: unknown[]) =>
                name === "Spaces.allRoomsInHome"
                    ? allRoomsInHome
                    : (realGetValue as (...args: unknown[]) => unknown).call(SettingsStore, name, ...rest)) as never);
            // @ts-ignore protected access: give the store a client without running its whole start-up
            SpaceStore.instance.readyStore.useUnitTestClient(stubClient());
            SdkConfig.reset();
            await changeSetting(false);
        });

        it("is forced on while group rooms are off, whatever the setting says", () => {
            configureClariva();
            expect(SpaceStore.instance.allRoomsInHome).toBe(true);
            configureClariva({ features: { group_rooms: true } });
            expect(SpaceStore.instance.allRoomsInHome).toBe(false);
        });

        it("follows the setting without Clariva", async () => {
            expect(SpaceStore.instance.allRoomsInHome).toBe(false);
            await changeSetting(true);
            expect(SpaceStore.instance.allRoomsInHome).toBe(true);
            await changeSetting(false);
            expect(SpaceStore.instance.allRoomsInHome).toBe(false);
        });

        it("a setting changed while forced on is still applied (the watcher compares the setting itself)", async () => {
            configureClariva();
            await changeSetting(true);
            SdkConfig.reset();
            expect(SpaceStore.instance.allRoomsInHome).toBe(true);
            configureClariva();
            await changeSetting(false);
            SdkConfig.reset();
            expect(SpaceStore.instance.allRoomsInHome).toBe(false);
        });
    });

    describe("the chat list header's '+'", () => {
        beforeEach(() => {
            DMRoomMap.setShared({ getUserIdForRoomId: jest.fn(), getDMRoomsForUserId: jest.fn() } as any);
            stubClient();
            act(() => {
                SpaceStore.instance.setActiveSpace(MetaSpace.Home);
            });
        });

        it("starts a chat directly ('Start a new chat') instead of a menu of room actions", () => {
            configureClariva();
            const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
            render(<RoomListHeader />);
            expect(screen.queryByLabelText("Add")).toBeNull();
            fireEvent.click(screen.getByRole("button", { name: "Start a new chat" }));
            expect(dispatch).toHaveBeenCalledWith({ action: "view_create_chat" });
            expect(screen.queryByRole("menu")).toBeNull();
        });

        it("keeps the stock menu (with New room) when group rooms are on", () => {
            configureClariva({ features: { group_rooms: true } });
            render(<RoomListHeader />);
            fireEvent.click(screen.getByLabelText("Add"));
            const labels = Array.from(screen.getByRole("menu").querySelectorAll(".mx_IconizedContextMenu_label")).map(
                (el) => el.textContent,
            );
            expect(labels).toEqual(expect.arrayContaining(["Start new chat", "New room"]));
        });
    });
});
