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
import { EventEmitter } from "events";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type MatrixClient, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import Modal from "../../src/Modal";
import defaultDispatcher from "../../src/dispatcher/dispatcher";
import { Action } from "../../src/dispatcher/actions";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import { useCall, useConnectionState } from "../../src/hooks/useCall";
import { type Call, ConnectionState } from "../../src/models/Call";
import { CallView } from "../../src/components/views/voip/CallView";
import { useClarivaCallDmPeerId, useClarivaCallRestriction, useClarivaDmPeerId } from "../../src/clariva/chat";
import { ClarivaCalls } from "../../src/clariva/calls/runtime";
import {
    useClarivaDmCalls,
    useLatestCallStartedEventId,
    useRoomCallState,
    type RoomCallState,
} from "../../src/clariva/calls/hooks";
import { IncomingCallsManager, type IncomingCallsHost } from "../../src/clariva/calls/incomingCalls";
import { setIncomingCalls } from "../../src/clariva/calls/registry";
import { setRingSoundBlocked } from "../../src/clariva/calls/callAudio";
import { ClarivaCallChooserDialog } from "../../src/clariva/components/calls/ClarivaCallChooserDialog";
import { ClarivaCallControls, chooseAndStartCall } from "../../src/clariva/components/calls/ClarivaCallControls";
import { ClarivaCallStartedTile } from "../../src/clariva/components/calls/ClarivaCallStartedTile";
import { ClarivaCallViewTitle } from "../../src/clariva/components/calls/ClarivaCallViewTitle";
import { ClarivaIncomingCallToast } from "../../src/clariva/components/calls/ClarivaIncomingCallToast";
import { stubClient } from "../test-utils";

// The runtime pulls in the whole call stack (widgets, stores, audio); the UI only needs its two entry points.
jest.mock("../../src/clariva/calls/runtime", () => ({
    ClarivaCalls: {
        startCall: jest.fn(async () => "start_call_dm"),
        joinCall: jest.fn(async () => "join_existing_dm"),
    },
}));
// The gate is the chat workstream's; here it is just a switch.
// The billing peer (m.direct only) and the CALL peer (also an unlisted 1:1 chat) are different hooks; the call controls
// must use the second. Here only the second knows the peer.
jest.mock("../../src/clariva/chat", () => ({
    useClarivaCallRestriction: jest.fn(() => false),
    useClarivaCallDmPeerId: jest.fn(() => "@rao:clarivahub.com"),
    useClarivaDmPeerId: jest.fn(() => null),
}));
// The avatars need DMRoomMap and a full room; they are not what is tested here (their size is).
jest.mock("../../src/components/views/avatars/RoomAvatar", () => ({
    __esModule: true,
    default: ({ size }: { size?: string }) => <span data-testid="room-avatar" data-size={size} />,
}));
jest.mock("../../src/components/views/avatars/MemberAvatar", () => ({
    __esModule: true,
    default: ({ size }: { size?: string }) => <span data-testid="member-avatar" data-size={size} />,
}));
jest.mock("../../src/clariva/calls/hooks", () => ({
    ...jest.requireActual("../../src/clariva/calls/hooks"),
    useRoomCallState: jest.fn(),
    useLatestCallStartedEventId: jest.fn(),
    useClarivaDmCalls: jest.fn(),
}));
// The call frame is Element Call's own widget (an iframe); the view around it is what is tested.
jest.mock("../../src/components/views/elements/AppTile", () => ({
    __esModule: true,
    default: () => <div data-testid="app-tile" />,
}));
// The tile asks whether THIS tab is in the call, and the user's clock setting; neither is the UI under test.
jest.mock("../../src/hooks/useCall", () => ({
    useCall: jest.fn(),
    useConnectionState: jest.fn(),
}));
jest.mock("../../src/hooks/useSettings", () => ({
    ...jest.requireActual("../../src/hooks/useSettings"),
    useSettingValue: jest.fn(() => false),
}));

const PEER = "@rao:clarivahub.com";
const ROOM_ID = "!dm:clarivahub.com";

const callState = (overrides: Partial<RoomCallState> = {}): RoomCallState => ({
    memberships: [],
    hasOngoingCall: false,
    meInCall: false,
    peerInCall: false,
    media: null,
    ...overrides,
});

