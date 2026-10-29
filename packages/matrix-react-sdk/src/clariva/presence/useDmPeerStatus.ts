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

import { useEffect, useReducer } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { isPresenceEnabled } from "../../utils/presence";
import { useSettingValue } from "../../hooks/useSettings";
import { getClarivaConfig } from "../config";
import { useClarivaDmPeerId } from "../chat/useChatGate";
import { useWalletSnapshot } from "../hooks/useWallet";
import { DEFAULT_PRESENCE_PRIVACY } from "../profile/settings";
import { WalletStore } from "../stores/WalletStore";
import { profileStrings } from "../strings/profile";
import { isPresenceContact } from "./contacts";
import { designationBadgeOf, usePeerChanged } from "./designation";
import { visiblePresenceLabel } from "./lastSeen";
import { PeerPresencePoller } from "./PeerPresencePoller";

/** What a 1:1 chat shows about the other person (Android `DmPeerStatus`). */
export interface DmPeerStatus {
    /** The other party, `null` when the room is not a 1:1 chat or Clariva is off. */
    peerId: string | null;
    /** Their designation when they are a consultant ("Consultant" by default); `null` otherwise. */
    badge: string | null;
    /** WhatsApp-style "online" / "last seen today at 10:30"; `null` when unknown or not shared. */
    presence: string | null;
    /** `presence` is "online" (the avatar ring and the colour of the line). */
    online: boolean;
}

/**
 * Resolves `DmPeerStatus` for the other person in a 1:1 chat (Android `DmPeerStatusPresenter.present`): their
 * consultant designation from the Wallet-API, seeded from the cache so it is there at first paint, and their presence,
 * polled from the homeserver while the chat is on screen (`PeerPresencePoller`). Presence honours both people's
 * "Last seen and online" choice; while the partner's choice is unknown it stays hidden. Nothing is polled when the
 * homeserver's presence is switched off in the config (`enable_presence_by_hs_url`).
 */
export function useDmPeerStatus(room: Room): DmPeerStatus {
    const client = room.client;
    const peerId = useClarivaDmPeerId(room, false); // the header re-renders on membership changes anyway
    const wallet = useWalletSnapshot();
    const myPrivacy = wallet.presencePrivacy ?? DEFAULT_PRESENCE_PRIVACY;
    const showTwelveHour = useSettingValue<boolean>("showTwelveHourTimestamps");
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    usePeerChanged(peerId);

    const polling = !!peerId && !!client && isPresenceEnabled(client);
    const me = wallet.userId;
    useEffect(() => {
        if (!peerId) return;
        // the poller also re-reads the partner's profile (once per open, then every 3 polls)
        if (polling) return PeerPresencePoller.instance.subscribe(client, peerId, rerender);
        // without presence there is no poll: still make sure the badge is known (cached lookup)
        if (me)
            WalletStore.instance
                .getPeer(peerId, { maxAgeMs: getClarivaConfig().polling.peer_rate_list_ttl_ms })
                .catch(() => null);
    }, [polling, client, peerId, me]);

    if (!peerId) return { peerId: null, badge: null, presence: null, online: false };
    const info = WalletStore.instance.getCachedPeer(peerId);
    const presence = polling ? PeerPresencePoller.instance.getPresence(peerId) : null;
    const myId = client.getSafeUserId();
    const label = presence
        ? visiblePresenceLabel({
              presence,
              myId,
              peerId,
              isContact: isPresenceContact(room, peerId),
              myPrivacy,
              peerPrivacy: info?.presencePrivacy,
              now: Date.now(),
              format: { showTwelveHour },
          })
        : null;
    return {
        peerId,
        badge: designationBadgeOf(info),
        presence: label,
        online: label === profileStrings.presenceOnline,
    };
}
