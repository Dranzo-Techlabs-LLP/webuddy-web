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

import SettingsTab from "../../../components/views/settings/tabs/SettingsTab";
import { SettingsSection } from "../../../components/views/settings/shared/SettingsSection";
import { SettingsSubsection } from "../../../components/views/settings/shared/SettingsSubsection";
import { walletStrings as S } from "../../strings/wallet";
import BankDetailsForm from "./BankDetailsForm";
import MaxCreditsEditor from "./MaxCreditsEditor";

/**
 * Settings > Billing and Payments (consultants only, see `walletTabs`): the "Wallet" category of Android's screen
 * (Max Credits) and the Bank Details form, which is a separate screen on Android and a second section here.
 */
export default function BillingTab(): JSX.Element {
    return (
        <SettingsTab data-testid="clariva-billing-tab">
            <SettingsSection heading={S.billingCategoryWallet}>
                <MaxCreditsEditor />
            </SettingsSection>
            <SettingsSection heading={S.bankDetails}>
                <SettingsSubsection stretchContent={true}>
                    <BankDetailsForm />
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}
