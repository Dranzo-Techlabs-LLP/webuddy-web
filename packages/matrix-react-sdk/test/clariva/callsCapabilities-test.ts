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

import { mocked } from "jest-mock";
import { MatrixWidgetType, Widget, WidgetKind } from "matrix-widget-api";

import { getElementCallCapabilities, membershipStateKeys } from "../../src/clariva/calls/capabilities";
import { StopGapWidgetDriver } from "../../src/stores/widgets/StopGapWidgetDriver";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import SdkConfig from "../../src/SdkConfig";
import Modal from "../../src/Modal";
import { stubClient } from "../test-utils";

const USER = "@me:clarivahub.com";
const DEVICE = "DEVICE1";
const ROOM = "!room:clarivahub.com";

/**
 * Every capability Element Call 0.16.3 requests, written out as raw strings from its `src/widget.ts` (recovered from
 * the source map of the build Android bundles). Deliberately NOT built with the same helpers as the implementation, so a
 * wrong format or a forgotten entry fails here.
 */
function ecRequested(): string[] {
    const sendEvents = ["org.matrix.msc4075.call.notify", "org.matrix.msc4075.rtc.notification"];
    const sendRecvEvents = [
        "org.matrix.rageshake_request",
        "io.element.call.encryption_keys",
        "m.reaction",
        "m.room.redaction",
        "io.element.call.reaction",
        "org.matrix.msc4310.rtc.decline",
    ];
    const sendStateKeys = [USER, `_${USER}_${DEVICE}_m.call`, `${USER}_${DEVICE}_m.call`];
    const receiveState = [
        "m.room.create",
        "m.room.name",
        "m.room.member",
        "m.room.encryption",
        "org.matrix.msc3401.call.member",
    ];
    const toDevice = [
        "m.call.invite",
        "m.call.candidates",
        "m.call.answer",
        "m.call.hangup",
        "m.call.reject",
        "m.call.select_answer",
        "m.call.negotiate",
        "m.call.sdp_stream_metadata_changed",
        "org.matrix.call.sdp_stream_metadata_changed",
        "m.call.replaces",
        "io.element.call.encryption_keys",
    ];
    return [
        "m.always_on_screen",
        `org.matrix.msc2762.timeline:${ROOM}`,
        "org.matrix.msc4157.send.delayed_event",
        "org.matrix.msc4157.update_delayed_event",
        ...sendEvents.map((t) => `org.matrix.msc2762.send.event:${t}`),
        ...sendRecvEvents.flatMap((t) => [
            `org.matrix.msc2762.send.event:${t}`,
            `org.matrix.msc2762.receive.event:${t}`,
        ]),
        ...sendStateKeys.map((k) => `org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member#${k}`),
        ...receiveState.map((t) => `org.matrix.msc2762.receive.state_event:${t}`),
        ...toDevice.flatMap((t) => [
            `org.matrix.msc3819.send.to_device:${t}`,
            `org.matrix.msc3819.receive.to_device:${t}`,
        ]),
    ];
}

