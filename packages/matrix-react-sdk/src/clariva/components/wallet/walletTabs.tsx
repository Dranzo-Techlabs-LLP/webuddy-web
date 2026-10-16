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

import React from "react";
import counterpart from "counterpart";
import ChartIcon from "@vector-im/compound-design-tokens/assets/web/icons/chart";

import { Tab } from "../../../components/structures/TabbedView";
import { type TranslationKey } from "../../../languageHandler";
import { UserTab } from "../../../components/views/dialogs/UserTab";
import { isClarivaEnabled } from "../../config";
import { useWalletSnapshot } from "../../hooks/useWallet";
import { walletStrings as S } from "../../strings/wallet";
import BillingTab from "./BillingTab";
import { WalletIcon } from "./icons";
import WalletTab from "./WalletTab";

/**
 * `TabbedView` renders a tab's label with `_t(label)`. Clariva copy lives in strings/wallet.ts (not en_EN.json), so
 * the two tab names are registered with the translator under a private namespace; an unregistered key would render
 * as "missing translation" in development builds. Registered under "en", which every locale falls back to.
 */
const TAB_WALLET = "clariva_wallet|tab_wallet";
const TAB_BILLING = "clariva_wallet|tab_billing";
let registered = false;

export function ensureWalletTranslations(): void {
    if (registered) return;
    registered = true;
    counterpart.registerTranslations("en", {
        clariva_wallet: { tab_wallet: S.wallet, tab_billing: S.billingAndPayments },
    });
}

const asKey = (key: string): TranslationKey => key as unknown as TranslationKey;

/** True for the tabs this module adds (the dialog title switch uses it). */
export function isWalletTab(tabId: string): boolean {
    return tabId === UserTab.Wallet || tabId === UserTab.Billing;
}

/** "Settings: Wallet" in the same shape as the stock "<strong>Settings:</strong> General" dialog titles. */
export function walletTabTitle(tabId: UserTab): React.ReactNode {
    const name = tabId === UserTab.Billing ? S.billingAndPayments : S.wallet;
    return (
        <>
            <span className="mx_UserSettingsDialog_title_strong">{S.settingsTitlePrefix}</span> {name}
        </>
    );
}

/**
 * The settings tabs of the wallet workstream, for `UserSettingsDialog` (a hook: it follows the polled role):
 *  - Wallet: everyone (balance, Recharge for clients, history);
 *  - Billing and Payments: ONLY once the role is confirmed consultant (hidden while it is unknown).
 */
export function useClarivaWalletTabs(): Tab<UserTab>[] {
    const { isConsultant } = useWalletSnapshot();
    if (!isClarivaEnabled()) return [];
    ensureWalletTranslations();

    const tabs: Tab<UserTab>[] = [new Tab(UserTab.Wallet, asKey(TAB_WALLET), <WalletIcon />, <WalletTab />)];
    if (isConsultant === true) {
        tabs.push(new Tab(UserTab.Billing, asKey(TAB_BILLING), <ChartIcon />, <BillingTab />));
    }
    return tabs;
}
