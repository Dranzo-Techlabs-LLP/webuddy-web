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

import PageType from "../../../PageTypes";
import { isClarivaEnabled } from "../../config";

/**
 * Which pane a phone shows. Mirrors Android's single-pane master/detail: "list" is the Chats list, "detail" is
 * whatever the list opened (a chat, a user page). Desktop ignores it (both panes are visible); the CSS in
 * res/css/clariva/_responsive.pcss reads it from `<html data-clariva-view="...">`.
 */
export type ClarivaView = "list" | "detail";

/** Breakpoints (px) of the responsive shell. Keep in sync with res/css/clariva/_responsive.pcss. */
export const CLARIVA_PHONE_MAX = 768;
export const CLARIVA_TABLET_MAX = 1100;
export const CLARIVA_PHONE_QUERY = `(max-width: ${CLARIVA_PHONE_MAX}px)`;

/** Pages that take the whole screen on a phone; everything else (the home page) leaves the Chats list in front. */
export function clarivaViewFor(pageType: string | undefined | null): ClarivaView {
    return pageType === PageType.RoomView || pageType === PageType.UserView ? "detail" : "list";
}

/**
 * The icon-only ("minimised") left panel of stock Element has no Android counterpart: with Clariva configured the
 * list is always the full Chats list, whatever the resizer remembered in localStorage.
 */
export function clarivaLhsMinimized(collapseLhs: boolean | undefined): boolean {
    return isClarivaEnabled() ? false : !!collapseLhs;
}
