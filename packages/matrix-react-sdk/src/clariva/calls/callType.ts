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

import { logger } from "matrix-js-sdk/src/logger";

import { ClarivaWalletApi } from "../api/wallet";
import { CALL_TYPE_TIMEOUT_MS } from "./constants";
import { type CallMediaType, parseApiCallType } from "./intent";

/**
 * The Wallet-API call-type record (`/v1/calls/type`, spec 04 §3.7 / §4.1): one row per room, last write wins, no TTL.
 * Android receivers label a ring and choose the camera default from it, because the Rust SDK ignores the on-wire
 * `m.call.intent`. Both calls are bounded to 2 s and NEVER throw or block a call.
 */

/**
 * Tell the other side what kind of call is about to start in `roomId`. Resolves to whether the record was written;
 * failures (offline, CORS, 4xx/5xx, timeout) are logged and swallowed.
 */
export async function recordCallType(roomId: string, mediaType: CallMediaType, callerId: string): Promise<boolean> {
    try {
        await ClarivaWalletApi.setCallType(
            { roomId, callType: mediaType, callerId },
            { timeoutMs: CALL_TYPE_TIMEOUT_MS },
        );
        return true;
    } catch (e) {
        logger.debug(`Clariva calls: could not record the call type for ${roomId}`, e);
        return false;
    }
}

/** The recorded media type of the latest call in `roomId`, or `null` when unknown / on any failure. */
export async function fetchCallType(roomId: string): Promise<CallMediaType | null> {
    try {
        const res = await ClarivaWalletApi.getCallType(roomId, { timeoutMs: CALL_TYPE_TIMEOUT_MS });
        return parseApiCallType(res?.callType);
    } catch (e) {
        logger.debug(`Clariva calls: could not read the call type for ${roomId}`, e);
        return null;
    }
}
