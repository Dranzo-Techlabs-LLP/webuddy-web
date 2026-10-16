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
 * State machine of the "Scan QR code" screen (spec 04 §2.9, §3.17), independent of React and of the DOM so it can be
 * unit tested with a fake `getUserMedia` / decoder:
 *
 *   idle --start()--> requesting --camera granted--> scanning --decoded & valid--> found
 *                          |                            |--decoded & not a user code--> invalid --retry()--> scanning
 *                          |--permission refused--> denied --start() ("Grant camera access")--> requesting
 *                          |--no camera / insecure origin / no decoder / camera busy--> unavailable
 *
 * Android requests the permission automatically once when the screen opens, so the dialog calls `start()` on mount.
 * The camera stream is released on `stop()`/`dispose()`, when a code was found, and also if the permission prompt is
 * answered AFTER the dialog was closed (otherwise the camera light would stay on).
 */

export type ScannerUnavailableReason = "insecure" | "no-camera" | "no-decoder" | "error";

export type ScannerState =
    | { kind: "idle" }
    | { kind: "requesting" }
    | { kind: "scanning" }
    | { kind: "denied" }
    | { kind: "unavailable"; reason: ScannerUnavailableReason }
    | { kind: "invalid" }
    | { kind: "found"; userId: string };

/** The part of `HTMLVideoElement` the scanner relies on. */
export interface VideoLike {
    readyState: number;
    paused: boolean;
}

/** Grabs the current video frame and decodes a QR code from it; resolves null when there is none. */
interface FrameDecoder {
    decodeFrame(): Promise<string | null>;
}

export interface QrDecoder {
    /** Decode a QR code from an image/video source, resolving the raw text or null. */
    decode(source: unknown): Promise<string | null>;
}

export interface ScannerDeps {
    /** `navigator.mediaDevices` (undefined on insecure origins and old browsers). */
    mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined;
    /** `window.isSecureContext`: getUserMedia only exists on HTTPS / localhost. */
    isSecureContext: boolean;
    /** Resolves a decoder (BarcodeDetector or jsQR) or null when neither is available. */
    createDecoder(): Promise<QrDecoder | null>;
    /** QR text -> Matrix user id, or null for "Not a valid user QR code." */
    parse(text: string): string | null;
    /** Scan cadence. Injectable for tests; defaults to window timers. */
    setTimer?(callback: () => void, ms: number): unknown;
    clearTimer?(handle: unknown): void;
    /** Delay between two decode attempts. */
    scanIntervalMs?: number;
}

const DEFAULT_SCAN_INTERVAL_MS = 150;

