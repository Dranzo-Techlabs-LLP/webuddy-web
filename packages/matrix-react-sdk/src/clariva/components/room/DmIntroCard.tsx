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

import React, { type ReactNode, useCallback, useReducer } from "react";
import { EventType, type MatrixClient, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { Icon as LockIcon } from "@vector-im/compound-design-tokens/icons/lock-solid.svg";
import { Icon as VoiceCallIcon } from "@vector-im/compound-design-tokens/icons/voice-call.svg";
import { Icon as VideoCallIcon } from "@vector-im/compound-design-tokens/icons/video-call-solid.svg";

import { _t } from "../../../languageHandler";
import { useIsEncrypted } from "../../../hooks/useIsEncrypted";
import { useRoomState } from "../../../hooks/useRoomState";
import { useTypedEventEmitter } from "../../../hooks/useEventEmitter";
import { isLocalRoom } from "../../../utils/localRoom/isLocalRoom";
import { useClarivaCallDmPeerId, useClarivaCallRestriction } from "../../chat";
import { CALL_MEMBER_EVENT_TYPE, isClarivaCallStartedType } from "../../calls/constants";
import { useClarivaDmCalls, useRoomCallState } from "../../calls/hooks";
import { ClarivaCalls } from "../../calls/runtime";
import { formatCredits } from "../../money";
import { roomStrings } from "../../strings/room";
import { CoinIcon } from "../../ui";
import { ClarivaRoleBadge } from "./RoleBadge";
import { ClarivaRoomAvatar } from "./RoomAvatarRing";
import { useClarivaPeerInfo } from "./useClarivaPeerInfo";

/** Types that make a chat "not empty": something somebody wrote, sent or called (not the room's own setup events). */
const CONTENT_TYPES: ReadonlySet<string> = new Set([
    EventType.RoomMessage,
    EventType.RoomMessageEncrypted,
    "m.sticker",
]);

/** Has anybody said anything in this room yet? */
export function roomHasContent(room: Room): boolean {
    return room
        .getLiveTimeline()
        .getEvents()
        .some((ev: MatrixEvent) => CONTENT_TYPES.has(ev.getType()) || isClarivaCallStartedType(ev.getType()));
}

/** Are Voice / Video offered here? Same rules as the header's call buttons (calls on, 1:1, not restricted). */
export function useIntroCalls(room: Room, client: MatrixClient): { visible: boolean; disabled: boolean } {
    const dmCalls = useClarivaDmCalls(room);
    const restricted = useClarivaCallRestriction(room); // a restricted client gets NO call buttons (hidden, not disabled)
    const peerId = useClarivaCallDmPeerId(room, false);
    const call = useRoomCallState(room, client.getSafeUserId(), peerId);
    const mayCall = useRoomState(room, () => room.currentState.mayClientSendStateEvent(CALL_MEMBER_EVENT_TYPE, client));
    // a room that does not exist on the server yet (a DM about to be created) cannot host a call
    return { visible: dmCalls && !isLocalRoom(room) && !restricted && !call.hasOngoingCall, disabled: !mayCall };
}

interface Props {
    room: Room;
    client: MatrixClient;
    /** Opens the peer's profile (what clicking the stock intro avatar does). */
    onAvatarClick?: () => void;
    /** The stock intro paragraph(s): kept, small and quiet, under the card. */
    children?: ReactNode;
}

/**
 * The top of a 1:1 chat (replaces the stock avatar + name block of `NewRoomIntro`): one glass lens with a 72px avatar,
 * the name in the display face, the consultant's designation badge ("Consultant" by default) and rate, a privacy line
 * (only when the room is really end-to-end encrypted) and the Voice / Video actions. An empty chat adds a gentle prompt below the lens; the
 * stock explanation stays underneath it as small text. Everything is optional: with nothing known the card is just the
 * avatar and the name.
 */
export function ClarivaDmIntroCard({ room, client, onAvatarClick, children }: Props): JSX.Element {
    const peer = useClarivaPeerInfo(room);
    const encrypted = useIsEncrypted(client, room) === true;
    const calls = useIntroCalls(room, client);
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useTypedEventEmitter(room, RoomEvent.Timeline, rerender);

    const startCall = useCallback(
        (voice: boolean) => {
            ClarivaCalls.startCall(room, voice).catch((e) =>
                logger.error("Clariva calls: could not start the call", e),
            );
        },
        [room],
    );

    const isConsultant = peer.isConsultant === true;
    const showRate = isConsultant && peer.rate !== null;
    const empty = !roomHasContent(room);

    return (
        <div className="mx_ClarivaDmIntro" data-testid="clariva-dm-intro">
            <section className="mx_ClarivaDmIntro_card" aria-label={roomStrings.introLabel}>
                <ClarivaRoomAvatar room={room} size="72px" onClick={onAvatarClick} />
                <h2 className="mx_ClarivaDmIntro_name">{room.name}</h2>
                {isConsultant && (
                    <div className="mx_ClarivaDmIntro_tags">
                        <ClarivaRoleBadge text={peer.badge ?? undefined} />
                        {showRate && (
                            <span className="mx_ClarivaDmIntro_rate" data-testid="clariva-intro-rate">
                                <CoinIcon size={14} />
                                {roomStrings.introRate(formatCredits(peer.rate!))}
                            </span>
                        )}
                    </div>
                )}
                {encrypted && (
                    <p className="mx_ClarivaDmIntro_privacy" data-testid="clariva-intro-private">
                        <LockIcon className="mx_ClarivaDmIntro_privacyIcon" aria-hidden="true" />
                        {roomStrings.introPrivate}
                    </p>
                )}
                {calls.visible && (
                    <div className="mx_ClarivaDmIntro_actions">
                        <button
                            type="button"
                            className="mx_ClarivaDmIntro_action"
                            aria-label={_t("voip|voice_call")}
                            disabled={calls.disabled}
                            onClick={() => startCall(true)}
                            data-testid="clariva-intro-voice"
                        >
                            <VoiceCallIcon className="mx_ClarivaDmIntro_actionIcon" aria-hidden="true" />
                            {roomStrings.introVoice}
                        </button>
                        <button
                            type="button"
                            className="mx_ClarivaDmIntro_action"
                            aria-label={_t("voip|video_call")}
                            disabled={calls.disabled}
                            onClick={() => startCall(false)}
                            data-testid="clariva-intro-video"
                        >
                            <VideoCallIcon className="mx_ClarivaDmIntro_actionIcon" aria-hidden="true" />
                            {roomStrings.introVideo}
                        </button>
                    </div>
                )}
            </section>
            {empty && (
                <p className="mx_ClarivaDmIntro_hello" data-testid="clariva-dm-hello">
                    {roomStrings.introSayHello(room.name)}
                </p>
            )}
            {children && <div className="mx_ClarivaDmIntro_note">{children}</div>}
        </div>
    );
}
