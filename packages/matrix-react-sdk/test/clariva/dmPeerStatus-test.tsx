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
import { act, cleanup, render, screen } from "@testing-library/react";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../src/SdkConfig";
import {
    PeerPresencePoller,
    PRESENCE_POLL_MS,
    PROFILE_REFRESH_EVERY_POLLS,
} from "../../src/clariva/presence/PeerPresencePoller";
import { useDmPeerStatus } from "../../src/clariva/presence/useDmPeerStatus";
import { ClarivaRoomTileDesignation } from "../../src/clariva/components/chats/RoomTileContent";
import { ClarivaUserDesignationBadge } from "../../src/clariva/components/room/RoleBadge";
import { WalletStore, WalletStoreEvent, type PeerWalletInfo } from "../../src/clariva/stores/WalletStore";
import { useClarivaDmPeerId } from "../../src/clariva/chat/useChatGate";
import {
    DEFAULT_PRESENCE_PRIVACY,
    LastSeenAudience,
    OnlineAudience,
    type PresencePrivacy,
} from "../../src/clariva/profile/settings";
import { CONSULTANT, ME, configureClariva } from "./helpers";

jest.mock("../../src/clariva/chat/useChatGate", () => ({
    ...jest.requireActual("../../src/clariva/chat/useChatGate"),
    useClarivaDmPeerId: jest.fn(() => null),
}));

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState): void => {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
};

function fakeClient(): MatrixClient {
    return {
        baseUrl: "https://hs.example",
        getSafeUserId: () => ME,
        getPresence: jest.fn(async () => ({ presence: "online", last_active_ago: 0 })),
    } as unknown as MatrixClient;
}

beforeEach(() => {
    jest.useFakeTimers();
    configureClariva();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    jest.spyOn(WalletStore.instance, "userId", "get").mockReturnValue(ME);
    jest.spyOn(WalletStore.instance, "refreshPeer").mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    PeerPresencePoller.resetForTests();
    WalletStore.resetForTests();
    jest.restoreAllMocks();
    jest.useRealTimers();
    SdkConfig.reset();
});

describe("PeerPresencePoller (Android DmPeerStatusPresenter's poll)", () => {
    it("polls at once and every 20 s, and re-reads the partner's profile on open and every 3 polls", async () => {
        const client = fakeClient();
        const listener = jest.fn();
        PeerPresencePoller.instance.subscribe(client, CONSULTANT, listener);
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(1);
        expect(client.getPresence).toHaveBeenCalledWith(CONSULTANT);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(PeerPresencePoller.instance.getPresence(CONSULTANT)?.isOnline).toBe(true);
        expect(WalletStore.instance.refreshPeer).toHaveBeenCalledTimes(1); // once per open

        for (let i = 1; i <= PROFILE_REFRESH_EVERY_POLLS; i++) {
            jest.advanceTimersByTime(PRESENCE_POLL_MS);
            await flush();
        }
        expect(client.getPresence).toHaveBeenCalledTimes(1 + PROFILE_REFRESH_EVERY_POLLS);
        expect(WalletStore.instance.refreshPeer).toHaveBeenCalledTimes(2); // ... and on the 4th poll
    });

    it("a failed poll keeps the last value", async () => {
        const client = fakeClient();
        PeerPresencePoller.instance.subscribe(client, CONSULTANT, jest.fn());
        await flush();
        jest.mocked(client.getPresence).mockRejectedValueOnce(new Error("403"));
        jest.advanceTimersByTime(PRESENCE_POLL_MS);
        await flush();
        expect(PeerPresencePoller.instance.getPresence(CONSULTANT)?.isOnline).toBe(true);
        // and the loop goes on
        jest.advanceTimersByTime(PRESENCE_POLL_MS);
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(3);
    });

    it("one poll per partner however many parts of the chat watch it; the last one out stops it", async () => {
        const client = fakeClient();
        const off1 = PeerPresencePoller.instance.subscribe(client, CONSULTANT, jest.fn());
        const off2 = PeerPresencePoller.instance.subscribe(client, CONSULTANT, jest.fn());
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(1);
        expect(WalletStore.instance.refreshPeer).toHaveBeenCalledTimes(1);
        off1();
        jest.advanceTimersByTime(PRESENCE_POLL_MS);
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(2);
        off2();
        jest.advanceTimersByTime(PRESENCE_POLL_MS * 3);
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(2);
        expect(PeerPresencePoller.instance.getPresence(CONSULTANT)).toBeNull();
    });

    it("pauses while the tab is hidden and polls again straight away when it comes back", async () => {
        const client = fakeClient();
        PeerPresencePoller.instance.subscribe(client, CONSULTANT, jest.fn());
        await flush();
        setVisibility("hidden");
        jest.advanceTimersByTime(PRESENCE_POLL_MS * 3);
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(1);
        setVisibility("visible");
        await flush();
        expect(client.getPresence).toHaveBeenCalledTimes(2);
    });
});

