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
    type ElementCallIntent,
    callTypeForVoiceFlag,
    intentFor,
    intentSkipsLobby,
    isDmIntent,
    isJoinIntent,
    isVoiceIntent,
    mediaTypeForJoin,
    mediaTypeForRing,
    mediaTypeOfIntent,
    parseApiCallType,
    parseWireCallIntent,
    wireIntentOf,
} from "../../src/clariva/calls/intent";
import { callsStrings, incomingCallLabel } from "../../src/clariva/strings/calls";

describe("intentFor (Android DefaultCallWidgetSettingsProvider, spec 04 §3.4.1)", () => {
    const cases: Array<[boolean, boolean, boolean, ElementCallIntent]> = [
        // direct, hasActiveCall, voice
        [true, true, true, "join_existing_dm_voice"],
        [true, true, false, "join_existing_dm"],
        [false, true, true, "join_existing"],
        [false, true, false, "join_existing"],
        [true, false, true, "start_call_dm_voice"],
        [true, false, false, "start_call_dm"],
        [false, false, true, "start_call"],
        [false, false, false, "start_call"],
    ];
    it.each(cases)("direct=%s active=%s voice=%s -> %s", (direct, hasActiveCall, voice, expected) => {
        expect(intentFor({ direct, hasActiveCall, voice })).toBe(expected);
    });

    it("classifies intents", () => {
        expect(isDmIntent("start_call_dm")).toBe(true);
        expect(isDmIntent("join_existing_dm_voice")).toBe(true);
        expect(isDmIntent("start_call")).toBe(false);
        expect(isDmIntent("join_existing")).toBe(false);

        expect(isVoiceIntent("start_call_dm_voice")).toBe(true);
        expect(isVoiceIntent("join_existing_dm_voice")).toBe(true);
        expect(isVoiceIntent("start_call_dm")).toBe(false);
        expect(isVoiceIntent("start_call")).toBe(false);

        expect(isJoinIntent("join_existing")).toBe(true);
        expect(isJoinIntent("join_existing_dm")).toBe(true);
        expect(isJoinIntent("start_call_dm")).toBe(false);

        expect(mediaTypeOfIntent("start_call_dm_voice")).toBe("voice");
        expect(mediaTypeOfIntent("join_existing_dm")).toBe("video");
    });

    it("skips the host lobby exactly for the DM intents (EC skips its own lobby for them)", () => {
        expect(intentSkipsLobby("start_call_dm")).toBe(true);
        expect(intentSkipsLobby("start_call_dm_voice")).toBe(true);
        expect(intentSkipsLobby("join_existing_dm")).toBe(true);
        expect(intentSkipsLobby("join_existing_dm_voice")).toBe(true);
        expect(intentSkipsLobby("start_call")).toBe(false);
        expect(intentSkipsLobby("join_existing")).toBe(false);
    });
});

describe("call type defaults (spec 04 §3.7, §6.9)", () => {
    it("maps the on-wire m.call.intent", () => {
        expect(parseWireCallIntent("audio")).toBe("voice");
        expect(parseWireCallIntent("video")).toBe("video");
        expect(parseWireCallIntent("voice")).toBeNull();
        expect(parseWireCallIntent(undefined)).toBeNull();
        expect(wireIntentOf({ "m.call.intent": "audio" })).toBe("voice");
        expect(wireIntentOf({})).toBeNull();
        expect(wireIntentOf(null)).toBeNull();
        expect(wireIntentOf("audio")).toBeNull();
    });

    it("only accepts the Wallet vocabulary", () => {
        expect(parseApiCallType("voice")).toBe("voice");
        expect(parseApiCallType("video")).toBe("video");
        expect(parseApiCallType("audio")).toBeNull();
        expect(parseApiCallType(null)).toBeNull();
    });

    it("a RING with nothing known is a voice call (camera off unless the caller chose video)", () => {
        expect(mediaTypeForRing(null, null)).toBe("voice");
        expect(mediaTypeForRing(null, "video")).toBe("video");
        expect(mediaTypeForRing(null, "voice")).toBe("voice");
    });

    it("a JOIN with nothing known is a video call (only an explicit voice record turns the camera off)", () => {
        expect(mediaTypeForJoin(null, null)).toBe("video");
        expect(mediaTypeForJoin(null, "voice")).toBe("voice");
        expect(mediaTypeForJoin(null, "video")).toBe("video");
    });

    it("the per-call on-wire value beats the per-room Wallet record in both directions", () => {
        expect(mediaTypeForRing("video", "voice")).toBe("video");
        expect(mediaTypeForRing("voice", "video")).toBe("voice");
        expect(mediaTypeForJoin("voice", "video")).toBe("voice");
        expect(mediaTypeForJoin("video", "voice")).toBe("video");
    });

    it("writes the chooser choice in the Wallet vocabulary", () => {
        expect(callTypeForVoiceFlag(true)).toBe("voice");
        expect(callTypeForVoiceFlag(false)).toBe("video");
    });
});

describe("strings (verbatim from Android, spec 04 §2.12)", () => {
    it("matches the Android copy", () => {
        expect(callsStrings.startCall).toBe("Start a call");
        expect(callsStrings.chooseHowToCall).toBe("Choose how you want to call.");
        expect(callsStrings.voiceCall).toBe("Voice call");
        expect(callsStrings.videoCall).toBe("Video call");
        expect(callsStrings.cancel).toBe("Cancel");
        expect(callsStrings.join).toBe("Join");
        expect(callsStrings.callStarted).toBe("Call started");
        expect(callsStrings.accept).toBe("Accept");
        expect(callsStrings.reject).toBe("Reject");
        expect(callsStrings.incomingCall).toBe("Incoming call");
        expect(incomingCallLabel("voice")).toBe("Incoming voice call");
        expect(incomingCallLabel("video")).toBe("Incoming video call");
    });
});
