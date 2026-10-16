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
import { act, fireEvent, render, screen } from "@testing-library/react";

import SdkConfig from "../../src/SdkConfig";
import Modal from "../../src/Modal";
import dis from "../../src/dispatcher/dispatcher";
import { MyQrCodeDialog, MyQrImage } from "../../src/clariva/components/qr/MyQrCodeDialog";
import { ScanQrCodeDialog } from "../../src/clariva/components/qr/ScanQrCodeDialog";
import { MyQrSettingsRow } from "../../src/clariva/components/qr/MyQrSettingsRow";
import { StartChatQrActions } from "../../src/clariva/components/qr/StartChatQrActions";
import { openScanQrCodeDialog, showUserProfile } from "../../src/clariva/components/qr/dialogs";
import * as qrMatrix from "../../src/clariva/qr/qrMatrix";
import { allowedUserLinkHosts, parseUserQrPayload } from "../../src/clariva/qr/payload";
import { type ScannerDeps } from "../../src/clariva/qr/scanner";
import { qrStrings } from "../../src/clariva/strings/qr";
import { filterConsole, mockPlatformPeg, stubClient } from "../test-utils";
import { configureClariva } from "./helpers";

const MY_ID = "@userId:matrix.org"; // the id the test client reports
const MY_LINK = "https://clarivahub.com/u/%40userId%3Amatrix.org";
const JANE = "@jane:clarivahub.com";
const JANE_LINK = "https://clarivahub.com/u/%40jane%3Aclarivahub.com";

function setNavigator(name: "share" | "clipboard", value: unknown): void {
    Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}
function clearNavigator(name: "share" | "clipboard"): void {
    Reflect.deleteProperty(navigator, name);
}

