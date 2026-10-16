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
import { render } from "@testing-library/react";

import { RoomTileCallSummary } from "../../src/components/views/rooms/RoomTileCallSummary";
import { ConnectionState } from "../../src/models/Call";
import { MatrixClientPeg } from "../../src/MatrixClientPeg";
import { isVoiceCallInRoom } from "../../src/clariva/calls/memberships";
import * as callsConfig from "../../src/clariva/calls/config";
import { callsStrings } from "../../src/clariva/strings/calls";

let mockConnectionState = ConnectionState.Disconnected;
jest.mock("../../src/hooks/useCall", () => ({
    useConnectionState: () => mockConnectionState,
    useParticipantCount: () => 1,
}));

const ROOM_ID = "!dm:clarivahub.com";
const ME = "@asha:clarivahub.com";
const CALLER = "@rao:clarivahub.com";

/** A room whose only call state is one live call.member for CALLER with the given m.call.intent (undefined = none). */
function roomWithCall(intent: "audio" | "video" | undefined): any {
    const content: Record<string, unknown> = {
        application: "m.call",
        call_id: "",
        scope: "m.room",
        device_id: "DEV",
        expires: 7_200_000,
        focus_active: { type: "livekit", focus_selection: "oldest_membership" },
        foci_preferred: [
            { type: "livekit", livekit_service_url: "http://127.0.0.1:9/livekit/jwt", livekit_alias: ROOM_ID },
        ],
        created_ts: Date.now(),
    };
    if (intent) content["m.call.intent"] = intent;
    const event = {
        getStateKey: () => `_${CALLER}_DEV_m.call`,
        getSender: () => CALLER,
        getContent: () => content,
        getTs: () => Date.now(),
    };
    return {
        roomId: ROOM_ID,
        currentState: { getStateEvents: (type: string) => (type === "org.matrix.msc3401.call.member" ? [event] : []) },
        getMember: (userId: string) => ({ membership: userId === CALLER || userId === ME ? "join" : undefined }),
    };
}

const call: any = { roomId: ROOM_ID };

describe("isVoiceCallInRoom", () => {
    it("is true when every live member says audio", () => {
        expect(isVoiceCallInRoom(roomWithCall("audio"))).toBe(true);
    });

    it("is false for a video call, an unlabelled call, no room and no call", () => {
        expect(isVoiceCallInRoom(roomWithCall("video"))).toBe(false);
        expect(isVoiceCallInRoom(roomWithCall(undefined))).toBe(false);
        expect(isVoiceCallInRoom(null)).toBe(false);
        expect(isVoiceCallInRoom(undefined)).toBe(false);
        expect(isVoiceCallInRoom({ ...roomWithCall("audio"), currentState: { getStateEvents: () => [] } } as any)).toBe(
            false,
        );
    });
});

describe("RoomTileCallSummary with Clariva calls", () => {
    let room: any;

    beforeEach(() => {
        mockConnectionState = ConnectionState.Disconnected;
        room = roomWithCall("audio");
        jest.spyOn(MatrixClientPeg, "get").mockReturnValue({
            getRoom: (id: string) => (id === ROOM_ID ? room : null),
        } as any);
    });

    afterEach(() => jest.restoreAllMocks());

    it("calls a voice call 'Voice' with the phone icon instead of 'Video' with the camera icon", () => {
        jest.spyOn(callsConfig, "isClarivaCallsEnabled").mockReturnValue(true);
        const { container } = render(<RoomTileCallSummary call={call} />);

        expect(container.textContent).toContain(callsStrings.liveVoice);
        expect(container.textContent).not.toContain("Video");
        expect(container.querySelector(".mx_LiveContentSummary_text_voice")).not.toBeNull();
        expect(container.querySelector(".mx_LiveContentSummary_text_video")).toBeNull();
    });

    it("keeps the voice icon while connected (the text is Element's 'Joined')", () => {
        jest.spyOn(callsConfig, "isClarivaCallsEnabled").mockReturnValue(true);
        mockConnectionState = ConnectionState.Connected;
        const { container } = render(<RoomTileCallSummary call={call} />);

        expect(container.textContent).toContain("Joined");
        expect(container.querySelector(".mx_LiveContentSummary_text_voice")).not.toBeNull();
    });

    it("still says 'Video' with the camera icon for a video call", () => {
        jest.spyOn(callsConfig, "isClarivaCallsEnabled").mockReturnValue(true);
        room = roomWithCall("video");
        const { container } = render(<RoomTileCallSummary call={call} />);

        expect(container.textContent).toContain("Video");
        expect(container.querySelector(".mx_LiveContentSummary_text_video")).not.toBeNull();
        expect(container.querySelector(".mx_LiveContentSummary_text_voice")).toBeNull();
    });

    it("is byte-for-byte Element's behaviour when the Clariva calls flag is off", () => {
        jest.spyOn(callsConfig, "isClarivaCallsEnabled").mockReturnValue(false);
        const { container } = render(<RoomTileCallSummary call={call} />);

        expect(container.textContent).toContain("Video");
        expect(container.querySelector(".mx_LiveContentSummary_text_video")).not.toBeNull();
        expect(container.querySelector(".mx_LiveContentSummary_text_voice")).toBeNull();
    });
});