describe("Clariva call UI", () => {
    let client: MatrixClient;
    let room: Room;

    beforeEach(() => {
        client = stubClient();
        room = Object.assign(new EventEmitter(), {
            roomId: ROOM_ID,
            client,
            currentState: Object.assign(new EventEmitter(), { mayClientSendStateEvent: jest.fn(() => true) }),
        }) as unknown as Room;
        jest.mocked(useClarivaCallRestriction).mockReturnValue(false);
        jest.mocked(useRoomCallState).mockReturnValue(callState());
        jest.mocked(useLatestCallStartedEventId).mockReturnValue(undefined);
        jest.mocked(useCall).mockReturnValue(null);
        jest.mocked(useConnectionState).mockReturnValue(ConnectionState.Disconnected);
        jest.mocked(ClarivaCalls.startCall).mockClear();
        jest.mocked(ClarivaCalls.joinCall).mockClear();
        jest.mocked(useClarivaCallDmPeerId).mockReset().mockReturnValue(PEER);
        jest.mocked(useClarivaDmPeerId).mockReset().mockReturnValue(null);
    });

    afterEach(() => {
        cleanup();
        jest.restoreAllMocks();
        setIncomingCalls(null);
        setRingSoundBlocked(false);
    });

    describe("ClarivaCallChooserDialog", () => {
        it("shows the Android copy: 'Start a call' / 'Choose how you want to call.'", () => {
            render(<ClarivaCallChooserDialog onFinished={jest.fn()} />);
            expect(screen.getByText("Start a call")).toBeInTheDocument();
            expect(screen.getByText("Choose how you want to call.")).toBeInTheDocument();
            expect(screen.getByText("Voice call")).toBeInTheDocument();
            expect(screen.getByText("Video call")).toBeInTheDocument();
            expect(screen.getByText("Cancel")).toBeInTheDocument();
        });

        it("reports the choice, or nothing for Cancel", () => {
            const onFinished = jest.fn();
            render(<ClarivaCallChooserDialog onFinished={onFinished} />);
            fireEvent.click(screen.getByTestId("clariva-call-voice"));
            expect(onFinished).toHaveBeenLastCalledWith("voice");
            fireEvent.click(screen.getByTestId("clariva-call-video"));
            expect(onFinished).toHaveBeenLastCalledWith("video");
            fireEvent.click(screen.getByTestId("clariva-call-cancel"));
            expect(onFinished).toHaveBeenLastCalledWith();
        });

        it("offers Voice, Video and Cancel as plain buttons, in that order, named by their words", () => {
            render(<ClarivaCallChooserDialog onFinished={jest.fn()} />);
            const voice = screen.getByRole("button", { name: "Voice call" });
            const video = screen.getByRole("button", { name: "Video call" });
            const cancel = screen.getByRole("button", { name: "Cancel" });
            for (const button of [voice, video, cancel]) {
                expect(button.tagName).toBe("BUTTON");
                expect(button).toHaveAttribute("type", "button"); // never submits a surrounding form
                // upstream restyles every dialog <button> as an outlined pill unless it opts out
                expect(button).toHaveClass("mx_Dialog_nonDialogButton");
            }
            expect(voice).toBe(screen.getByTestId("clariva-call-voice"));
            expect(video).toBe(screen.getByTestId("clariva-call-video"));
            // one list: two 64px tiles, then the quiet Cancel
            const options = voice.parentElement!;
            expect(Array.from(options.children)).toEqual([voice, video, cancel]);
            expect(voice).toHaveClass("mx_ClarivaCallChooser_option");
            expect(video).toHaveClass("mx_ClarivaCallChooser_option");
            expect(cancel).toHaveClass("mx_ClarivaCallChooser_cancel");
        });

        it("the icon discs are decoration: hidden from assistive technology, the label is the name", () => {
            render(<ClarivaCallChooserDialog onFinished={jest.fn()} />);
            for (const testId of ["clariva-call-voice", "clariva-call-video"]) {
                const option = screen.getByTestId(testId);
                const disc = option.querySelector(".mx_ClarivaCallChooser_icon");
                expect(disc).toHaveAttribute("aria-hidden", "true");
                expect(disc!.querySelector("svg, div")).not.toBeNull(); // the icon is inside the disc
                expect(option.querySelector(".mx_ClarivaCallChooser_label")).toHaveTextContent(/^(Voice|Video) call$/);
            }
        });

        it("keyboard: Tab walks Voice, Video, Cancel and Enter or Space picks the one that has focus", async () => {
            const user = userEvent.setup();
            const onFinished = jest.fn();
            render(<ClarivaCallChooserDialog onFinished={onFinished} />);
            const voice = screen.getByTestId("clariva-call-voice");
            const video = screen.getByTestId("clariva-call-video");
            const cancel = screen.getByTestId("clariva-call-cancel");

            voice.focus();
            expect(voice).toHaveFocus();
            await user.tab();
            expect(video).toHaveFocus();
            await user.keyboard("{Enter}");
            expect(onFinished).toHaveBeenLastCalledWith("video");

            await user.tab();
            expect(cancel).toHaveFocus();
            await user.keyboard(" ");
            expect(onFinished).toHaveBeenLastCalledWith();

            voice.focus();
            await user.keyboard("{Enter}");
            expect(onFinished).toHaveBeenLastCalledWith("voice");
        });

        it("keyboard: Down and Up walk Voice, Video and Cancel and wrap round; Enter then picks the one that has focus", async () => {
            const user = userEvent.setup();
            const onFinished = jest.fn();
            render(<ClarivaCallChooserDialog onFinished={onFinished} />);
            const voice = screen.getByTestId("clariva-call-voice");
            const video = screen.getByTestId("clariva-call-video");
            const cancel = screen.getByTestId("clariva-call-cancel");

            voice.focus();
            await user.keyboard("{ArrowDown}");
            expect(video).toHaveFocus();
            await user.keyboard("{ArrowDown}");
            expect(cancel).toHaveFocus();
            await user.keyboard("{ArrowDown}");
            expect(voice).toHaveFocus(); // past the last: back to the first
            await user.keyboard("{ArrowUp}");
            expect(cancel).toHaveFocus(); // before the first: the last
            await user.keyboard("{ArrowUp}");
            expect(video).toHaveFocus();

            await user.keyboard("{Enter}");
            expect(onFinished).toHaveBeenLastCalledWith("video");
        });

        it("keyboard: an arrow with a modifier, or from outside the list, moves nothing", async () => {
            const user = userEvent.setup();
            render(<ClarivaCallChooserDialog onFinished={jest.fn()} />);
            const voice = screen.getByTestId("clariva-call-voice");

            voice.focus();
            await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
            expect(voice).toHaveFocus();

            (document.activeElement as HTMLElement).blur();
            await user.keyboard("{ArrowDown}");
            expect(voice).not.toHaveFocus();
            expect(screen.getByTestId("clariva-call-video")).not.toHaveFocus();
        });
    });

    describe("chooseAndStartCall", () => {
        const choose = (choice: "voice" | "video" | undefined): jest.SpyInstance =>
            jest.spyOn(Modal, "createDialog").mockReturnValue({ finished: Promise.resolve([choice]) } as any);

        it("Voice starts a voice call, Video a video call, Cancel nothing", async () => {
            choose("voice");
            await chooseAndStartCall(room);
            expect(ClarivaCalls.startCall).toHaveBeenLastCalledWith(room, true);

            choose("video");
            await chooseAndStartCall(room);
            expect(ClarivaCalls.startCall).toHaveBeenLastCalledWith(room, false);

            jest.mocked(ClarivaCalls.startCall).mockClear();
            choose(undefined);
            await chooseAndStartCall(room);
            expect(ClarivaCalls.startCall).not.toHaveBeenCalled();
        });

        it("a failing start is logged, not thrown", async () => {
            choose("voice");
            jest.mocked(ClarivaCalls.startCall).mockRejectedValueOnce(new Error("widget"));
            await expect(chooseAndStartCall(room)).resolves.toBeUndefined();
        });
    });

    describe("ClarivaCallControls (header)", () => {
        const renderControls = (props: Partial<React.ComponentProps<typeof ClarivaCallControls>> = {}) =>
            render(
                <MatrixClientContext.Provider value={client}>
                    <ClarivaCallControls
                        room={room}
                        disabledReason={null}
                        isViewingCall={false}
                        isConnectedToCall={false}
                        onToggleCall={jest.fn()}
                        {...props}
                    />
                </MatrixClientContext.Provider>,
            );

        it("one phone button 'Start a call' that opens the chooser", () => {
            const createDialog = jest
                .spyOn(Modal, "createDialog")
                .mockReturnValue({ finished: new Promise(() => {}) } as any);
            renderControls();
            const phone = screen.getByTestId("clariva-call-start");
            expect(phone).toHaveAttribute("aria-label", "Start a call");
            expect(screen.queryByTestId("clariva-call-join")).toBeNull();
            fireEvent.click(phone);
            expect(createDialog).toHaveBeenCalledWith(ClarivaCallChooserDialog, {});
        });

        it("decides on the CALL peer, never on the billing peer (one DM-ness for the controls, the ring and the legacy toast)", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            renderControls();
            expect(useClarivaCallDmPeerId).toHaveBeenCalledWith(room);
            expect(useClarivaDmPeerId).not.toHaveBeenCalled();
            // the call peer is what the call state is read for
            expect(useRoomCallState).toHaveBeenCalledWith(room, expect.any(String), PEER);
        });

        it("a client who cannot afford the consultant gets NO call controls (hidden, not disabled)", () => {
            jest.mocked(useClarivaCallRestriction).mockReturnValue(true);
            const { container } = renderControls();
            expect(container).toBeEmptyDOMElement();

            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            const again = renderControls();
            expect(again.container).toBeEmptyDOMElement();
        });

        it("a call in progress shows Join (whatever its media), billed when pressed", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "voice" }));
            renderControls();
            const join = screen.getByTestId("clariva-call-join");
            expect(join).toHaveTextContent("Join");
            expect(screen.queryByTestId("clariva-call-start")).toBeNull();
            fireEvent.click(join);
            expect(ClarivaCalls.joinCall).toHaveBeenCalledWith(room, { billing: true });
        });

        it("Join stays available when my other device is in the call (only the local tab hides it)", () => {
            jest.mocked(useRoomCallState).mockReturnValue(
                callState({ hasOngoingCall: true, meInCall: true, media: "video" }),
            );
            renderControls();
            expect(screen.getByTestId("clariva-call-join")).toBeInTheDocument();
        });

        it("is disabled, with the reason as its name, without permission or while another call is connected", () => {
            renderControls({ disabledReason: "You do not have permission to start calls" });
            const phone = screen.getByTestId("clariva-call-start");
            expect(phone).toHaveAttribute("aria-disabled", "true"); // Compound's IconButton does not use `disabled`
            expect(phone).toHaveAttribute("aria-label", "You do not have permission to start calls");
            cleanup();

            (room.currentState.mayClientSendStateEvent as jest.Mock).mockReturnValue(false);
            renderControls();
            expect(screen.getByTestId("clariva-call-start")).toHaveAttribute("aria-disabled", "true");
        });

        it("connected here: maximise / minimise, even for a restricted client", () => {
            jest.mocked(useClarivaCallRestriction).mockReturnValue(true);
            const onToggleCall = jest.fn();
            renderControls({ isConnectedToCall: true, onToggleCall });
            fireEvent.click(screen.getByTestId("clariva-call-toggle"));
            expect(onToggleCall).toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId("clariva-call-start")).toBeNull();
        });

        it("viewing the call while it connects: a close button", () => {
            const onToggleCall = jest.fn();
            renderControls({ isViewingCall: true, onToggleCall });
            fireEvent.click(screen.getByTestId("clariva-call-close"));
            expect(onToggleCall).toHaveBeenCalledTimes(1);
        });

        it("every control carries the shared style hook and its own variant (the stylesheet hangs on them)", () => {
            renderControls();
            expect(screen.getByTestId("clariva-call-start")).toHaveClass(
                "mx_ClarivaCallControl",
                "mx_ClarivaCallControl_start",
            );
            expect(screen.getByTestId("clariva-call-start")).not.toHaveClass("mx_ClarivaCallControl_live");
            cleanup();

            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            renderControls();
            // the old hook stays: stock and older partials still select it
            expect(screen.getByTestId("clariva-call-join")).toHaveClass(
                "mx_RoomHeader_join_button",
                "mx_ClarivaCallControl",
                "mx_ClarivaCallControl_join",
            );
            cleanup();

            renderControls({ isConnectedToCall: true });
            expect(screen.getByTestId("clariva-call-toggle")).toHaveClass(
                "mx_ClarivaCallControl",
                "mx_ClarivaCallControl_toggle",
                "mx_ClarivaCallControl_live", // the Deep Teal "you are in a call" disc
            );
            cleanup();

            renderControls({ isViewingCall: true });
            expect(screen.getByTestId("clariva-call-close")).toHaveClass(
                "mx_ClarivaCallControl",
                "mx_ClarivaCallControl_close",
            );
            expect(screen.getByTestId("clariva-call-close")).not.toHaveClass("mx_ClarivaCallControl_live");
        });

        it("Join shows the icon of the running call: phone for voice, camera for video (and for a call that does not say)", () => {
            for (const [media, icon] of [
                ["voice", "voice"],
                ["video", "video"],
                [null, "video"],
            ] as const) {
                jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media }));
                const { unmount } = renderControls();
                expect(screen.getByTestId("clariva-call-join")).toHaveAttribute("data-call-icon", icon);
                unmount();
            }
        });

        it("accessible names are unchanged by the restyle", () => {
            renderControls();
            expect(screen.getByRole("button", { name: "Start a call" })).toBe(screen.getByTestId("clariva-call-start"));
            cleanup();

            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "voice" }));
            renderControls();
            expect(screen.getByRole("button", { name: "Join" })).toBe(screen.getByTestId("clariva-call-join"));
            cleanup();

            renderControls({ isConnectedToCall: true });
            expect(screen.getByRole("button", { name: "Maximise call" })).toBe(
                screen.getByTestId("clariva-call-toggle"),
            );
            cleanup();

            renderControls({ isConnectedToCall: true, isViewingCall: true });
            expect(screen.getByRole("button", { name: "Minimise call" })).toBe(
                screen.getByTestId("clariva-call-toggle"),
            );
            cleanup();

            renderControls({ isViewingCall: true });
            expect(screen.getByRole("button", { name: "Close" })).toBe(screen.getByTestId("clariva-call-close"));
        });

        it("a disabled Join keeps its reason as its name and does not start anything", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            renderControls({ disabledReason: "Another call is connected" });
            const join = screen.getByTestId("clariva-call-join");
            expect(join).toHaveAttribute("aria-label", "Another call is connected");
            expect(join).toHaveAttribute("aria-disabled", "true");
            fireEvent.click(join);
            expect(ClarivaCalls.joinCall).not.toHaveBeenCalled();
        });
    });

    describe("ClarivaIncomingCallToast", () => {
        function startRing(mediaIntent: "audio" | "video" | undefined): {
            host: jest.Mocked<IncomingCallsHost>;
            manager: IncomingCallsManager;
        } {
            const host = {
                now: () => Date.now(),
                myUserId: () => "@asha:clarivahub.com",
                dmPeerOf: () => PEER,
                liveMemberships: () => [
                    {
                        sender: PEER,
                        deviceId: "D",
                        stateKey: "k",
                        createdTs: Date.now(),
                        expiresAt: Date.now() + 1e7,
                        media: null,
                    },
                ],
                waitForMembership: jest.fn(async () => true),
                fetchCallType: jest.fn(async () => null),
                isBusy: () => false,
                sendDecline: jest.fn(async () => undefined),
                joinCall: jest.fn(async () => undefined),
                showRing: jest.fn(),
                hideRing: jest.fn(),
                startRingtone: jest.fn(),
                stopRingtone: jest.fn(),
                notifyMissed: jest.fn(),
            } as unknown as jest.Mocked<IncomingCallsHost>;
            const manager = new IncomingCallsManager(host);
            setIncomingCalls(manager);
            void manager.handleRing({
                eventId: "$ring",
                roomId: ROOM_ID,
                sender: PEER,
                originTs: Date.now(),
                content: {
                    notification_type: "ring",
                    lifetime: 30_000,
                    sender_ts: Date.now(),
                    ...(mediaIntent ? { "m.call.intent": mediaIntent } : {}),
                },
            });
            return { host, manager };
        }

        it("names Accept and Reject after the caller and the call type, for assistive technology", async () => {
            jest.mocked(client.getRoom).mockReturnValue({ getMember: () => ({ name: "Dr Rao" }) } as unknown as Room);
            startRing("video");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming video call");
            expect(screen.getByTestId("clariva-ring-accept")).toHaveAttribute(
                "aria-label",
                "Accept video call from Dr Rao",
            );
            expect(screen.getByTestId("clariva-ring-reject")).toHaveAttribute("aria-label", "Reject call from Dr Rao");
            // the visible words are Accept / Reject, and the names contain them (WCAG 2.5.3, label in name)
            expect(screen.getByTestId("clariva-ring-accept")).toHaveTextContent("Accept");
            expect(screen.getByTestId("clariva-ring-reject")).toHaveTextContent("Reject");
            expect(screen.getByRole("button", { name: "Accept video call from Dr Rao" })).toBeInTheDocument();
        });

        it("a voice ring says 'voice' in the name of Accept, and falls back to the Matrix id without a member name", async () => {
            jest.mocked(client.getRoom).mockReturnValue(null);
            startRing("audio");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming voice call");
            expect(screen.getByTestId("clariva-ring-accept")).toHaveAttribute(
                "aria-label",
                `Accept voice call from ${PEER}`,
            );
            expect(screen.getByTestId("clariva-ring-reject")).toHaveAttribute("aria-label", `Reject call from ${PEER}`);
        });

        it("Accept shows the video icon for a video ring and the phone icon for a voice ring", async () => {
            startRing("video");
            const video = render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming video call");
            expect(screen.getByTestId("clariva-ring-accept").querySelector("[data-call-icon]")).toHaveAttribute(
                "data-call-icon",
                "video",
            );
            video.unmount();
            setIncomingCalls(null);

            startRing("audio");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming voice call");
            expect(screen.getByTestId("clariva-ring-accept").querySelector("[data-call-icon]")).toHaveAttribute(
                "data-call-icon",
                "voice",
            );
        });

        it("labels a voice ring 'Incoming voice call' and joins on Accept", async () => {
            jest.mocked(client.getRoom).mockReturnValue({ getMember: () => ({ name: "Dr Rao" }) } as unknown as Room);
            const { host } = startRing("audio");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming voice call");
            expect(screen.getByText("Dr Rao")).toBeInTheDocument(); // the caller's display name, not the Matrix id
            await act(async () => {
                fireEvent.click(screen.getByTestId("clariva-ring-accept"));
            });
            expect(host.joinCall).toHaveBeenCalledWith(ROOM_ID, "voice");
            expect(host.sendDecline).not.toHaveBeenCalled();
        });

        it("labels a video ring 'Incoming video call' and declines on Reject", async () => {
            const { host } = startRing("video");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming video call");
            await act(async () => {
                fireEvent.click(screen.getByTestId("clariva-ring-reject"));
            });
            expect(host.sendDecline).toHaveBeenCalledWith(ROOM_ID, "$ring");
            expect(host.joinCall).not.toHaveBeenCalled();
        });

        it("a ring with no media information is a voice ring", async () => {
            startRing(undefined);
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming voice call");
        });

        it("tells the user to click while the browser keeps the ringtone silent, and drops the hint once it can play", async () => {
            startRing("audio");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming voice call");
            expect(screen.queryByTestId("clariva-ring-sound-hint")).toBeNull();

            act(() => setRingSoundBlocked(true));
            expect(screen.getByTestId("clariva-ring-sound-hint")).toHaveTextContent(
                "Click anywhere to enable call sound",
            );
            expect(screen.getByTestId("clariva-ring-sound-hint")).toHaveAttribute("role", "status");
            // Accept and Reject stay where they are
            expect(screen.getByTestId("clariva-ring-accept")).toBeInTheDocument();
            expect(screen.getByTestId("clariva-ring-reject")).toBeInTheDocument();

            act(() => setRingSoundBlocked(false));
            expect(screen.queryByTestId("clariva-ring-sound-hint")).toBeNull();
        });

        it("the hint is the LAST thing in the toast, below Accept / Reject: it comes and goes without moving them", async () => {
            startRing("audio");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming voice call");
            const accept = screen.getByTestId("clariva-ring-accept");
            const buttons = accept.parentElement!;
            const content = buttons.parentElement!;
            const slotOfButtons = (): number => Array.from(content.children).indexOf(buttons);
            const before = slotOfButtons();

            act(() => setRingSoundBlocked(true));
            const hint = screen.getByTestId("clariva-ring-sound-hint");
            expect(hint.parentElement).toBe(content);
            expect(content.lastElementChild).toBe(hint);
            // it follows the buttons in the document...
            expect(buttons.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            // ...so the buttons keep their place whether it is there or not
            expect(slotOfButtons()).toBe(before);
            expect(screen.getByTestId("clariva-ring-accept")).toBe(accept);

            act(() => setRingSoundBlocked(false));
            expect(slotOfButtons()).toBe(before);
            expect(content.lastElementChild).toBe(buttons);
        });

        it("a toast that mounts while the sound is already blocked shows the hint at once", async () => {
            setRingSoundBlocked(true);
            startRing("video");
            render(<ClarivaIncomingCallToast ringEventId="$ring" />);
            await screen.findByText("Incoming video call");
            expect(screen.getByTestId("clariva-ring-sound-hint")).toBeInTheDocument();
        });

        describe("look (class hooks the stylesheet hangs on)", () => {
            const setTabHidden = (hidden: boolean): void => {
                Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
                document.dispatchEvent(new Event("visibilitychange"));
            };
            afterEach(() => {
                delete (document as { hidden?: boolean }).hidden; // back to the prototype's getter
            });

            it("is one group named after the caller and the call: avatar with two decorative rings, name, label, buttons", async () => {
                jest.mocked(client.getRoom).mockReturnValue({
                    getMember: () => ({ name: "Dr Rao" }),
                } as unknown as Room);
                startRing("video");
                const { container } = render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                await screen.findByText("Incoming video call");

                const group = screen.getByRole("group", { name: "Dr Rao, Incoming video call" });
                expect(group).toHaveClass("mx_ClarivaIncomingCall_content");
                expect(group).toHaveAttribute("data-call-media", "video");

                // the avatar is 56px and carries the rings behind it
                const avatar = screen.getByTestId("clariva-ring-avatar");
                expect(avatar).toHaveClass("mx_ClarivaIncomingCall_avatar");
                expect(screen.getByTestId("room-avatar")).toHaveAttribute("data-size", "56px");
                const rings = Array.from(container.querySelectorAll(".mx_ClarivaIncomingCall_ring"));
                expect(rings).toHaveLength(2);
                expect(rings[1]).toHaveClass("mx_ClarivaIncomingCall_ring_second"); // 0.6s behind the first
                expect(rings[0]).not.toHaveClass("mx_ClarivaIncomingCall_ring_second");
                for (const ring of rings) {
                    expect(ring).toHaveAttribute("aria-hidden", "true"); // decoration: never announced
                    expect(ring.textContent).toBe("");
                    expect(avatar).toContainElement(ring as HTMLElement);
                    // behind the face: the rings come first in the document, the face is painted over them
                    expect(
                        ring.compareDocumentPosition(avatar.querySelector(".mx_ClarivaIncomingCall_face")!) &
                            Node.DOCUMENT_POSITION_FOLLOWING,
                    ).toBeTruthy();
                }
            });

            it("the name is one ellipsised line that keeps its full text, the label says what it is", async () => {
                jest.mocked(client.getRoom).mockReturnValue({
                    getMember: () => ({ name: "Dr Venkata Subramanian Ramakrishnan-Iyer" }),
                } as unknown as Room);
                startRing("audio");
                render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                await screen.findByText("Incoming voice call");
                const name = screen.getByText("Dr Venkata Subramanian Ramakrishnan-Iyer");
                expect(name).toHaveClass("mx_ClarivaIncomingCall_name");
                expect(name).toHaveAttribute("title", "Dr Venkata Subramanian Ramakrishnan-Iyer");
                expect(screen.getByText("Incoming voice call")).toHaveClass("mx_ClarivaIncomingCall_label");
            });

            it("Reject sits before Accept (Accept on the end side), both are pills named by an icon and a word", async () => {
                startRing("video");
                render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                await screen.findByText("Incoming video call");
                const reject = screen.getByTestId("clariva-ring-reject");
                const accept = screen.getByTestId("clariva-ring-accept");
                expect(reject.parentElement).toBe(accept.parentElement);
                expect(reject.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
                for (const button of [reject, accept]) {
                    expect(button).toHaveClass("mx_ClarivaIncomingCall_button");
                    expect(button.querySelector("svg, div")).not.toBeNull();
                    expect(button.querySelector("[aria-hidden='true']")).not.toBeNull(); // the glyph is decoration
                }
                expect(accept).toHaveClass("mx_ClarivaIncomingCall_accept");
                expect(reject).toHaveClass("mx_ClarivaIncomingCall_reject");
            });

            it("the rings run while the tab is visible and are paused (cg-paused) while it is hidden", async () => {
                startRing("audio");
                render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                await screen.findByText("Incoming voice call");
                const avatar = screen.getByTestId("clariva-ring-avatar");
                expect(avatar).not.toHaveClass("cg-paused");

                act(() => setTabHidden(true));
                expect(avatar).toHaveClass("cg-paused");

                act(() => setTabHidden(false));
                expect(avatar).not.toHaveClass("cg-paused");
            });

            it("a toast that mounts while the tab is hidden starts paused, and lets go of the document listener on unmount", async () => {
                startRing("audio");
                setTabHidden(true);
                const removeListener = jest.spyOn(document, "removeEventListener");
                const view = render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                await screen.findByText("Incoming voice call");
                expect(screen.getByTestId("clariva-ring-avatar")).toHaveClass("cg-paused");

                view.unmount();
                expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
            });

            it("does not poll: the rings are CSS, the component sets no timer", async () => {
                startRing("audio");
                // testing-library's own findBy polls with a setInterval: let the ring settle first, then watch a fresh mount
                const settled = render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                await screen.findByText("Incoming voice call");
                settled.unmount();

                const setIntervalSpy = jest.spyOn(window, "setInterval");
                render(<ClarivaIncomingCallToast ringEventId="$ring" />);
                expect(screen.getByText("Incoming voice call")).toBeInTheDocument();
                expect(setIntervalSpy).not.toHaveBeenCalled();
            });
        });

        it("shows nothing for a ring that is over", async () => {
            const { manager } = startRing("audio");
            const { container } = render(<ClarivaIncomingCallToast ringEventId="$gone" />);
            await act(async () => {
                await Promise.resolve();
            });
            expect(container).toBeEmptyDOMElement();
            manager.stop();
        });
    });

    describe("ClarivaCallStartedTile", () => {
        const tileEvent = (id = "$tile"): MatrixEvent =>
            ({
                getRoomId: () => ROOM_ID,
                getId: () => id,
                getTs: () => Date.UTC(2026, 9, 16, 9, 41),
                getSender: () => PEER,
                sender: { name: "Dr Rao" },
            }) as unknown as MatrixEvent;

        const renderTile = (event: MatrixEvent = tileEvent()): ReturnType<typeof render> =>
            render(
                <MatrixClientContext.Provider value={client}>
                    <ClarivaCallStartedTile mxEvent={event} />
                </MatrixClientContext.Provider>,
            );

        beforeEach(() => {
            jest.mocked(client.getRoom).mockReturnValue(room);
            jest.mocked(useLatestCallStartedEventId).mockReturnValue("$tile");
        });

        it("the newest tile of a running call is live: teal-edged, with Join (icon of the call) and no time", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            renderTile();
            const tile = screen.getByTestId("clariva-call-started");
            expect(tile).toHaveClass("mx_ClarivaCallStarted", "mx_ClarivaCallStarted_live");
            expect(tile).not.toHaveClass("mx_ClarivaCallStarted_history");
            expect(tile).toHaveAttribute("data-live", "true");

            expect(screen.getByText("Dr Rao")).toHaveClass("mx_ClarivaCallStarted_name");
            expect(screen.getByText("Call started")).toBeInTheDocument();
            const join = screen.getByTestId("clariva-tile-join");
            expect(join).toHaveClass("mx_ClarivaCallStarted_join");
            expect(join).toHaveTextContent("Join");
            expect(join).toHaveAttribute("data-call-icon", "video");
            expect(tile.querySelector(".mx_ClarivaCallStarted_icon")).toHaveAttribute("data-call-icon", "video");
            expect(tile.querySelector(".mx_ClarivaCallStarted_time")).toBeNull();
        });

        it("a live voice call shows the phone, not the camera", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "voice" }));
            renderTile();
            const tile = screen.getByTestId("clariva-call-started");
            expect(screen.getByTestId("clariva-tile-join")).toHaveAttribute("data-call-icon", "voice");
            expect(tile.querySelector(".mx_ClarivaCallStarted_icon")).toHaveAttribute("data-call-icon", "voice");
        });

        it("an older tile is history: quiet, the sent time instead of Join, always the phone (whatever the call is now)", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            jest.mocked(useLatestCallStartedEventId).mockReturnValue("$newer");
            renderTile();
            const tile = screen.getByTestId("clariva-call-started");
            expect(tile).toHaveClass("mx_ClarivaCallStarted_history");
            expect(tile).not.toHaveClass("mx_ClarivaCallStarted_live");
            expect(tile).toHaveAttribute("data-live", "false");
            expect(screen.queryByTestId("clariva-tile-join")).toBeNull();
            expect(tile.querySelector(".mx_ClarivaCallStarted_time")).toHaveTextContent(/^\d{1,2}:\d{2}/);
            expect(tile.querySelector(".mx_ClarivaCallStarted_icon")).toHaveAttribute("data-call-icon", "voice");
        });

        it("the newest tile of a call that is over is history too (no Join for a call nobody is in)", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: false }));
            renderTile();
            expect(screen.getByTestId("clariva-call-started")).toHaveClass("mx_ClarivaCallStarted_history");
            expect(screen.queryByTestId("clariva-tile-join")).toBeNull();
        });

        it("a live tile whose Join is hidden (restricted chat, or this tab is in the call) stays live, with neither Join nor time", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "voice" }));

            jest.mocked(useClarivaCallRestriction).mockReturnValue(true);
            const restricted = renderTile();
            expect(screen.getByTestId("clariva-call-started")).toHaveClass("mx_ClarivaCallStarted_live");
            expect(screen.queryByTestId("clariva-tile-join")).toBeNull();
            expect(restricted.container.querySelector(".mx_ClarivaCallStarted_time")).toBeNull();
            restricted.unmount();

            jest.mocked(useClarivaCallRestriction).mockReturnValue(false);
            jest.mocked(useConnectionState).mockReturnValue(ConnectionState.Connected);
            const connected = renderTile();
            expect(screen.getByTestId("clariva-call-started")).toHaveClass("mx_ClarivaCallStarted_live");
            expect(screen.queryByTestId("clariva-tile-join")).toBeNull();
            expect(connected.container.querySelector(".mx_ClarivaCallStarted_time")).toBeNull();
        });

        it("the sender's avatar is 40px and the title's icon is decoration", () => {
            renderTile();
            expect(screen.getByTestId("member-avatar")).toHaveAttribute("data-size", "40px");
            const icon = screen.getByTestId("clariva-call-started").querySelector(".mx_ClarivaCallStarted_icon");
            expect(icon).toHaveAttribute("aria-hidden", "true");
        });

        it("Join in a 1:1 chat joins and bills; in a group room it opens Element's own call view", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "voice" }));
            const first = renderTile();
            fireEvent.click(screen.getByTestId("clariva-tile-join"));
            expect(ClarivaCalls.joinCall).toHaveBeenCalledWith(room, { billing: true });
            first.unmount();

            jest.mocked(useClarivaCallDmPeerId).mockReturnValue(null);
            const dispatch = jest.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => undefined);
            renderTile();
            fireEvent.click(screen.getByTestId("clariva-tile-join"));
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({ action: Action.ViewRoom, room_id: ROOM_ID, view_call: true }),
            );
            expect(ClarivaCalls.joinCall).toHaveBeenCalledTimes(1);
        });
    });

    describe("ClarivaCallViewTitle (the strip above the call frame)", () => {
        let titledRoom: Room & { name: string };

        beforeEach(() => {
            titledRoom = Object.assign(room, { name: "Dr Rao" });
        });

        const renderTitle = (): ReturnType<typeof render> =>
            render(
                <MatrixClientContext.Provider value={client}>
                    <ClarivaCallViewTitle room={titledRoom} />
                </MatrixClientContext.Provider>,
            );

        it("shows the peer's avatar (28px), their name and the kind of call, from the live memberships", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            renderTitle();
            const strip = screen.getByTestId("clariva-call-title");
            expect(strip).toHaveClass("mx_ClarivaCallViewTitle");
            expect(screen.getByTestId("room-avatar")).toHaveAttribute("data-size", "28px");
            expect(screen.getByText("Dr Rao")).toHaveClass("mx_ClarivaCallViewTitle_name");
            const media = screen.getByText("Video call");
            expect(media).toHaveClass("mx_ClarivaCallViewTitle_media");
            expect(media).toHaveAttribute("data-call-media", "video");
        });

        it("a voice call says 'Voice call'; a call that does not say its media shows only the name", () => {
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "voice" }));
            const voice = renderTitle();
            expect(screen.getByText("Voice call")).toBeInTheDocument();
            voice.unmount();

            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: null }));
            const unknown = renderTitle();
            expect(unknown.container.querySelector(".mx_ClarivaCallViewTitle_media")).toBeNull();
            expect(screen.getByText("Dr Rao")).toBeInTheDocument();
        });

        it("reads the CALL peer (a 1:1 chat Clariva places calls in) and renders nothing for any other room", () => {
            renderTitle();
            expect(useClarivaCallDmPeerId).toHaveBeenCalledWith(titledRoom);
            expect(useRoomCallState).toHaveBeenCalledWith(titledRoom, expect.any(String), PEER);
            cleanup();

            jest.mocked(useClarivaCallDmPeerId).mockReturnValue(null);
            const { container } = renderTitle();
            expect(container).toBeEmptyDOMElement();
        });

        it("follows a rename of the room", () => {
            renderTitle();
            expect(screen.getByText("Dr Rao")).toBeInTheDocument();
            act(() => {
                titledRoom.name = "Dr Rao (cardiology)";
                (titledRoom as unknown as EventEmitter).emit(RoomEvent.Name);
            });
            expect(screen.getByText("Dr Rao (cardiology)")).toBeInTheDocument();
        });

        it("shows no duration and sets no timer: the host has no call clock to read and the strip adds none", () => {
            const setIntervalSpy = jest.spyOn(window, "setInterval");
            renderTitle();
            expect(setIntervalSpy).not.toHaveBeenCalled();
            const strip = screen.getByTestId("clariva-call-title");
            expect(strip.querySelector(".mx_CallDuration")).toBeNull();
            expect(strip).not.toHaveTextContent(/\d:\d\d/);
        });
    });

    describe("CallView (where the title strip is mounted)", () => {
        const fakeCall = (): Call =>
            ({
                roomId: ROOM_ID,
                widget: { id: "call_widget", creatorUserId: PEER, waitForIframeLoad: false, data: {} },
                connectionState: ConnectionState.Connected, // already connected: the view does not start it
                connected: true,
                clean: jest.fn(),
                start: jest.fn(),
                destroy: jest.fn(),
            }) as unknown as Call;

        const renderView = (): ReturnType<typeof render> => {
            jest.mocked(useCall).mockReturnValue(fakeCall());
            return render(
                <MatrixClientContext.Provider value={client}>
                    <CallView room={Object.assign(room, { name: "Dr Rao" })} resizing={false} waitForCall={false} />
                </MatrixClientContext.Provider>,
            );
        };

        it("a 1:1 chat with Clariva calls on gets the title strip as the FIRST thing in the view, above the call frame", () => {
            jest.mocked(useClarivaDmCalls).mockReturnValue(true);
            jest.mocked(useRoomCallState).mockReturnValue(callState({ hasOngoingCall: true, media: "video" }));
            const { container } = renderView();
            const view = container.querySelector(".mx_CallView")!;
            expect(view.firstElementChild).toBe(screen.getByTestId("clariva-call-title"));
            expect(view.lastElementChild).toBe(screen.getByTestId("app-tile"));
            expect(screen.getByText("Dr Rao")).toHaveClass("mx_ClarivaCallViewTitle_name");
        });

        it("a group room, or a deployment with Clariva calls off, keeps Element's own call view untouched", () => {
            jest.mocked(useClarivaDmCalls).mockReturnValue(false);
            const { container } = renderView();
            expect(screen.queryByTestId("clariva-call-title")).toBeNull();
            expect(container.querySelector(".mx_CallView")!.children).toHaveLength(1);
            expect(screen.getByTestId("app-tile")).toBeInTheDocument();
        });

        it("asks about the room it shows, nothing else", () => {
            jest.mocked(useClarivaDmCalls).mockReturnValue(false);
            renderView();
            expect(useClarivaDmCalls).toHaveBeenCalledWith(room);
        });
    });
});