describe("useDmPeerStatus", () => {
    let peer: PeerWalletInfo | undefined;
    let peerJoined: boolean;

    function Probe({ room }: { room: Room }): JSX.Element {
        const status = useDmPeerStatus(room);
        return (
            <span data-testid="probe" data-online={String(status.online)}>
                {`${status.badge ?? "-"}|${status.presence ?? "-"}`}
            </span>
        );
    }

    const mkRoom = (client: MatrixClient): Room =>
        ({
            client,
            roomId: "!dm:x",
            getMyMembership: () => "join",
            getMember: () => ({ membership: peerJoined ? "join" : "invite" }),
        }) as unknown as Room;

    const withPrivacy = (privacy: Partial<PresencePrivacy>): PeerWalletInfo => ({
        isConsultant: true,
        maxCredits: 100,
        designation: "Dentist",
        presencePrivacy: { ...DEFAULT_PRESENCE_PRIVACY, ...privacy },
        fetchedAt: Date.now(),
    });

    beforeEach(() => {
        jest.mocked(useClarivaDmPeerId).mockReturnValue(CONSULTANT);
        peer = withPrivacy({});
        peerJoined = true;
        jest.spyOn(WalletStore.instance, "getCachedPeer").mockImplementation(() => peer);
    });

    it("the consultant's designation and 'online' (both choices allow it)", async () => {
        const client = fakeClient();
        render(<Probe room={mkRoom(client)} />);
        await act(flush);
        expect(screen.getByTestId("probe")).toHaveTextContent("Dentist|online");
        expect(screen.getByTestId("probe")).toHaveAttribute("data-online", "true");
    });

    it("the partner's unknown choice hides their presence; the badge still shows", async () => {
        peer = { ...withPrivacy({}), presencePrivacy: undefined };
        render(<Probe room={mkRoom(fakeClient())} />);
        await act(flush);
        expect(screen.getByTestId("probe")).toHaveTextContent("Dentist|-");
    });

    it("'My contacts': hidden until both have joined the chat", async () => {
        peer = withPrivacy({ lastSeen: LastSeenAudience.MyContacts, online: OnlineAudience.SameAsLastSeen });
        peerJoined = false;
        render(<Probe room={mkRoom(fakeClient())} />);
        await act(flush);
        expect(screen.getByTestId("probe")).toHaveTextContent("Dentist|-");
    });

    it("a 'last seen' label when the partner is offline, and a client gets no badge", async () => {
        peer = { ...withPrivacy({}), isConsultant: false };
        const client = fakeClient();
        jest.mocked(client.getPresence).mockResolvedValue({ presence: "offline", last_active_ago: 60_000 } as never);
        render(<Probe room={mkRoom(client)} />);
        await act(flush);
        expect(screen.getByTestId("probe")).toHaveTextContent(/^-\|last seen today at /);
        expect(screen.getByTestId("probe")).toHaveAttribute("data-online", "false");
    });

    it("updates when the WalletStore reloads the partner (a new designation)", async () => {
        render(<Probe room={mkRoom(fakeClient())} />);
        await act(flush);
        peer = { ...withPrivacy({}), designation: "Cardiologist" };
        act(() => {
            WalletStore.instance.emit(WalletStoreEvent.Peer, CONSULTANT);
        });
        expect(screen.getByTestId("probe")).toHaveTextContent("Cardiologist|online");
    });

    it("no peer (not a 1:1 chat, or Clariva off): nothing, and nothing is polled", async () => {
        jest.mocked(useClarivaDmPeerId).mockReturnValue(null);
        const client = fakeClient();
        render(<Probe room={mkRoom(client)} />);
        await act(flush);
        expect(screen.getByTestId("probe")).toHaveTextContent("-|-");
        expect(client.getPresence).not.toHaveBeenCalled();
    });

    it("no polling when the homeserver's presence is switched off in the config", async () => {
        SdkConfig.add({ enable_presence_by_hs_url: { "https://hs.example": false } });
        jest.spyOn(WalletStore.instance, "getPeer").mockResolvedValue(null);
        const client = fakeClient();
        render(<Probe room={mkRoom(client)} />);
        await act(flush);
        expect(client.getPresence).not.toHaveBeenCalled();
        expect(screen.getByTestId("probe")).toHaveTextContent("Dentist|-");
    });
});