describe("Clariva QR dialogs", () => {
    mockPlatformPeg();
    filterConsole(
        "copyPlaintext failed", // expected: the "could not copy" test
        "unstable_flushDiscreteUpdates", // React 17 + jsdom: setting the muted attribute of a <video> fires volumechange
    );

    beforeEach(() => {
        stubClient();
        configureClariva({ user_link_base: "https://clarivahub.com/u/" });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        clearNavigator("share");
        clearNavigator("clipboard");
        SdkConfig.reset();
    });

    describe("MyQrImage", () => {
        it("shows the code with an accessible name", () => {
            render(<MyQrImage link={MY_LINK} />);
            const img = screen.getByRole("img", { name: "My QR code" });
            expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
            expect(img).toHaveAttribute("width", "220");
        });

        it("falls back to 'QR code is not available.' without a payload", () => {
            render(<MyQrImage link={null} />);
            expect(screen.getByText("QR code is not available.")).toBeInTheDocument();
            expect(screen.queryByRole("img")).not.toBeInTheDocument();
        });

        it("falls back to the same text when the payload cannot be encoded (too long for a QR code)", () => {
            render(<MyQrImage link={"https://clarivahub.com/u/" + "x".repeat(4000)} />);
            expect(screen.getByText("QR code is not available.")).toBeInTheDocument();
        });
    });

    describe("MyQrCodeDialog", () => {
        it("encodes <user_link_base> + encodeURIComponent(my id) and names the user", () => {
            const encode = jest.spyOn(qrMatrix, "qrSvgDataUri");
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            expect(encode).toHaveBeenCalledWith(MY_LINK);
            expect(screen.getByText("My QR code", { selector: "h1" })).toBeInTheDocument();
            expect(screen.getByText(MY_ID)).toBeInTheDocument();
            expect(screen.getByRole("img", { name: "My QR code" })).toBeInTheDocument();
        });

        it("'Share link' uses the Web Share API when the browser has it", async () => {
            const share = jest.fn().mockResolvedValue(undefined);
            setNavigator("share", share);
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            fireEvent.click(screen.getByRole("button", { name: "Share link" }));
            await act(async () => undefined);
            expect(share).toHaveBeenCalledWith({ title: "Share", text: MY_LINK });
            expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
        });

        it("'Share link' falls back to the clipboard and confirms with a toast", async () => {
            const writeText = jest.fn().mockResolvedValue(undefined);
            setNavigator("clipboard", { writeText });
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            fireEvent.click(screen.getByRole("button", { name: "Share link" }));
            expect(await screen.findByText("Link copied")).toBeInTheDocument();
            expect(writeText).toHaveBeenCalledWith(MY_LINK);
        });

        it("falls back to the clipboard when sharing fails for another reason than cancelling", async () => {
            setNavigator(
                "share",
                jest.fn().mockRejectedValue(Object.assign(new Error("no targets"), { name: "NotAllowedError" })),
            );
            const writeText = jest.fn().mockResolvedValue(undefined);
            setNavigator("clipboard", { writeText });
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            fireEvent.click(screen.getByRole("button", { name: "Share link" }));
            expect(await screen.findByText("Link copied")).toBeInTheDocument();
        });

        it("says so when the link could not be copied either", async () => {
            setNavigator("clipboard", { writeText: jest.fn().mockRejectedValue(new Error("denied")) });
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            fireEvent.click(screen.getByRole("button", { name: "Share link" }));
            expect(await screen.findByText("Could not copy the link.")).toBeInTheDocument();
        });

        it("a dismissed share sheet is not an error", async () => {
            setNavigator(
                "share",
                jest.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" })),
            );
            const writeText = jest.fn();
            setNavigator("clipboard", { writeText });
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            fireEvent.click(screen.getByRole("button", { name: "Share link" }));
            await act(async () => undefined);
            expect(writeText).not.toHaveBeenCalled();
            expect(screen.queryByText("Link copied")).not.toBeInTheDocument();
        });

        it("shows 'QR code is not available.' (and disables sharing) when Clariva QR is switched off", () => {
            configureClariva({ features: { qr: false } });
            render(<MyQrCodeDialog onFinished={jest.fn()} />);
            expect(screen.getByText("QR code is not available.")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Share link" })).toHaveAttribute("aria-disabled", "true");
        });
    });

    describe("entry points", () => {
        it("Settings -> Account shows 'My QR code' and opens the dialog", () => {
            const create = jest
                .spyOn(Modal, "createDialog")
                .mockReturnValue({ finished: new Promise(() => undefined) } as any);
            render(<MyQrSettingsRow />);
            fireEvent.click(screen.getByRole("button", { name: "My QR code" }));
            expect(create).toHaveBeenCalledWith(MyQrCodeDialog, {});
        });

        it("renders nothing without Clariva configuration or with features.qr=false", () => {
            SdkConfig.reset();
            const a = render(<MyQrSettingsRow />);
            const b = render(<StartChatQrActions onClose={jest.fn()} />);
            expect(a.container).toBeEmptyDOMElement();
            expect(b.container).toBeEmptyDOMElement();

            configureClariva({ features: { qr: false } });
            const c = render(<MyQrSettingsRow />);
            expect(c.container).toBeEmptyDOMElement();
        });

        it("Start chat offers 'Scan QR code' (and a shortcut to 'My QR code') and closes itself first", () => {
            const create = jest
                .spyOn(Modal, "createDialog")
                .mockReturnValue({ finished: new Promise(() => undefined) } as any);
            const onClose = jest.fn();
            render(<StartChatQrActions onClose={onClose} />);
            fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(create).toHaveBeenCalledWith(ScanQrCodeDialog, {});

            fireEvent.click(screen.getByRole("button", { name: "My QR code" }));
            expect(onClose).toHaveBeenCalledTimes(2);
            expect(create).toHaveBeenLastCalledWith(MyQrCodeDialog, {});
        });

        it("a scanned user opens that profile (the same screen as #/user/<mxid>)", async () => {
            jest.spyOn(Modal, "createDialog").mockReturnValue({ finished: Promise.resolve([JANE]) } as any);
            const dispatch = jest.spyOn(dis, "dispatch").mockImplementation(() => undefined);
            expect(await openScanQrCodeDialog()).toBe(JANE);
            expect(dispatch).toHaveBeenCalledWith({ action: "view_user_info", userId: JANE });
        });

        it("cancelling the scanner opens nothing", async () => {
            jest.spyOn(Modal, "createDialog").mockReturnValue({ finished: Promise.resolve([undefined]) } as any);
            const dispatch = jest.spyOn(dis, "dispatch").mockImplementation(() => undefined);
            expect(await openScanQrCodeDialog()).toBeUndefined();
            expect(dispatch).not.toHaveBeenCalled();
            showUserProfile(JANE);
            expect(dispatch).toHaveBeenCalledTimes(1);
        });
    });

    describe("ScanQrCodeDialog", () => {
        const STATE = "clariva-scan-qr";
        let getUserMedia: jest.Mock;
        let decode: jest.Mock;
        let stream: { getTracks(): Array<{ stop: jest.Mock }> };
        let deps: Partial<ScannerDeps>;

        const flush = async (ms = 0): Promise<void> => {
            await act(async () => {
                await jest.advanceTimersByTimeAsync(ms);
            });
        };
        const state = (): string | null => screen.getByTestId(STATE).getAttribute("data-state");

        beforeEach(() => {
            jest.useFakeTimers();
            // jsdom has no media pipeline: pretend the <video> is playing
            jest.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
            jest.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
            jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
            jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

            const tracks = [{ stop: jest.fn() }];
            stream = { getTracks: () => tracks };
            getUserMedia = jest.fn().mockResolvedValue(stream);
            decode = jest.fn().mockResolvedValue(null);
            deps = {
                mediaDevices: { getUserMedia } as unknown as MediaDevices,
                isSecureContext: true,
                createDecoder: async () => ({ decode }),
                parse: (text) =>
                    parseUserQrPayload(text, { allowedHosts: allowedUserLinkHosts("https://clarivahub.com/u/") }),
                scanIntervalMs: 100,
            };
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it("opens the camera on its own and shows the preview", async () => {
            render(<ScanQrCodeDialog onFinished={jest.fn()} deps={deps} />);
            await flush();
            expect(screen.getByText("Scan QR code", { selector: "h1" })).toBeInTheDocument();
            expect(getUserMedia).toHaveBeenCalledTimes(1);
            expect(state()).toBe("scanning");
            expect(screen.getByLabelText("Camera preview")).toBeInTheDocument();
        });

        it("a valid Clariva code closes the dialog with the user id and releases the camera", async () => {
            const onFinished = jest.fn();
            decode.mockResolvedValueOnce(null).mockResolvedValueOnce(JANE_LINK);
            render(<ScanQrCodeDialog onFinished={onFinished} deps={deps} />);
            await flush(); // camera granted, <video> mounted
            await flush(250); // two frames: nothing, then the code
            expect(onFinished).toHaveBeenCalledWith(JANE);
            expect(stream.getTracks()[0].stop).toHaveBeenCalledTimes(1);
        });

        it("another QR code shows 'Not a valid user QR code.' and 'Try again' resumes scanning", async () => {
            const onFinished = jest.fn();
            decode.mockResolvedValueOnce("https://example.org/not-a-user");
            render(<ScanQrCodeDialog onFinished={onFinished} deps={deps} />);
            await flush();
            await flush(150);
            expect(state()).toBe("invalid");
            expect(screen.getByText("Not a valid user QR code.")).toBeInTheDocument();
            expect(onFinished).not.toHaveBeenCalled();

            decode.mockResolvedValue(JANE_LINK);
            fireEvent.click(screen.getByRole("button", { name: "Try again" }));
            await flush(150);
            expect(onFinished).toHaveBeenCalledWith(JANE);
            expect(getUserMedia).toHaveBeenCalledTimes(1); // no second permission prompt
        });

        it("a refused permission shows the message and 'Grant camera access' asks again", async () => {
            getUserMedia.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
            render(<ScanQrCodeDialog onFinished={jest.fn()} deps={deps} />);
            await flush();
            expect(screen.getByText("Camera access is required to scan a QR code.")).toBeInTheDocument();
            expect(state()).toBe("denied");

            fireEvent.click(screen.getByRole("button", { name: "Grant camera access" }));
            await flush();
            expect(getUserMedia).toHaveBeenCalledTimes(2);
            expect(state()).toBe("scanning");
        });

        it("explains the HTTPS requirement on an insecure origin", async () => {
            render(<ScanQrCodeDialog onFinished={jest.fn()} deps={{ ...deps, isSecureContext: false }} />);
            await flush();
            expect(
                screen.getByText("Scanning needs a secure (HTTPS) connection and a browser that can use the camera."),
            ).toBeInTheDocument();
            expect(getUserMedia).not.toHaveBeenCalled();
        });

        it("says when there is no camera and still offers a picture", async () => {
            getUserMedia.mockRejectedValue(Object.assign(new Error("none"), { name: "NotFoundError" }));
            render(<ScanQrCodeDialog onFinished={jest.fn()} deps={deps} />);
            await flush();
            expect(screen.getByText("No camera was found on this device.")).toBeInTheDocument();
            expect(screen.getByText("Scan from an image")).toBeInTheDocument();
        });

        it("releases the camera when the dialog is closed", async () => {
            const { unmount } = render(<ScanQrCodeDialog onFinished={jest.fn()} deps={deps} />);
            await flush();
            expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
            unmount();
            expect(stream.getTracks()[0].stop).toHaveBeenCalledTimes(1);
        });

        it("Cancel / Escape finish without a user", async () => {
            const onFinished = jest.fn();
            render(<ScanQrCodeDialog onFinished={onFinished} deps={deps} />);
            await flush();
            fireEvent.click(screen.getByLabelText("Close dialog"));
            expect(onFinished).toHaveBeenCalledWith();
        });
    });

    it("keeps the Android wording in one place", () => {
        expect(qrStrings).toMatchObject({
            scanQrCode: "Scan QR code",
            cameraAccessRequired: "Camera access is required to scan a QR code.",
            grantCameraAccess: "Grant camera access",
            tryAgain: "Try again",
            notAValidUserQr: "Not a valid user QR code.",
            myQrCode: "My QR code",
            shareLink: "Share link",
            qrNotAvailable: "QR code is not available.",
            unresolvedUser: "This Matrix ID can't be found, so the invite might not be received.",
            sendInviteTitle: "Send invite?",
            sendInvite: "Send invite",
            searchForSomeone: "Search for someone",
            startChat: "Start chat",
            noResults: "No results",
        });
        expect(qrStrings.inviteText("Clariva", MY_LINK)).toBe(`Hey, talk to me on Clariva: ${MY_LINK}`);
    });
});
