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

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { type IPreview } from "../../stores/room-list/previews/IPreview";
import { callsStrings } from "../strings/calls";
import { isClarivaCallsEnabled } from "./config";

/**
 * Room-list preview of a ring event: "Call started" (Android `DefaultRoomLatestEventFormatter`). Only when Clariva
 * calls are on, because only then the timeline shows the matching tile.
 */
export class ClarivaCallStartedPreview implements IPreview {
    public getTextFor(_event: MatrixEvent): string | null {
        return isClarivaCallsEnabled() ? callsStrings.callStarted : null;
    }
}
