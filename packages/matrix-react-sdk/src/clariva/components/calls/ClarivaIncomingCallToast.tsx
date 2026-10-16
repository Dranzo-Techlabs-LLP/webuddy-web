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

import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { Icon as VoiceCallIcon } from "@vector-im/compound-design-tokens/icons/voice-call.svg";
import { Icon as VideoCallSolidIcon } from "@vector-im/compound-design-tokens/icons/video-call-solid.svg";
import { Icon as EndCallIcon } from "@vector-im/compound-design-tokens/icons/end-call.svg";

import RoomAvatar from "../../../components/views/avatars/RoomAvatar";
import AccessibleButton from "../../../components/views/elements/AccessibleButton";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { acceptCallLabel, callsStrings, incomingCallLabel, rejectCallLabel } from "../../strings/calls";
import { useIncomingRings, useRingSoundBlocked } from "../../calls/hooks";
import { getIncomingCalls } from "../../calls/registry";

export const incomingCallToastKey = (ringEventId: string): string => `clariva_call_${ringEventId}`;

interface Props {
    ringEventId: string;
}

/** Is the tab in the background? A ring nobody can see costs nothing: its animation is paused (`cg-paused`). */
function useTabHidden(): boolean {
    const [hidden, setHidden] = useState<boolean>(() => typeof document !== "undefined" && document.hidden === true);
    useEffect(() => {
        const sync = (): void => setHidden(document.hidden === true);
        sync();
        document.addEventListener("visibilitychange", sync);
        return () => document.removeEventListener("visibilitychange", sync);
    }, []);
    return hidden;
}

/**
 * The ring of an incoming 1:1 call (Android's full-screen "Incoming voice/video call" screen, spec 04 §2.6): the
 * caller's avatar and name, "Incoming voice call" or "Incoming video call", a Deep Teal Accept and a coral Reject.
 * Accept joins with `join_existing_dm[_voice]`; Reject sends `org.matrix.msc4310.rtc.decline`. The manager dismisses
 * the toast itself when the ring ends for any reason. Accept shows the icon of the call type (video or phone) and both
 * buttons are named after the caller and the call type. While the browser's autoplay policy keeps the ringtone silent
 * (nothing has been clicked on the page yet) it says so: any click or key press on the page enables the sound. That
 * hint is the LAST child, below the buttons: it comes and goes without moving them (a click that unlocks the sound
 * must still land on the button under the pointer).
 *
 * Look (docs/clariva/DESIGN-SYSTEM.md section 6, res/css/clariva/_calls.pcss): the toast shell is a thick glass sheet;
 * two teal rings expand behind the 56px avatar (transform + opacity only, a 2 s loop, the second ring 0.6 s later). The
 * rings are decoration (`aria-hidden`); under reduced motion they rest as two still halos, and while the tab is hidden
 * the avatar carries `cg-paused`, which stops them.
 */
export function ClarivaIncomingCallToast({ ringEventId }: Props): JSX.Element | null {
    const rings = useIncomingRings();
    const soundBlocked = useRingSoundBlocked();
    const tabHidden = useTabHidden();
    const ring = rings.find((r) => r.ringEventId === ringEventId);
    if (!ring) return null;

    const client = MatrixClientPeg.safeGet();
    const room = client.getRoom(ring.roomId) ?? undefined;
    const callerName = room?.getMember(ring.senderId)?.name ?? ring.senderId;
    const label = incomingCallLabel(ring.mediaType);
    const AcceptIcon = ring.mediaType === "video" ? VideoCallSolidIcon : VoiceCallIcon;

    return (
        <div
            className="mx_ClarivaIncomingCall_content"
            role="group"
            aria-label={`${callerName}, ${label}`}
            data-call-media={ring.mediaType}
        >
            <div className="mx_ClarivaIncomingCall_head">
                <div
                    className={classNames("mx_ClarivaIncomingCall_avatar", { "cg-paused": tabHidden })}
                    data-testid="clariva-ring-avatar"
                >
                    <span className="mx_ClarivaIncomingCall_ring" aria-hidden="true" />
                    <span
                        className="mx_ClarivaIncomingCall_ring mx_ClarivaIncomingCall_ring_second"
                        aria-hidden="true"
                    />
                    <span className="mx_ClarivaIncomingCall_face">
                        <RoomAvatar room={room} size="56px" />
                    </span>
                </div>
                <div className="mx_ClarivaIncomingCall_info">
                    <span className="mx_ClarivaIncomingCall_name" title={callerName}>
                        {callerName}
                    </span>
                    <span className="mx_ClarivaIncomingCall_label">{label}</span>
                </div>
            </div>
            <div className="mx_ClarivaIncomingCall_buttons">
                <AccessibleButton
                    className="mx_ClarivaIncomingCall_button mx_ClarivaIncomingCall_reject"
                    onClick={() => void getIncomingCalls()?.reject(ring.ringEventId)}
                    aria-label={rejectCallLabel(callerName)}
                    data-testid="clariva-ring-reject"
                >
                    <EndCallIcon width="20px" height="20px" aria-hidden="true" />
                    <span>{callsStrings.reject}</span>
                </AccessibleButton>
                <AccessibleButton
                    className="mx_ClarivaIncomingCall_button mx_ClarivaIncomingCall_accept"
                    onClick={() => void getIncomingCalls()?.accept(ring.ringEventId)}
                    aria-label={acceptCallLabel(ring.mediaType, callerName)}
                    data-testid="clariva-ring-accept"
                >
                    <AcceptIcon
                        width="20px"
                        height="20px"
                        aria-hidden="true"
                        data-call-icon={ring.mediaType === "video" ? "video" : "voice"}
                    />
                    <span>{callsStrings.accept}</span>
                </AccessibleButton>
            </div>
            {soundBlocked && (
                <span className="mx_ClarivaIncomingCall_soundHint" role="status" data-testid="clariva-ring-sound-hint">
                    {callsStrings.enableCallSound}
                </span>
            )}
        </div>
    );
}
