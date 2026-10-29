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
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import Modal from "../../src/Modal";
import SdkConfig from "../../src/SdkConfig";
import MatrixClientContext from "../../src/contexts/MatrixClientContext";
import { ClarivaLastSeenSettings } from "../../src/clariva/components/settings/LastSeenSettings";
import { LastSeenExceptionsDialog } from "../../src/clariva/components/settings/LastSeenExceptionsDialog";
import {
    ClarivaDesignationSettings,
    DesignationDialog,
} from "../../src/clariva/components/settings/DesignationSettings";
import { WalletStore, type WalletSnapshot } from "../../src/clariva/stores/WalletStore";
import {
    DEFAULT_PRESENCE_PRIVACY,
    exceptToken,
    LastSeenAudience,
    OnlineAudience,
    type PresencePrivacy,
} from "../../src/clariva/profile/settings";
import { type PresenceContact } from "../../src/clariva/presence/contacts";
import { profileStrings as S } from "../../src/clariva/strings/profile";
import { CLIENT, ME, configureClariva } from "./helpers";

jest.mock("../../src/clariva/presence/contacts", () => ({
    ...jest.requireActual("../../src/clariva/presence/contacts"),
    presenceContacts: jest.fn(() => []),
}));
jest.mock("../../src/components/views/avatars/RoomAvatar", () => ({
    __esModule: true,
    default: () => <span data-testid="room-avatar" />,
}));

const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};

let snapshot: Partial<WalletSnapshot>;
const client = { getSafeUserId: () => ME, getUserId: () => ME, getRooms: () => [] } as unknown as MatrixClient;

beforeEach(() => {
    configureClariva();
    snapshot = { presencePrivacy: { ...DEFAULT_PRESENCE_PRIVACY } };
    const store = WalletStore.instance;
    const real = store.getSnapshot.bind(store);
    jest.spyOn(store, "getSnapshot").mockImplementation(() => ({ ...real(), ...snapshot }));
});

afterEach(() => {
    cleanup();
    WalletStore.resetForTests();
    jest.restoreAllMocks();
    SdkConfig.reset();
});

const renderInClient = (ui: React.ReactElement): ReturnType<typeof render> =>
    render(<MatrixClientContext.Provider value={client}>{ui}</MatrixClientContext.Provider>);

