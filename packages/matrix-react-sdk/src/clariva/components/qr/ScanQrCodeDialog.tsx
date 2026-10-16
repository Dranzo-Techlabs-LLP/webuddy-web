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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BaseDialog from "../../../components/views/dialogs/BaseDialog";
import AccessibleButton from "../../../components/views/elements/AccessibleButton";
import Spinner from "../../../components/views/elements/Spinner";
import { qrStrings } from "../../strings/qr";
import { parseScannedUserQr } from "../../qr/links";
import { createQrDecoder, decodeQrFromImageFile } from "../../qr/decoders";
import {
    QrScannerController,
    type ScannerDeps,
    type ScannerState,
    type ScannerUnavailableReason,
} from "../../qr/scanner";

interface Props {
    /** Called with the scanned user's id when a valid Clariva user QR code was read, or with nothing on cancel. */
    onFinished(userId?: string): void;
    /** Test seam: replaces the browser APIs (camera, decoder). */
    deps?: Partial<ScannerDeps>;
}

function browserDeps(): ScannerDeps {
    return {
        mediaDevices: typeof navigator !== "undefined" ? navigator.mediaDevices : undefined,
        isSecureContext: typeof window !== "undefined" && window.isSecureContext === true,
        createDecoder: () => createQrDecoder(),
        parse: parseScannedUserQr,
    };
}

function unavailableText(reason: ScannerUnavailableReason): string {
    switch (reason) {
        case "insecure":
        case "no-decoder":
            return qrStrings.cameraUnavailableInsecure;
        case "no-camera":
            return qrStrings.cameraNotFound;
        default:
            return qrStrings.cameraFailed;
    }
}

/** The controller's state as React state (React 17: subscribe in an effect). */
function useScannerState(controller: QrScannerController): ScannerState {
    const [state, setState] = useState<ScannerState>(controller.state);
    useEffect(() => {
        setState(controller.state);
        return controller.subscribe(() => setState(controller.state));
    }, [controller]);
    return state;
}

/**
 * Start chat -> "Scan QR code" (spec 04 §2.9, §3.17): live camera preview, decoded in the browser; a valid user code
 * closes the dialog and the caller opens that user's profile. Needs HTTPS (or localhost) for the camera. The camera is
 * always released when the dialog closes.
 */
export function ScanQrCodeDialog({ onFinished, deps }: Props): JSX.Element {
    const controller = useMemo(() => new QrScannerController({ ...browserDeps(), ...deps }), [deps]);
    const state = useScannerState(controller);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const fileInput = useRef<HTMLInputElement | null>(null);

    // Request the camera once when the dialog opens (Android does the same); release it on unmount.
    useEffect(() => {
        void controller.start();
        return () => controller.dispose();
    }, [controller]);

    // Valid code: hand the user id to the caller.
    useEffect(() => {
        if (state.kind === "found") onFinished(state.userId);
    }, [state, onFinished]);

    // Wire the stream into the <video> and let the controller read frames from it; freeze the picture on a result.
    const visible = state.kind === "scanning" || state.kind === "invalid" || state.kind === "found";
    useEffect(() => {
        const video = videoRef.current;
        const stream = controller.stream;
        if (!video || !stream || !visible) {
            controller.attachVideo(null);
            return;
        }
        if (video.srcObject !== stream) video.srcObject = stream;
        try {
            // freeze the picture while the result is shown; play() may return nothing on very old browsers
            if (state.kind === "scanning") void Promise.resolve(video.play?.()).catch(() => undefined);
            else video.pause?.();
        } catch {
            // autoplay is also set on the element; a failing play()/pause() must never break the scanner
        }
        controller.attachVideo(video);
        return () => controller.attachVideo(null);
    }, [controller, state, visible]);

    const onPickFile = useCallback(
        (ev: React.ChangeEvent<HTMLInputElement>): void => {
            const file = ev.target.files?.[0];
            ev.target.value = ""; // allow picking the same file again
            if (file) void controller.scanImage(() => decodeQrFromImageFile(file));
        },
        [controller],
    );

    const chooseImage = (
        <>
            <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={onPickFile}
                data-testid="clariva-scan-file"
            />
            <AccessibleButton kind="link" onClick={() => fileInput.current?.click()}>
                {qrStrings.scanFromImage}
            </AccessibleButton>
        </>
    );

    let body: JSX.Element;
    if (state.kind === "denied") {
        body = (
            <div className="mx_ClarivaScanQr_message">
                <p>{qrStrings.cameraAccessRequired}</p>
                <AccessibleButton kind="primary" onClick={() => void controller.start()}>
                    {qrStrings.grantCameraAccess}
                </AccessibleButton>
                {chooseImage}
            </div>
        );
    } else if (state.kind === "unavailable") {
        body = (
            <div className="mx_ClarivaScanQr_message">
                <p role="alert">{unavailableText(state.reason)}</p>
                {chooseImage}
            </div>
        );
    } else if (state.kind === "idle" && !controller.stream) {
        body = (
            <div className="mx_ClarivaScanQr_message">
                <Spinner />
            </div>
        );
    } else {
        body = (
            <>
                <div className="mx_ClarivaScanQr_frame">
                    {visible ? (
                        <video
                            ref={videoRef}
                            className="mx_ClarivaScanQr_video"
                            aria-label={qrStrings.cameraPreview}
                            muted
                            playsInline
                            autoPlay
                        />
                    ) : (
                        <Spinner />
                    )}
                    <span className="mx_ClarivaScanQr_corner mx_ClarivaScanQr_corner_tl" aria-hidden="true" />
                    <span className="mx_ClarivaScanQr_corner mx_ClarivaScanQr_corner_tr" aria-hidden="true" />
                    <span className="mx_ClarivaScanQr_corner mx_ClarivaScanQr_corner_bl" aria-hidden="true" />
                    <span className="mx_ClarivaScanQr_corner mx_ClarivaScanQr_corner_br" aria-hidden="true" />
                </div>
                {state.kind === "invalid" ? (
                    <div className="mx_ClarivaScanQr_message">
                        <p className="mx_ClarivaScanQr_error" role="alert">
                            {qrStrings.notAValidUserQr}
                        </p>
                        <AccessibleButton kind="primary" onClick={() => controller.retry()}>
                            {qrStrings.tryAgain}
                        </AccessibleButton>
                    </div>
                ) : (
                    <div className="mx_ClarivaScanQr_message">
                        {state.kind === "scanning" && (
                            <p className="mx_ClarivaScanQr_hint" role="status" aria-live="polite">
                                {qrStrings.scanHint}
                            </p>
                        )}
                        {chooseImage}
                    </div>
                )}
            </>
        );
    }

    return (
        <BaseDialog
            className="mx_ClarivaScanQrDialog"
            title={qrStrings.scanQrCode}
            onFinished={() => onFinished()}
            fixedWidth={false}
        >
            <div className="mx_ClarivaScanQr" data-testid="clariva-scan-qr" data-state={state.kind}>
                {body}
            </div>
        </BaseDialog>
    );
}
