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

import React, { useCallback } from "react";
import { Button, IconButton, Tooltip } from "@vector-im/compound-web";
import { Icon as VideoCallSolidIcon } from "@vector-im/compound-design-tokens/icons/video-call-solid.svg";
import { Icon as VoiceCallIcon } from "@vector-im/compound-design-tokens/icons/voice-call.svg";
import CloseCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import { type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import Modal from "../../../Modal";
import { _t } from "../../../languageHandler";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useRoomState } from "../../../hooks/useRoomState";
import { useClarivaCallDmPeerId, useClarivaCallRestriction } from "../../chat";
import { callsStrings } from "../../strings/calls";
import { CALL_MEMBER_EVENT_TYPE } from "../../calls/constants";
import { useRoomCallState } from "../../calls/hooks";
import { ClarivaCalls } from "../../calls/runtime";
import { type CallChoice, ClarivaCallChooserDialog } from "./ClarivaCallChooserDialog";

interface Props {
    room: Room;
    /** Why starting a call is not possible right now (no permission, another call is connected...), from `useRoomCall`. */
    disabledReason: string | null;
    isViewingCall: boolean;
    isConnectedToCall: boolean;
    /** Maximise / minimise (or close) the call view. */
    onToggleCall: () => void;
}

/** Ask Voice or Video, then start the call. Shared by the header button and anything else that starts a DM call. */
export async function chooseAndStartCall(room: Room): Promise<void> {
    const { finished } = Modal.createDialog(ClarivaCallChooserDialog, {});
    const [choice] = (await finished) as [CallChoice | undefined];
    if (!choice) return;
    try {
        await ClarivaCalls.startCall(room, choice === "voice");
    } catch (e) {
        logger.error("Clariva calls: could not start the call", e);
    }
}

/**
 * The call controls of a 1:1 chat header (Android `CallMenuItem`, spec 04 §2.1). Rendered by `RoomHeader` instead of
 * Element's separate voice and video buttons when the Clariva calls feature is on.
 *
 *  - connected to a call here: maximise / minimise it;
 *  - the call view is open but not connected yet: close it;
 *  - a client who cannot afford the consultant: NOTHING (hidden, not disabled; the composer shows "Chat restricted");
 *  - a call is in progress: "Join" (icon by media type);
 *  - otherwise one phone button opening the "Start a call" chooser.
 * Starting and joining need the power level to send `org.matrix.msc3401.call.member` (Android: `canCall`).
 *
 * Look (res/css/clariva/_calls.pcss): every control carries `mx_ClarivaCallControl` plus its own variant. The icon
 * buttons are 44px round inset tiles (the header is thick glass, so they must not blur again), the "connected" toggle is
 * a Deep Teal disc, Join is a Deep Teal pill with the icon of the call type. Disabled is a bare half-faded glyph.
 */
export function ClarivaCallControls({
    room,
    disabledReason,
    isViewingCall,
    isConnectedToCall,
    onToggleCall,
}: Props): JSX.Element | null {
    const client = useMatrixClientContext();
    const peerId = useClarivaCallDmPeerId(room);
    const restricted = useClarivaCallRestriction(room);
    const call = useRoomCallState(room, client.getSafeUserId(), peerId);
    const mayCall = useRoomState(room, () => room.currentState.mayClientSendStateEvent(CALL_MEMBER_EVENT_TYPE, client));

    const startCall = useCallback(() => void chooseAndStartCall(room), [room]);
    const joinCall = useCallback(() => {
        ClarivaCalls.joinCall(room, { billing: true }).catch((e) => logger.error("Clariva calls: could not join", e));
    }, [room]);

    if (isConnectedToCall) {
        return (
            <Tooltip label={isViewingCall ? _t("voip|minimise_call") : _t("voip|maximise_call")}>
                <IconButton
                    className="mx_ClarivaCallControl mx_ClarivaCallControl_toggle mx_ClarivaCallControl_live"
                    onClick={onToggleCall}
                    aria-label={isViewingCall ? _t("voip|minimise_call") : _t("voip|maximise_call")}
                    data-testid="clariva-call-toggle"
                >
                    <VideoCallSolidIcon aria-hidden="true" />
                </IconButton>
            </Tooltip>
        );
    }
    if (isViewingCall) {
        return (
            <Tooltip label={_t("action|close")}>
                <IconButton
                    className="mx_ClarivaCallControl mx_ClarivaCallControl_close"
                    onClick={onToggleCall}
                    aria-label={_t("action|close")}
                    data-testid="clariva-call-close"
                >
                    <CloseCallIcon aria-hidden="true" />
                </IconButton>
            </Tooltip>
        );
    }

    // Android hides (never disables) the call controls of a client who cannot afford the consultant.
    if (restricted) return null;

    const disabled = !mayCall || disabledReason !== null;
    if (call.hasOngoingCall) {
        const JoinIcon = call.media === "voice" ? VoiceCallIcon : VideoCallSolidIcon;
        return (
            <Tooltip label={disabledReason ?? callsStrings.join}>
                <Button
                    size="sm"
                    Icon={JoinIcon}
                    className="mx_RoomHeader_join_button mx_ClarivaCallControl mx_ClarivaCallControl_join"
                    color="primary"
                    disabled={disabled}
                    onClick={joinCall}
                    aria-label={disabledReason ?? callsStrings.join}
                    data-testid="clariva-call-join"
                    data-call-icon={call.media === "voice" ? "voice" : "video"}
                >
                    {callsStrings.join}
                </Button>
            </Tooltip>
        );
    }

    return (
        <Tooltip label={disabledReason ?? callsStrings.startCall}>
            <IconButton
                className="mx_ClarivaCallControl mx_ClarivaCallControl_start"
                disabled={disabled}
                onClick={startCall}
                aria-label={disabledReason ?? callsStrings.startCall}
                data-testid="clariva-call-start"
            >
                <VoiceCallIcon aria-hidden="true" />
            </IconButton>
        </Tooltip>
    );
}
