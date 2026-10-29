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

import { isClarivaEnabled } from "../config";

/**
 * Whether Element's stock presence UI (member-list "Online for X" / "Away" labels and ordering, the green/grey dot on
 * DM avatars in Spotlight and breadcrumbs) may show. Under Clariva it never does: those read /sync presence straight
 * and would ignore both people's "Last seen and online" choices. Like Android, presence shows only in the open DM's
 * header (useDmPeerStatus), with those rules applied.
 *
 * @param stockEnabled what Element itself decided (enable_presence_by_hs_url)
 */
export function showsStockPresence(stockEnabled: boolean): boolean {
    return stockEnabled && !isClarivaEnabled();
}