export class QrScannerController {
    private currentState: ScannerState = { kind: "idle" };
    private mediaStream: MediaStream | null = null;
    private decoder: QrDecoder | null = null;
    private frameDecoder: FrameDecoder | null = null;
    private timer: unknown;
    private scanning = false; // a decode attempt is in flight
    private disposed = false;
    /** Bumped on stop/dispose/start so that async work belonging to an older run is discarded. */
    private run = 0;
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly deps: ScannerDeps) {}

    public get state(): ScannerState {
        return this.currentState;
    }

    /** The live camera stream (for `<video>.srcObject`), or null. */
    public get stream(): MediaStream | null {
        return this.mediaStream;
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Give the controller the (mounted) video element that shows the stream; frames are read from it. Scanning
     * begins as soon as there is both a stream and a video; pass null when the video is unmounted.
     */
    public attachVideo(video: VideoLike | null): void {
        this.frameDecoder = video
            ? {
                  decodeFrame: async (): Promise<string | null> => {
                      // HAVE_CURRENT_DATA (2) or more means there is a frame to read; a paused video is frozen
                      if (video.readyState < 2 || video.paused || !this.decoder) return null;
                      return this.decoder.decode(video);
                  },
              }
            : null;
        if (this.frameDecoder) this.scheduleScan();
        else this.cancelTimer();
    }

    /** Ask for the camera (used on open and by "Grant camera access"). Safe to call repeatedly. */
    public async start(): Promise<void> {
        if (this.disposed) return;
        const state = this.currentState.kind;
        if (state === "requesting" || state === "scanning" || state === "found") return;
        if (state === "invalid") {
            this.retry(); // the camera is still running: never open a second stream
            return;
        }

        const run = ++this.run;
        const { mediaDevices, isSecureContext } = this.deps;
        if (!isSecureContext || !mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
            this.setState({ kind: "unavailable", reason: "insecure" });
            return;
        }

        this.setState({ kind: "requesting" });

        if (!this.decoder) {
            try {
                this.decoder = await this.deps.createDecoder();
            } catch {
                this.decoder = null;
            }
            if (this.isStale(run)) return;
            if (!this.decoder) {
                this.setState({ kind: "unavailable", reason: "no-decoder" });
                return;
            }
        }

        let stream: MediaStream;
        try {
            stream = await this.openCamera();
        } catch (e) {
            if (this.isStale(run)) return;
            this.setState(this.stateForCameraError(e));
            return;
        }
        if (this.isStale(run)) {
            // The dialog was closed (or restarted) while the permission prompt was open: do not keep the camera on.
            stopStream(stream);
            return;
        }
        this.mediaStream = stream;
        this.setState({ kind: "scanning" });
        this.scheduleScan();
    }

    /** "Try again": resume scanning with the camera that is already running. */
    public retry(): void {
        if (this.disposed || this.currentState.kind !== "invalid") return;
        if (!this.mediaStream) {
            this.setState({ kind: "idle" });
            void this.start();
            return;
        }
        this.setState({ kind: "scanning" });
        this.scheduleScan();
    }

    /**
     * Decode a picked image instead of the camera (fallback for desktops without camera / denied permission).
     * Resolves the user id or null; also drives the state (`found` / `invalid`).
     */
    public async scanImage(decodeImage: () => Promise<string | null>): Promise<string | null> {
        if (this.disposed) return null;
        this.run++; // invalidate a camera start that may be pending
        this.releaseCamera();
        let text: string | null = null;
        try {
            text = await decodeImage();
        } catch {
            text = null;
        }
        if (this.disposed) return null;
        return this.handleDecoded(text);
    }

    /** Release the camera and timers. The controller can be started again afterwards. */
    public stop(): void {
        this.run++;
        this.releaseCamera();
        if (!this.disposed && this.currentState.kind !== "found") this.setState({ kind: "idle" });
    }

    /** Final clean-up (dialog unmounted). */
    public dispose(): void {
        this.disposed = true;
        this.run++;
        this.releaseCamera();
        this.listeners.clear();
    }

    // ── internals ───────────────────────────────────────────────────────────────────────────────────────────────

    private isStale(run: number): boolean {
        return this.disposed || run !== this.run;
    }

    private async openCamera(): Promise<MediaStream> {
        const mediaDevices = this.deps.mediaDevices!;
        try {
            // Back camera when the device has one (spec 06 §6.12); `ideal` never fails on a laptop webcam.
            return await mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        } catch (e) {
            if (errorName(e) === "OverconstrainedError" || errorName(e) === "ConstraintNotSatisfiedError") {
                return mediaDevices.getUserMedia({ video: true, audio: false });
            }
            throw e;
        }
    }

    private stateForCameraError(e: unknown): ScannerState {
        switch (errorName(e)) {
            case "NotAllowedError":
            case "PermissionDeniedError":
            case "SecurityError":
                return { kind: "denied" };
            case "NotFoundError":
            case "DevicesNotFoundError":
            case "OverconstrainedError":
                return { kind: "unavailable", reason: "no-camera" };
            default:
                return { kind: "unavailable", reason: "error" };
        }
    }

    private setState(next: ScannerState): void {
        this.currentState = next;
        for (const listener of [...this.listeners]) listener();
    }

    private releaseCamera(): void {
        this.cancelTimer();
        this.scanning = false;
        if (this.mediaStream) {
            stopStream(this.mediaStream);
            this.mediaStream = null;
        }
    }

    private cancelTimer(): void {
        if (this.timer !== undefined) {
            (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
            this.timer = undefined;
        }
    }

    private scheduleScan(): void {
        if (this.disposed || this.currentState.kind !== "scanning" || !this.frameDecoder || !this.mediaStream) return;
        if (this.timer !== undefined) return;
        const set = this.deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
        this.timer = set(() => {
            this.timer = undefined;
            void this.scanOnce();
        }, this.deps.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS);
    }

    private async scanOnce(): Promise<void> {
        const frameDecoder = this.frameDecoder;
        if (this.scanning || this.disposed || this.currentState.kind !== "scanning" || !frameDecoder) return;
        const run = this.run;
        this.scanning = true;
        let text: string | null = null;
        try {
            text = await frameDecoder.decodeFrame();
        } catch {
            text = null; // a bad frame is not fatal, try the next one
        } finally {
            this.scanning = false;
        }
        if (this.isStale(run) || this.currentState.kind !== "scanning") return;
        if (text === null || text === "") {
            this.scheduleScan();
            return;
        }
        this.handleDecoded(text);
    }

    /** First decoded frame stops scanning; a valid user code ends the flow, anything else shows "Try again". */
    private handleDecoded(text: string | null): string | null {
        if (text === null || text === "") {
            this.setState({ kind: "invalid" });
            return null;
        }
        const userId = this.deps.parse(text);
        if (userId) {
            this.releaseCamera();
            this.setState({ kind: "found", userId });
            return userId;
        }
        this.cancelTimer();
        this.setState({ kind: "invalid" });
        return null;
    }
}

function errorName(e: unknown): string {
    return typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
}

export function stopStream(stream: MediaStream): void {
    try {
        for (const track of stream.getTracks()) track.stop();
    } catch {
        // ignore: the stream is gone either way
    }
}
