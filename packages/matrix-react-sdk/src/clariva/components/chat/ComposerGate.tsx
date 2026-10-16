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

import React, { type ReactNode } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { useChatGate } from "../../chat/useChatGate";
import { ChatRestrictedBar } from "./ChatRestrictedBar";

interface Props {
    room: Room;
    /**
     * Render the composer. `restrictedBar` is `null` when the chat is open (always the case when Clariva is disabled,
     * in non-DM rooms and for consultants) and the ready-made "Chat restricted" bar when the composer must be
     * replaced.
     */
    children: (restrictedBar: ReactNode | null) => ReactNode;
}

/**
 * Adapter that lets the class-based `MessageComposer` use the `useChatGate` hook: it computes the gate and hands the
 * class a render callback. Keeps the upstream edit to a couple of lines.
 */
export function ClarivaComposerGate({ room, children }: Props): JSX.Element {
    const gate = useChatGate(room);
    const bar = gate.restricted ? <ChatRestrictedBar credits={gate.balance} required={gate.rate} /> : null;
    return <>{children(bar)}</>;
}
