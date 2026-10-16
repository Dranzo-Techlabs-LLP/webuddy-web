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

/**
 * Public surface of the chat-gate workstream for other workstreams.
 *
 *  - `useClarivaCallRestriction(room)` — CALLS: hide (not disable) the voice / video / Join buttons while it is true.
 *  - `useClarivaCallDmPeerId(room)`    — CALLS: the peer of a 1:1 CALL (also a chat `m.direct` does not list). Never use
 *                                       `useClarivaDmPeerId` for call decisions: that one is for billing and gating.
 *  - `useChatGate(room)`               — the full gate state (restricted, balance, rate, hold, roles).
 *  - `decideGate` / `isBillablePeer`   — the pure decision table (spec 03 §3.3) and the D5 "is this peer billed" rule.
 */
export {
    useChatGate,
    useClarivaCallRestriction,
    useClarivaCallDmPeerId,
    useClarivaDmPeerId,
    isChatRestricted,
    evaluateChatGate,
} from "./useChatGate";
export type { ChatGateState } from "./useChatGate";
export { decideGate, isBillablePeer } from "./gate";
export type { GateDecision, GateInput, GateReason } from "./gate";
