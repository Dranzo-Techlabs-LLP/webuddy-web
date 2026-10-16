/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import React, { FC } from "react";

import type { Call } from "../../../models/Call";
import { _t } from "../../../languageHandler";
import { useConnectionState, useParticipantCount } from "../../../hooks/useCall";
import { ConnectionState } from "../../../models/Call";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { isClarivaCallsEnabled } from "../../../clariva/calls/config";
import { isVoiceCallInRoom } from "../../../clariva/calls/memberships";
import { callsStrings } from "../../../clariva/strings/calls";
import { LiveContentSummary, LiveContentType } from "./LiveContentSummary";

interface Props {
    call: Call;
}

export const RoomTileCallSummary: FC<Props> = ({ call }) => {
    let text: string;
    let active: boolean;
    // CLARIVA: Element only knows video calls ("Video" + a camera icon); a voice call must say and show that it is one
    const isVoice = isClarivaCallsEnabled() && isVoiceCallInRoom(MatrixClientPeg.get()?.getRoom(call.roomId));

    switch (useConnectionState(call)) {
        case ConnectionState.Disconnected:
            text = isVoice ? callsStrings.liveVoice : _t("common|video");
            active = false;
            break;
        case ConnectionState.WidgetLoading:
            text = _t("common|loading");
            active = false;
            break;
        case ConnectionState.Lobby:
            text = _t("common|lobby");
            active = false;
            break;
        case ConnectionState.Connecting:
            text = _t("room|joining");
            active = true;
            break;
        case ConnectionState.Connected:
        case ConnectionState.Disconnecting:
            text = _t("common|joined");
            active = true;
            break;
    }

    return (
        <LiveContentSummary
            type={isVoice ? LiveContentType.Voice : LiveContentType.Video}
            text={text}
            active={active}
            participantCount={useParticipantCount(call)}
        />
    );
};
