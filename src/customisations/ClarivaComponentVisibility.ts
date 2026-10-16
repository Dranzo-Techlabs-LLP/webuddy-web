/*
Copyright 2026 The Clariva Authors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only
Please see LICENSE in the repository root for full details.
*/

// CLARIVA: replaces matrix-react-sdk's `src/customisations/ComponentVisibility.ts` through `customisations.json`
// (see docs/customisations.md, docs/clariva/DEPLOY.md). It hides the stock Element UI that has no Clariva
// equivalent and no `UIFeature.*` switch (docs/clariva/spec/06-branding-whitelabel.md section 5.4 / 7):
//
//  - ExploreRooms    public room directory: "Explore rooms" buttons / menu entries / the home page action
//  - CreateSpaces    "Create a space" (space panel "+", room list menu, space context menu)
//  - AddIntegrations widgets / integration-manager entry points in the room info card
//
// Deliberately NOT hidden: CreateRooms (it also guards "Start chat" / the "Message" button on a profile, which the QR
// and user-search flows rely on), InviteUsers, FilterContainer, RoomOptionsMenu.
//
// Dormant unless the Clariva API is configured, so a build without a `clariva` config section behaves like stock.

import { UIComponent } from "matrix-react-sdk/src/settings/UIFeature";
import { isClarivaEnabled } from "matrix-react-sdk/src/clariva/config";

import type { IComponentVisibilityCustomisations } from "matrix-react-sdk/src/customisations/ComponentVisibility";

const HIDDEN_COMPONENTS: ReadonlySet<UIComponent> = new Set([
    UIComponent.ExploreRooms,
    UIComponent.CreateSpaces,
    UIComponent.AddIntegrations,
]);

/**
 * Whether the active user should be able to use the given UI component.
 * @param component The component to check visibility for.
 * @returns true (default) if it may be shown, false if Clariva hides it.
 */
function shouldShowComponent(component: UIComponent): boolean {
    if (!isClarivaEnabled()) return true;
    return !HIDDEN_COMPONENTS.has(component);
}

export const ComponentVisibilityCustomisations: IComponentVisibilityCustomisations = {
    shouldShowComponent,
};
