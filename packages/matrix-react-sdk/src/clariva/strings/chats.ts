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
 * User-visible English strings for the Clariva "Chats" home and the responsive shell (src/clariva/components/chats,
 * src/clariva/components/shell). Copied from the Android home screen (`features/home/impl` localazy + HomeTopBar) so
 * parity is reviewable in one place; [WEB] marks copy that only exists on the web.
 */
export const chatsStrings = {
    /** [A] `screen_roomlist_main_space_title` and the big title of HomeTopBar. */
    title: "Chats",
    /** [WEB] a11y label of the filter chip row. */
    filtersLabel: "Filter chats",
    /** [A] chip labels (`RoomListFilter`). */
    filterUnread: "Unread",
    filterPeople: "People",
    filterRooms: "Rooms",
    filterFavourites: "Favourites",
    filterInvites: "Invites",
    /** [A] `screen_roomlist_clear_filters`. */
    clearFilters: "Clear filters",

    /** [WEB] label of the empty-state action. */
    startChat: "Start chat",
    /** [A] `screen_roomlist_a11y_create_message`: the round "+" button (mobile) and the list header's "+". */
    startNewChat: "Start a new chat",
    startAChat: "Start a chat",

    /** [A] `screen_roomlist_empty_title` / `_message` (no chats at all). */
    emptyTitle: "No chats yet.",
    emptyMessage: "Get started by messaging someone.",
    /** [A] `screen_roomlist_filter_*_empty_state_*`. */
    emptyUnreadTitle: "Congrats!",
    emptyUnreadSubtitle: "You don’t have any unread messages!",
    emptyPeopleTitle: "You don’t have any DMs yet",
    emptyRoomsTitle: "You’re not in any room yet",
    emptyFavouritesTitle: "You don’t have favourite chats yet",
    emptyFavouritesSubtitle: "You can add a chat to your favourites in the chat settings.",
    emptyInvitesTitle: "You don't have any pending invites.",
    emptyMixedTitle: "You don’t have chats for this selection",
    emptyMixedSubtitle: "You can deselect filters in order to see your other chats",

    /** [WEB] the Back button of the full-screen chat on a phone. */
    backToChats: "Back to chats",
    /** [WEB] the space/home switcher shown in the Chats header on a phone when the account has spaces. */
    spaces: "Spaces",
    /** [WEB] shown instead of the date for a chat whose last message was yesterday. */
    yesterday: "Yesterday",

    /** [WEB] status text of the placeholder rows shown while the first sync loads (read by assistive technology). */
    loadingChats: "Loading chats",

    /** [WEB] the floating tab bar of the phone list screen (Chats / Wallet / Me). */
    tabBarLabel: "Chats, wallet and account",
    tabChats: "Chats",
    tabWallet: "Wallet",
    tabMe: "Me",
    /** [WEB] appended to the Chats tab name when there is something unread, e.g. "Chats, 3 unread". */
    tabUnread: (count: number): string => `${count} unread`,
} as const;