describe("the designation badge elsewhere", () => {
    let peer: PeerWalletInfo | undefined;

    beforeEach(() => {
        jest.mocked(useClarivaDmPeerId).mockReturnValue(CONSULTANT);
        peer = undefined;
        jest.spyOn(WalletStore.instance, "getCachedPeer").mockImplementation(() => peer);
    });

    it("chat list row: from the cache only, appears when the row's lookup loads the partner", () => {
        const getPeer = jest.spyOn(WalletStore.instance, "getPeer");
        render(<ClarivaRoomTileDesignation room={{} as Room} />);
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
        peer = { isConsultant: true, maxCredits: 100, designation: null, fetchedAt: 0 };
        act(() => {
            WalletStore.instance.emit(WalletStoreEvent.Peer, CONSULTANT);
        });
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Consultant");
        expect(getPeer).not.toHaveBeenCalled(); // the rate tag's queued lookup fills the cache
    });

    it("chat list row: nothing for a client", () => {
        peer = { isConsultant: false, maxCredits: 0, designation: "Dentist", fetchedAt: 0 };
        render(<ClarivaRoomTileDesignation room={{} as Room} />);
        expect(screen.queryByTestId("clariva-role-badge")).toBeNull();
    });

    it("profile panel: looks the user up and shows a consultant's designation", async () => {
        jest.spyOn(WalletStore.instance, "getSnapshot").mockReturnValue({ userId: ME } as never);
        const getPeer = jest.spyOn(WalletStore.instance, "getPeer").mockImplementation(async () => {
            peer = { isConsultant: true, maxCredits: 100, designation: "Cardiologist", fetchedAt: 0 };
            WalletStore.instance.emit(WalletStoreEvent.Peer, CONSULTANT);
            return peer;
        });
        render(<ClarivaUserDesignationBadge userId={CONSULTANT} />);
        await act(flush);
        expect(getPeer).toHaveBeenCalledWith(CONSULTANT, expect.anything());
        expect(screen.getByTestId("clariva-user-designation")).toHaveTextContent("Cardiologist");
    });

    it("profile panel: nothing without Clariva", () => {
        SdkConfig.reset();
        peer = { isConsultant: true, maxCredits: 100, designation: "Cardiologist", fetchedAt: 0 };
        const { container } = render(<ClarivaUserDesignationBadge userId={CONSULTANT} />);
        expect(container).toBeEmptyDOMElement();
    });
});
