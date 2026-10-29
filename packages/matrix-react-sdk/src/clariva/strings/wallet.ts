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
 * User-visible English strings for the Clariva "wallet" area, copied verbatim from the Android app (see the
 * Appendix of the matching spec in docs/clariva/spec). Owned by the wallet workstream; keep literals here (not in
 * en_EN.json) so Android parity is reviewable in one place.
 *
 * Provenance tags: [A] = verbatim Android / spec 02 Appendix A, [W] = the existing clarivahub.com recharge page
 * (recharge.html / wallet.js, same Razorpay flow), [WEB] = added for the web (the Android app has no equivalent).
 */
export const walletStrings = {
    // ── chip / navigation ────────────────────────────────────────────────────
    /** [A] a11y label of the chip and the name of the settings tab. */
    wallet: "Wallet",
    /** [A] `{credits} credits` (chip, wallet header). */
    credits: (formatted: string): string => `${formatted} credits`,
    /** [A] shown until the first successful balance load. */
    loading: "Loading...",
    /** [WEB] chip tooltip for a consultant (their balance is accumulated earnings). */
    chipTitleConsultant: "Wallet - your earnings balance",
    /** [WEB] chip tooltip for a client / unknown role. */
    chipTitleClient: "Wallet",
    /** [A] settings tab, consultant only. */
    billingAndPayments: "Billing and Payments",
    /** [WEB] shown in the settings dialog title, e.g. "Settings: Wallet". */
    settingsTitlePrefix: "Settings:",

    // ── wallet screen ────────────────────────────────────────────────────────
    currentBalance: "Current Balance",
    /** [A] the Android label; the web wallet card says `addCredits` since the redesign. */
    rechargeCredits: "Recharge Credits",
    /** [WEB] the primary action of the wallet card (plain verb, sentence case). */
    addCredits: "Add credits",
    processingRecharge: "Processing recharge...",
    rechargeFailed: (message: string): string => `Recharge failed: ${message}`,
    transactionHistory: "Transaction History",
    columnDate: "Date",
    columnType: "Type",
    columnAmount: "Amount",
    columnStatus: "Status",
    /** [A] `{amount} cr` */
    amountCr: (formatted: string): string => `${formatted} cr`,
    /** [WEB] empty-state title of the history (Android says "No transactions found"). */
    noTransactions: "No transactions yet",
    /** [WEB] guidance under the empty state (the wording depends on the role). */
    noTransactionsHint: "Your recharges, chat holds and earnings will show up here.",
    noTransactionsHintClient: "Recharge your wallet to start chatting with consultants.",
    noTransactionsHintConsultant: "Earnings from your chats will show up here.",
    /** [WEB] quiet line in the balance card. */
    balanceHintClient: "1 credit = ₹1",
    balanceHintConsultant: "Your earnings balance",
    /** [WEB] replaces Android's "empty list" on a failed fetch (spec 02 §3.14). */
    balanceUnavailable: "Balance unavailable",
    historyLoadFailed: "Couldn't load your transactions.",
    retry: "Retry",
    loadMore: "Load more",
    loadingMore: "Loading...",
    /** [WEB] accessible names for the direction arrow (Android marks it decorative). */
    directionCredit: "Credit",
    directionDebit: "Debit",
    /** [WEB] CREATED recharge rows younger than 1 h: the checkout was started but never paid. */
    awaitingPayment: "Awaiting payment",
    viewDetails: "View details",
    /** [WEB] shown in the wallet tab after a reload recovered an interrupted payment. */
    recoveredPayment: (credits: string): string => `Your earlier payment of ${credits} credits was confirmed.`,

    // ── transaction labels / statuses [A] ────────────────────────────────────
    labelRecharge: "Recharge",
    labelHold: "Chat hold",
    labelHoldSettled: "Earnings",
    labelRefund: "Refund",
    labelReferral: "Referral bonus",
    labelBonus: "Bonus",
    labelCredit: "Credit",
    labelDebit: "Debit",

    // ── transaction detail dialog [WEB] ──────────────────────────────────────
    detailTitle: "Transaction details",
    detailId: "Transaction ID",
    detailDate: "Date and time",
    detailType: "Type",
    detailSource: "Source",
    detailDirection: "Direction",
    detailAmount: "Amount",
    detailStatus: "Status",
    detailCurrency: "Currency",
    detailProvider: "Payment provider",
    detailOrderId: "Provider order ID",
    detailPaymentId: "Provider payment ID",
    detailUtc: "UTC",
    close: "Close",

    // ── recharge dialog ──────────────────────────────────────────────────────
    rechargeDialogTitle: "Recharge Wallet",
    rechargeDialogBody: "Enter the number of credits to purchase.",
    amountLabel: "Amount",
    amountPlaceholder: "e.g. 500",
    cancel: "Cancel",
    recharge: "Recharge",
    /** [W] quick-pick chips. */
    quickAmountsLabel: "Quick amounts",
    /** [WEB] what the typed amount buys (₹1 = 1 credit). */
    rechargeSummary: (credits: string, inr: string): string => `You get ${credits} credits for ₹${inr}.`,
    /** [W] range error, ₹1 = 1 credit. */
    amountRange: "Enter an amount between ₹1 and ₹1,00,000.",
    amountWholeNumber: "Enter a whole number of credits.",
    /** [W] */
    securedByRazorpay: "Secured by Razorpay · charged in INR",
    /** [WEB] */
    completePaymentPrompt: "Complete the payment in the Razorpay window.",
    confirmingPayment: "Confirming your payment...",
    /** [W] */
    paymentCancelled: "Payment cancelled — you can try again.",
    paymentLibraryFailed: "Payment library didn’t load. Check your connection and try again.",
    couldntStartPayment: "Couldn’t start the payment. Please try again.",
    couldntOpenPayment: "Couldn’t open the payment window.",
    networkErrorStarting: "Network error starting the payment.",
    /** [W] */
    verifyFailedWithId: (paymentId: string): string =>
        `Payment went through, but confirmation didn’t complete. Your wallet will update shortly — if not, contact support with payment id ${paymentId}`,
    verifyFailedNoId: "Payment went through, but we couldn’t confirm it here. It should reflect shortly.",
    /** [WEB] */
    checkingWallet: "Checking your wallet...",
    retryConfirmation: "Retry confirmation",
    /** [WEB] the success moment: the title says what happened, the body says where the credits went. */
    rechargeSuccessTitle: "Credits added",
    rechargeSuccessBody: (credits: string): string => `${credits} credits are now in your Clariva wallet.`,
    newBalance: (credits: string): string => `New balance: ${credits} credits`,
    rechargeAgain: "Recharge again",
    done: "Done",
    paymentId: "Payment ID",

    // ── Razorpay options (spec 02 §2.3 / §6.4; theme = Clariva teal) ─────────
    razorpayName: "Clariva",
    razorpayDescription: "Wallet Recharge",
    razorpayThemeColor: "#00BFA5",

    // ── Billing and Payments [A] ─────────────────────────────────────────────
    billingCategoryWallet: "Wallet",
    maxCredits: "Max Credits",
    /** [WEB] explains the number; Android shows the bare label. */
    maxCreditsHelp: "Credits a client pays to start a 24-hour chat with you.",
    maxCreditsTooLarge: (max: string): string => `Enter a number up to ${max}.`,
    save: "Save",
    saving: "Saving…",
    maxCreditsSaved: "Max credits saved",
    maxCreditsSaveFailed: "Couldn't save max credits. Please try again.",
    bankDetails: "Bank Details",

    // ── Bank details [A] (Android BankDetailsView, 2026-10-29) ───────────────
    currentPayoutAccount: "Current payout account",
    noPayoutAccount: "None yet. Add one below to receive your earnings.",
    payoutAccountLoadFailed: "Couldn't load your saved account.",
    /** [WEB] accessible status while the saved account loads (Android shows a bare spinner). */
    payoutAccountLoading: "Loading your saved account…",
    addPayoutAccount: "Add payout account",
    replacePayoutAccount: "Replace payout account",
    payoutAccountSubtitle: "Your earnings are paid into this account.",
    accountHolderName: "Account Holder Name",
    bankName: "Bank Name",
    bankNamePlaceholder: "e.g. State Bank of India",
    accountNumber: "Account Number",
    ifscCode: "IFSC Code",
    ifscPlaceholder: "e.g. SBIN0001234",
    branchNameOptional: "Branch Name (optional)",
    saveDetails: "Save Details",
    savedChanges: "Saved changes",
    bankSaveFailed: "Couldn't save your bank details. Check your connection and try again.",
    bankReplaceNote:
        "Saving replaces your current payout account. Only the last 4 digits of the account number are shown here.",

    // ── Bank account rules + live IFSC check (shared with consultant sign-up) ─
    accountNumberError: "Account number must be 9 to 18 digits",
    ifscFormatError: "IFSC code looks like ABCD0123456",
    ifscChecking: "Checking IFSC…",
    ifscNotFound: "No bank branch found for this IFSC. Please check the code.",
    ifscUnavailable: "Couldn't verify this IFSC right now. It will be checked when you save.",
} as const;