describe("Settings: 'Last seen and online' (Android LastSeenPrivacyView)", () => {
    it("shows Android's options, the current choice and the reciprocity note", () => {
        snapshot.presencePrivacy = { ...DEFAULT_PRESENCE_PRIVACY, online: OnlineAudience.SameAsLastSeen };
        renderInClient(<ClarivaLastSeenSettings save={jest.fn()} />);
        expect(screen.getByText(S.lastSeenTitle)).toBeInTheDocument();
        expect(screen.getByText(S.lastSeenWho)).toBeInTheDocument();
        expect(screen.getByText(S.onlineWho)).toBeInTheDocument();
        for (const label of ["Everyone", "My contacts", "My contacts except...", "Nobody"]) {
            expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
        }
        expect(screen.getByLabelText("Same as last seen")).toBeChecked();
        expect(
            screen.getByText(
                "If you don't share when you were last seen or online, you won't be able to see when other people were last seen or online.",
            ),
        ).toBeInTheDocument();
    });

    it("saves a new choice (and drops the exclusions)", async () => {
        const save = jest.fn(async () => {});
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText("Nobody"));
            await flush();
        });
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({ lastSeen: LastSeenAudience.Nobody, online: OnlineAudience.Everyone }),
        );
    });

    it("a failed save reverts the page and says so", async () => {
        let reject!: (e: Error) => void;
        const save = jest.fn(() => new Promise<void>((_, r) => (reject = r)));
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText("Nobody"));
            await flush();
        });
        // shown at once while it saves
        expect(screen.getByLabelText("Nobody")).toBeChecked();
        await act(async () => {
            reject(new Error("500"));
            await flush();
        });
        expect(screen.getByTestId("clariva-last-seen-error")).toHaveTextContent(
            "Couldn't save your choice. Please try again.",
        );
        expect(screen.getAllByLabelText("Everyone")[0]).toBeChecked();
    });

    it("'My contacts except...' opens the picker; Done saves the ticked people as tokens", async () => {
        const save = jest.fn(async () => {});
        const dialog = jest
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: Promise.resolve([new Set([CLIENT])]), close: jest.fn() } as never);
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText("My contacts except..."));
            await flush();
        });
        expect(dialog).toHaveBeenCalledWith(LastSeenExceptionsDialog, expect.objectContaining({ contacts: [] }));
        const saved = (save.mock.calls[0] as unknown as [PresencePrivacy])[0];
        expect(saved.lastSeen).toBe(LastSeenAudience.MyContactsExcept);
        expect([...saved.lastSeenExcept]).toEqual([exceptToken(ME, CLIENT)]);
    });

    it("cancelling the picker changes nothing", async () => {
        const save = jest.fn(async () => {});
        jest.spyOn(Modal, "createDialog").mockReturnValue({ finished: Promise.resolve([]), close: jest.fn() } as never);
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText("My contacts except..."));
            await flush();
        });
        expect(save).not.toHaveBeenCalled();
    });

    it("arrowing onto 'My contacts except...' only selects it: no picker, no save; Enter then opens the picker", async () => {
        const save = jest.fn(async () => {});
        const dialog = jest
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: Promise.resolve([new Set([CLIENT])]), close: jest.fn() } as never);
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        const except = screen.getByLabelText("My contacts except...");
        await act(async () => {
            // a browser moves the checked radio on ArrowDown and reports it as a click/change
            fireEvent.keyDown(except, { key: "ArrowDown" });
            fireEvent.click(except);
            await flush();
        });
        expect(dialog).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(except).toBeChecked();
        expect(except).toBeEnabled();
        expect(screen.getByTestId("clariva-except-summary")).toHaveTextContent("No contacts excluded");

        await act(async () => {
            fireEvent.keyDown(except, { key: "Enter" });
            await flush();
        });
        expect(dialog).toHaveBeenCalledTimes(1);
        expect((save.mock.calls[0] as unknown as [PresencePrivacy])[0].lastSeen).toBe(LastSeenAudience.MyContactsExcept);
    });

    it("keeps the options enabled while saving and saves the newest choice made meanwhile", async () => {
        const resolvers: Array<() => void> = [];
        const save = jest.fn(() => new Promise<void>((r) => resolvers.push(r)));
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        await act(async () => {
            fireEvent.keyDown(screen.getByLabelText("My contacts"), { key: "ArrowDown" });
            fireEvent.click(screen.getByLabelText("My contacts"));
            await flush();
        });
        expect(screen.getByLabelText("Nobody")).toBeEnabled();
        await act(async () => {
            fireEvent.keyDown(screen.getByLabelText("Nobody"), { key: "ArrowDown" });
            fireEvent.click(screen.getByLabelText("Nobody"));
            await flush();
        });
        // one write at a time
        expect(save).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText("Nobody")).toBeChecked();
        await act(async () => {
            resolvers[0]();
            await flush();
        });
        expect(save).toHaveBeenCalledTimes(2);
        expect((save.mock.calls[1] as unknown as [PresencePrivacy])[0].lastSeen).toBe(LastSeenAudience.Nobody);
        await act(async () => {
            resolvers[1]();
            await flush();
        });
        expect(screen.queryByTestId("clariva-last-seen-error")).toBeNull();
    });

    it("exceptions picked while an earlier choice is still saving build on that choice, not the stored one", async () => {
        const resolvers: Array<() => void> = [];
        const save = jest.fn(() => new Promise<void>((r) => resolvers.push(r)));
        jest.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve([new Set([CLIENT])]),
            close: jest.fn(),
        } as never);
        renderInClient(<ClarivaLastSeenSettings save={save} />);
        await act(async () => {
            fireEvent.click(screen.getByLabelText("Same as last seen"));
            await flush();
        });
        // still saving: the store has not changed yet
        expect(save).toHaveBeenCalledTimes(1);
        expect((save.mock.calls[0] as unknown as [PresencePrivacy])[0].online).toBe(OnlineAudience.SameAsLastSeen);

        await act(async () => {
            fireEvent.click(screen.getByLabelText("My contacts except..."));
            await flush();
        });
        await act(async () => {
            resolvers[0]();
            await flush();
        });
        expect(save).toHaveBeenCalledTimes(2);
        const second = (save.mock.calls[1] as unknown as [PresencePrivacy])[0];
        expect(second.online).toBe(OnlineAudience.SameAsLastSeen);
        expect(second.lastSeen).toBe(LastSeenAudience.MyContactsExcept);
        expect([...second.lastSeenExcept]).toEqual([exceptToken(ME, CLIENT)]);
        await act(async () => {
            resolvers[1]();
            await flush();
        });
    });

    it("with 'My contacts except...' selected: how many are excluded, and an Edit button for the picker", () => {
        snapshot.presencePrivacy = {
            ...DEFAULT_PRESENCE_PRIVACY,
            lastSeen: LastSeenAudience.MyContactsExcept,
            lastSeenExcept: new Set(["a", "b"]),
        };
        renderInClient(<ClarivaLastSeenSettings save={jest.fn()} />);
        expect(screen.getByTestId("clariva-except-summary")).toHaveTextContent("2 contacts excluded");
        expect(screen.getByTestId("clariva-except-edit")).toHaveTextContent("Edit");
        expect(S.excludedSummary(0)).toBe("No contacts excluded");
        expect(S.excludedSummary(1)).toBe("1 contact excluded");
    });

    it("renders nothing without Clariva", () => {
        SdkConfig.reset();
        const { container } = renderInClient(<ClarivaLastSeenSettings />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe("the 'Hide my last seen from' picker", () => {
    const contacts = [
        { userId: "@amy:x", name: "Amy", room: {} },
        { userId: "@zed:x", name: null, room: {} },
    ] as unknown as PresenceContact[];

    it("lists the contacts with the saved ones ticked; Done returns the new selection", () => {
        const onFinished = jest.fn();
        render(<LastSeenExceptionsDialog contacts={contacts} excluded={new Set(["@zed:x"])} onFinished={onFinished} />);
        expect(screen.getByText(S.exceptHint)).toBeInTheDocument();
        const amy = screen.getByRole("checkbox", { name: /Amy/ });
        const zed = screen.getByRole("checkbox", { name: /@zed:x/ });
        expect(amy).not.toBeChecked();
        expect(zed).toBeChecked();
        fireEvent.click(amy);
        fireEvent.click(zed);
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(onFinished).toHaveBeenCalledWith(new Set(["@amy:x"]));
    });

    it("says so when there is nobody to pick", () => {
        render(<LastSeenExceptionsDialog contacts={[]} excluded={new Set()} onFinished={jest.fn()} />);
        expect(screen.getByTestId("clariva-except-empty")).toHaveTextContent(
            "You don't have any chats yet. People you chat with will appear here.",
        );
    });
});

describe("Settings: 'Designation' (Android PreferencesRootView.DesignationItem)", () => {
    it("is for consultants only and shows the current designation, or 'Consultant'", () => {
        snapshot = { isConsultant: false };
        const { unmount } = render(<ClarivaDesignationSettings />);
        expect(screen.queryByTestId("clariva-designation")).toBeNull();
        unmount();

        snapshot = { isConsultant: true, designation: null };
        const second = render(<ClarivaDesignationSettings />);
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Consultant");
        second.unmount();

        snapshot = { isConsultant: true, designation: "Cardiologist" };
        render(<ClarivaDesignationSettings />);
        expect(screen.getByTestId("clariva-role-badge")).toHaveTextContent("Cardiologist");
        expect(screen.getByText(S.designationHint)).toBeInTheDocument();
    });

    it("saves what the editor returns; a failure is reported", async () => {
        snapshot = { isConsultant: true, designation: null };
        jest.spyOn(Modal, "createDialog").mockReturnValue({
            finished: Promise.resolve(["Dentist"]),
            close: jest.fn(),
        } as never);
        const save = jest.fn().mockRejectedValueOnce(new Error("500"));
        render(<ClarivaDesignationSettings save={save} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId("clariva-designation-edit"));
            await flush();
        });
        expect(save).toHaveBeenCalledWith("Dentist");
        expect(screen.getByTestId("clariva-designation-error")).toHaveTextContent(
            "Couldn't save your designation. Please try again.",
        );
    });

    it("the editor: Android's texts, at most 40 characters, Save returns the text", () => {
        const onFinished = jest.fn();
        render(<DesignationDialog value="Dentist" onFinished={onFinished} />);
        expect(
            screen.getByText('Shown under your name in chats. Leave it empty to show "Consultant".'),
        ).toBeInTheDocument();
        const input = screen.getByPlaceholderText("e.g. Cardiologist") as HTMLInputElement;
        expect(input.value).toBe("Dentist");

        fireEvent.change(input, { target: { value: "x".repeat(41) } });
        expect(screen.getByRole("alert")).toHaveTextContent("Use at most 40 characters.");
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

        fireEvent.change(input, { target: { value: "Cardiologist" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(onFinished).toHaveBeenCalledWith("Cardiologist");
    });
});
