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

import React, { forwardRef, useCallback } from "react";
import classNames from "classnames";
import { Button } from "@vector-im/compound-web";
import { Icon as VideoCallSolidIcon } from "@vector-im/compound-design-tokens/icons/video-call-solid.svg";
import { Icon as VoiceCallIcon } from "@vector-im/compound-design-tokens/icons/voice-call.svg";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useSettingValue } from "../../../hooks/useSettings";
import { useCall, useConnectionState } from "../../../hooks/useCall";
import { ConnectionState } from "../../../models/Call";
import { formatTime } from "../../../DateUtils";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import MemberAvatar from "../../../components/views/avatars/MemberAvatar";
import { useClarivaCallDmPeerId, useClarivaCallRestriction } from "../../chat";
import { callsStrings } from "../../strings/calls";
import { useLatestCallStartedEventId, useRoomCallState } from "../../calls/hooks";
import { ClarivaCalls } from "../../calls/runtime";
import { type TileState, isLiveTile, tileShowsVideoIcon, tileTrailing } from "../../calls/tile";

interface Props {
    mxEvent: MatrixEvent;
}

/**
 * The "Call started" row for an `org.matrix.msc4075.rtc.notification` (Android `TimelineItemCallNotifyView`, spec 04
 * §2.3 / §3.13): sender avatar and name, a phone icon + "Call started", and on the right either the sent time or — only
 * on the NEWEST such tile while a call is in progress — the Join button. The video icon also needs the newest tile and
 * a running video call; historical tiles always show the phone. Join is hidden while the chat is restricted and while
 * this tab is already in the call. In a group room Join opens Element's own call view instead.
 *
 * Look (res/css/clariva/_calls.pcss): an inset glass tile (no blur: there can be many in a timeline). The live tile (the
 * newest one of a running call, the only one that can carry Join) gets a teal edge and a teal icon; every older tile is
 * quiet (`mx_ClarivaCallStarted_history`). Join is a Deep Teal pill that carries the icon of the call type.
 */
export const ClarivaCallStartedTile = forwardRef<HTMLDivElement, Props>(({ mxEvent }, ref) => {
    const client = useMatrixClientContext();
    const room = client.getRoom(mxEvent.getRoomId()) ?? null;
    const peerId = useClarivaCallDmPeerId(room);
    const restricted = useClarivaCallRestriction(room);
    const latestId = useLatestCallStartedEventId(room);
    const twelveHour = useSettingValue<boolean>("showTwelveHourTimestamps");
    const localCall = useCall(mxEvent.getRoomId()!);
    const locallyConnected = useConnectionState(localCall) === ConnectionState.Connected;
    const callState = useRoomCallState(room, client.getSafeUserId(), peerId);

    const tile: TileState = {
        isLatest: !!room && latestId === mxEvent.getId(),
        callOngoing: callState.hasOngoingCall,
        restricted,
        locallyConnected,
        media: callState.media,
    };
    const showsVideo = tileShowsVideoIcon(tile);
    const Icon = showsVideo ? VideoCallSolidIcon : VoiceCallIcon;
    const mediaKind = showsVideo ? "video" : "voice";
    const live = isLiveTile(tile);
    const senderName = mxEvent.sender?.name ?? mxEvent.getSender() ?? "";

    const join = useCallback(() => {
        if (!room) return;
        if (!peerId) {
            // not a 1:1 chat: Element's own group call flow
            defaultDispatcher.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: room.roomId,
                view_call: true,
                metricsTrigger: undefined,
            });
            return;
        }
        ClarivaCalls.joinCall(room, { billing: true }).catch((e) => logger.error("Clariva calls: could not join", e));
    }, [room, peerId]);

    const trailingKind = tileTrailing(tile);
    let trailing: JSX.Element | null = null;
    if (trailingKind === "time") {
        trailing = (
            <span className="mx_ClarivaCallStarted_time">{formatTime(new Date(mxEvent.getTs()), twelveHour)}</span>
        );
    } else if (trailingKind === "join") {
        trailing = (
            <Button
                size="sm"
                Icon={Icon}
                color="primary"
                className="mx_ClarivaCallStarted_join"
                onClick={join}
                data-testid="clariva-tile-join"
                data-call-icon={mediaKind}
            >
                {callsStrings.join}
            </Button>
        );
    }

    return (
        <div className="mx_ClarivaCallStarted_wrapper" ref={ref}>
            <div
                className={classNames(
                    "mx_ClarivaCallStarted",
                    live ? "mx_ClarivaCallStarted_live" : "mx_ClarivaCallStarted_history",
                )}
                data-testid="clariva-call-started"
                data-live={live}
            >
                <MemberAvatar
                    member={mxEvent.sender}
                    fallbackUserId={mxEvent.getSender()}
                    size="40px"
                    viewUserOnClick
                />
                <div className="mx_ClarivaCallStarted_text">
                    <span className="mx_ClarivaCallStarted_name">{senderName}</span>
                    <span className="mx_ClarivaCallStarted_title">
                        <Icon
                            width="16px"
                            height="16px"
                            className="mx_ClarivaCallStarted_icon"
                            aria-hidden="true"
                            data-call-icon={mediaKind}
                        />
                        {callsStrings.callStarted}
                    </span>
                </div>
                {trailing}
            </div>
        </div>
    );
});
