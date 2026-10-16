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

import ToastStore from "../../stores/ToastStore";
import GenericToast from "../../components/views/toasts/GenericToast";
import { authStrings } from "../strings/auth";

const TOAST_KEY = "clariva_history_unavailable";

/**
 * One non-blocking, non-actionable notice for an account whose secret storage cannot be opened with the server
 * passphrase (spec 01 §3.8 table, row "SecretStorage error"; Appendix C 8d). Android shows nothing; the web tells
 * the user once. It never offers a "fix": nothing a client can do would not be destructive.
 */
export function showHistoryUnavailableNotice(): void {
    ToastStore.sharedInstance().addOrReplaceToast({
        key: TOAST_KEY,
        title: authStrings.historyUnavailableTitle,
        icon: "verification_warning",
        props: {
            description: authStrings.historyUnavailableDescription,
            primaryLabel: authStrings.ok,
            onPrimaryClick: (): void => ToastStore.sharedInstance().dismissToast(TOAST_KEY),
        },
        component: GenericToast,
        priority: 20,
    });
}