describe("Element Call 0.16.3 capabilities", () => {
    it("approves every capability EC requests", () => {
        const approved = new Set(getElementCallCapabilities({ userId: USER, deviceId: DEVICE, roomId: ROOM }));
        const missing = ecRequested().filter((cap) => !approved.has(cap));
        expect(missing).toEqual([]);
    });

    it("covers exactly what the 3.108 allow-list was missing (the silent-failure causes)", () => {
        const approved = new Set(getElementCallCapabilities({ userId: USER, deviceId: DEVICE, roomId: ROOM }));
        for (const cap of [
            // membership state key with the `_m.call` suffix, both spellings
            `org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member#_${USER}_${DEVICE}_m.call`,
            `org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member#${USER}_${DEVICE}_m.call`,
            // the ring and the decline
            "org.matrix.msc2762.send.event:org.matrix.msc4075.rtc.notification",
            "org.matrix.msc2762.send.event:org.matrix.msc4075.call.notify",
            "org.matrix.msc2762.send.event:org.matrix.msc4310.rtc.decline",
            "org.matrix.msc2762.receive.event:org.matrix.msc4310.rtc.decline",
            // reactions, raised hands, redactions
            "org.matrix.msc2762.send.event:m.reaction",
            "org.matrix.msc2762.receive.event:m.reaction",
            "org.matrix.msc2762.send.event:io.element.call.reaction",
            "org.matrix.msc2762.receive.event:m.room.redaction",
            // room name, and the to-device key transport
            "org.matrix.msc2762.receive.state_event:m.room.name",
            "org.matrix.msc3819.send.to_device:io.element.call.encryption_keys",
            "org.matrix.msc3819.receive.to_device:io.element.call.encryption_keys",
            // MSC4140 delayed leave
            "org.matrix.msc4157.send.delayed_event",
            "org.matrix.msc4157.update_delayed_event",
        ]) {
            expect(approved).toContain(cap);
        }
    });

    it("is a de-duplicated list and grants the per-room timeline only for the given room", () => {
        const list = getElementCallCapabilities({ userId: USER, deviceId: DEVICE, roomId: ROOM });
        expect(new Set(list).size).toBe(list.length);
        expect(list).toContain(`org.matrix.msc2762.timeline:${ROOM}`);
        const noRoom = getElementCallCapabilities({ userId: USER, deviceId: DEVICE });
        expect(noRoom.some((c) => c.startsWith("org.matrix.msc2762.timeline:"))).toBe(false);
    });

    it("never grants anything about another user's membership", () => {
        const list = getElementCallCapabilities({ userId: USER, deviceId: DEVICE, roomId: ROOM });
        const stateKeys = list
            .filter((c) => c.startsWith("org.matrix.msc2762.send.state_event:"))
            .map((c) => c.split("#")[1]);
        expect(stateKeys.sort()).toEqual([USER, `_${USER}_${DEVICE}_m.call`, `${USER}_${DEVICE}_m.call`].sort());
    });

    it("without a device id only the legacy user-keyed state key can be approved", () => {
        expect(membershipStateKeys(USER, null)).toEqual([USER]);
        expect(membershipStateKeys(USER, DEVICE)).toEqual([
            USER,
            `_${USER}_${DEVICE}_m.call`,
            `${USER}_${DEVICE}_m.call`,
        ]);
    });
});

describe("StopGapWidgetDriver with Clariva calls", () => {
    const EC_URL = "https://call.test/element-call/";

    beforeEach(() => {
        stubClient();
        const client = mocked(MatrixClientPeg.safeGet());
        client.getUserId.mockReturnValue(USER);
        client.getSafeUserId.mockReturnValue(USER);
        client.getDeviceId.mockReturnValue(DEVICE);
        jest.spyOn(Modal, "createDialog").mockImplementation(() => {
            throw new Error("Should not have to create a dialog");
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        SdkConfig.reset();
    });

    const configure = (calls: boolean): void => {
        SdkConfig.reset();
        SdkConfig.add({
            clariva: { api_base_url: "https://api.test", features: { calls } },
            element_call: { url: EC_URL },
        } as any);
    };

    const driver = (): StopGapWidgetDriver =>
        new StopGapWidgetDriver(
            [],
            new Widget({
                id: "call_widget",
                creatorUserId: USER,
                type: MatrixWidgetType.Custom,
                url: `${EC_URL}index.html#?intent=start_call_dm`,
            }),
            WidgetKind.Room,
            true,
            ROOM,
        );

    it("pre-approves the whole EC 0.16.3 request without prompting when calls are on", async () => {
        configure(true);
        const requested = new Set(ecRequested());
        const approved = await driver().validateCapabilities(requested);
        expect([...requested].filter((cap) => !approved.has(cap))).toEqual([]);
    });

    it("leaves the new capabilities to the stock prompt when calls are off", async () => {
        configure(false);
        const decline = "org.matrix.msc2762.send.event:org.matrix.msc4310.rtc.decline";
        const membership = `org.matrix.msc2762.send.state_event:org.matrix.msc3401.call.member#_${USER}_${DEVICE}_m.call`;
        const approved = await driver().validateCapabilities(new Set([decline, membership]));
        expect(approved.has(decline)).toBe(false);
        expect(approved.has(membership)).toBe(false);
    });
});
