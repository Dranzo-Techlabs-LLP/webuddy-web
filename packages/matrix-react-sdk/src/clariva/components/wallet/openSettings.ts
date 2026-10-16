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

import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type OpenToTabPayload } from "../../../dispatcher/payloads/OpenToTabPayload";
import { UserTab } from "../../../components/views/dialogs/UserTab";

/** Open the user settings dialog on the Wallet tab (balance, Recharge, transaction history). */
export function openWalletSettings(): void {
    const payload: OpenToTabPayload = { action: Action.ViewUserSettings, initialTabId: UserTab.Wallet };
    defaultDispatcher.dispatch(payload);
}

/** Open the user settings dialog on "Billing and Payments" (consultants only; falls back to Account otherwise). */
export function openBillingSettings(): void {
    const payload: OpenToTabPayload = { action: Action.ViewUserSettings, initialTabId: UserTab.Billing };
    defaultDispatcher.dispatch(payload);
}
