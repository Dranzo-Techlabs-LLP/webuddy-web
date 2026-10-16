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

import { allowedUserLinkHosts, parseUserQrPayload } from "../../src/clariva/qr/payload";
import { QrScannerController, stopStream, type QrDecoder, type ScannerDeps } from "../../src/clariva/qr/scanner";

const JANE = "@jane:clarivahub.com";
const JANE_LINK = "https://clarivahub.com/u/%40jane%3Aclarivahub.com";
const HOSTS = allowedUserLinkHosts("https://clarivahub.com/u/");

const SCAN_MS = 100;

interface FakeTrack {
    stop: jest.Mock;
}
interface FakeStream {
    tracks: FakeTrack[];
    getTracks(): FakeTrack[];
}

function fakeStream(): MediaStream & FakeStream {
    const tracks: FakeTrack[] = [{ stop: jest.fn() }, { stop: jest.fn() }];
    return { tracks, getTracks: () => tracks } as unknown as MediaStream & FakeStream;
}

function domError(name: string): Error {
    const e = new Error(name);
    e.name = name;
    return e;
}

describe("QR scanner state machine (spec 04 §2.9, §3.17)", () => {
    let getUserMedia: jest.Mock;
    let decode: jest.Mock<Promise<string | null>, [unknown]>;
    let decoder: QrDecoder | null;
    let deps: ScannerDeps;
    let controller: QrScannerController;
    let streams: Array<MediaStream & FakeStream>;
    const video = { readyState: 4, paused: false };

    /** Make the controller read frames from a (fake) playing video. */
    const startScanning = async (): Promise<void> => {
        await controller.start();
        controller.attachVideo(video);
    };
    const tick = async (ms = SCAN_MS): Promise<void> => {
        await jest.advanceTimersByTimeAsync(ms);
    };
    const allTracksStopped = (stream: FakeStream): boolean =>
        stream.tracks.every((t) => t.stop.mock.calls.length === 1);

    beforeEach(() => {
        jest.useFakeTimers();
        streams = [];
        getUserMedia = jest.fn(async () => {
            const s = fakeStream();
            streams.push(s);
            return s;
        });
        decode = jest.fn<Promise<string | null>, [unknown]>(async () => null);
        decoder = { decode };
        deps = {
            mediaDevices: { getUserMedia } as unknown as MediaDevices,
            isSecureContext: true,
            createDecoder: jest.fn(async () => decoder),
            parse: (text) => parseUserQrPayload(text, { allowedHosts: HOSTS }),
            scanIntervalMs: SCAN_MS,
        };
        controller = new QrScannerController(deps);
    });

    afterEach(() => {
        controller.dispose();
        jest.useRealTimers();
    });

    it("starts idle", () => {
        expect(controller.state).toEqual({ kind: "idle" });
        expect(controller.stream).toBeNull();
    });

    describe("opening the camera", () => {
        it("asks for the back camera, video only, and moves requesting -> scanning", async () => {
            const seen: string[] = [];
            controller.subscribe(() => seen.push(controller.state.kind));
            await controller.start();
            expect(getUserMedia).toHaveBeenCalledTimes(1);
            expect(getUserMedia).toHaveBeenCalledWith({
                video: { facingMode: { ideal: "environment" } },
                audio: false,
            });
            expect(seen).toEqual(["requesting", "scanning"]);
            expect(controller.stream).toBe(streams[0]);
        });

        it("is idempotent while requesting or scanning", async () => {
            await Promise.all([controller.start(), controller.start()]);
            await controller.start();
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        });

        it("reports an insecure origin / missing mediaDevices without touching the camera API", async () => {
            const insecure = new QrScannerController({ ...deps, isSecureContext: false });
            await insecure.start();
            expect(insecure.state).toEqual({ kind: "unavailable", reason: "insecure" });

            const missing = new QrScannerController({ ...deps, mediaDevices: undefined });
            await missing.start();
            expect(missing.state).toEqual({ kind: "unavailable", reason: "insecure" });
            expect(getUserMedia).not.toHaveBeenCalled();
        });

        it("reports a missing decoder before it asks for the camera (no permission prompt for nothing)", async () => {
            decoder = null;
            await controller.start();
            expect(controller.state).toEqual({ kind: "unavailable", reason: "no-decoder" });
            expect(getUserMedia).not.toHaveBeenCalled();
        });

        it("reports a decoder that fails to load as no-decoder", async () => {
            (deps.createDecoder as jest.Mock).mockRejectedValue(new Error("chunk load failed"));
            await controller.start();
            expect(controller.state).toEqual({ kind: "unavailable", reason: "no-decoder" });
        });

        it.each(["NotAllowedError", "PermissionDeniedError", "SecurityError"])("%s -> denied", async (name) => {
            getUserMedia.mockRejectedValue(domError(name));
            await controller.start();
            expect(controller.state).toEqual({ kind: "denied" });
            expect(controller.stream).toBeNull();
        });

        it("'Grant camera access' asks again after a refusal", async () => {
            getUserMedia.mockRejectedValueOnce(domError("NotAllowedError"));
            await controller.start();
            expect(controller.state.kind).toBe("denied");
            await controller.start(); // the button
            expect(getUserMedia).toHaveBeenCalledTimes(2);
            expect(controller.state).toEqual({ kind: "scanning" });
        });

        it.each([
            ["NotFoundError", "no-camera"],
            ["DevicesNotFoundError", "no-camera"],
            ["NotReadableError", "error"],
            ["AbortError", "error"],
        ])("%s -> unavailable (%s)", async (name, reason) => {
            getUserMedia.mockRejectedValue(domError(name));
            await controller.start();
            expect(controller.state).toEqual({ kind: "unavailable", reason });
        });

        it("retries with any camera when the back camera constraint cannot be met", async () => {
            getUserMedia.mockRejectedValueOnce(domError("OverconstrainedError"));
            await controller.start();
            expect(getUserMedia).toHaveBeenCalledTimes(2);
            expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
            expect(controller.state).toEqual({ kind: "scanning" });
        });
    });

    describe("scanning", () => {
        it("keeps polling until a valid code appears, then stops everything", async () => {
            await startScanning();
            decode.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(JANE_LINK);
            await tick(SCAN_MS * 3);
            expect(controller.state).toEqual({ kind: "found", userId: JANE });
            expect(decode).toHaveBeenCalledTimes(3);
            expect(decode).toHaveBeenCalledWith(video);

            // the camera is released at once and nothing keeps scanning
            expect(controller.stream).toBeNull();
            expect(allTracksStopped(streams[0])).toBe(true);
            await tick(SCAN_MS * 10);
            expect(decode).toHaveBeenCalledTimes(3);
        });

        it("accepts the other payload forms the Android scanner accepts", async () => {
            for (const text of [
                "@jane:clarivahub.com",
                "https://matrix.to/#/@jane:clarivahub.com",
                "matrix:u/jane:clarivahub.com",
            ]) {
                const c = new QrScannerController({ ...deps });
                decode.mockResolvedValueOnce(text);
                await c.start();
                c.attachVideo(video);
                await tick();
                expect(c.state).toEqual({ kind: "found", userId: JANE });
                c.dispose();
            }
        });

        it("only starts decoding once a video element is attached", async () => {
            await controller.start();
            decode.mockResolvedValue(JANE_LINK);
            await tick(SCAN_MS * 5);
            expect(decode).not.toHaveBeenCalled();
            controller.attachVideo(video);
            await tick();
            expect(controller.state.kind).toBe("found");
        });

        it("skips frames while the video has no data yet or is frozen", async () => {
            const live = { readyState: 1, paused: false };
            await controller.start();
            controller.attachVideo(live);
            decode.mockResolvedValue(JANE_LINK);
            await tick(SCAN_MS * 3);
            expect(decode).not.toHaveBeenCalled();
            live.readyState = 4;
            live.paused = true;
            await tick(SCAN_MS * 3);
            expect(decode).not.toHaveBeenCalled();
            live.paused = false;
            await tick();
            expect(controller.state.kind).toBe("found");
        });

        it("a frame that fails to decode (throws) does not end the scan", async () => {
            await startScanning();
            decode.mockRejectedValueOnce(new Error("bad frame")).mockResolvedValueOnce(JANE_LINK);
            await tick(SCAN_MS * 2);
            expect(controller.state.kind).toBe("found");
        });

        it("never decodes two frames at the same time", async () => {
            await startScanning();
            let release: (v: string | null) => void = () => undefined;
            decode.mockImplementationOnce(() => new Promise<string | null>((r) => (release = r)));
            await tick(SCAN_MS * 5);
            expect(decode).toHaveBeenCalledTimes(1);
            release(null);
            await tick(SCAN_MS);
            expect(decode.mock.calls.length).toBeGreaterThan(1);
        });
    });

    describe("a code that is not a Clariva user", () => {
        it("shows 'invalid', pauses decoding and keeps the camera running", async () => {
            await startScanning();
            decode.mockResolvedValue("https://clarivahub.com.evil.net/u/%40jane%3Aclarivahub.com");
            await tick();
            expect(controller.state).toEqual({ kind: "invalid" });
            const calls = decode.mock.calls.length;
            await tick(SCAN_MS * 10);
            expect(decode).toHaveBeenCalledTimes(calls); // no hammering of the same bad code
            expect(controller.stream).toBe(streams[0]);
            expect(streams[0].tracks[0].stop).not.toHaveBeenCalled();
        });

        it("'Try again' resumes scanning without a new permission prompt", async () => {
            await startScanning();
            decode.mockResolvedValueOnce("hello").mockResolvedValueOnce(JANE_LINK);
            await tick();
            expect(controller.state.kind).toBe("invalid");

            controller.retry();
            expect(controller.state).toEqual({ kind: "scanning" });
            await tick();
            expect(controller.state).toEqual({ kind: "found", userId: JANE });
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        });

        it("start() while 'invalid' behaves like 'Try again' and never opens a second stream", async () => {
            await startScanning();
            decode.mockResolvedValueOnce("hello");
            await tick();
            await controller.start();
            expect(controller.state).toEqual({ kind: "scanning" });
            expect(getUserMedia).toHaveBeenCalledTimes(1);
        });

        it("retry() outside the 'invalid' state does nothing", async () => {
            await startScanning();
            controller.retry();
            expect(controller.state).toEqual({ kind: "scanning" });
        });
    });

    describe("releasing the camera", () => {
        it("stop() stops every track and goes back to idle; a later start() asks again", async () => {
            await startScanning();
            controller.stop();
            expect(controller.state).toEqual({ kind: "idle" });
            expect(allTracksStopped(streams[0])).toBe(true);
            await tick(SCAN_MS * 5);
            expect(decode).not.toHaveBeenCalled();

            await controller.start();
            expect(getUserMedia).toHaveBeenCalledTimes(2);
            expect(controller.state.kind).toBe("scanning");
        });

        it("dispose() stops the tracks and silences listeners", async () => {
            const listener = jest.fn();
            await startScanning();
            controller.subscribe(listener);
            controller.dispose();
            expect(allTracksStopped(streams[0])).toBe(true);
            decode.mockResolvedValue(JANE_LINK);
            await tick(SCAN_MS * 5);
            expect(listener).not.toHaveBeenCalled();
            expect(decode).not.toHaveBeenCalled();
        });

        it("closing the dialog while the permission prompt is open does not leave the camera on", async () => {
            let grant: (s: MediaStream) => void = () => undefined;
            getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => (grant = r)));
            const starting = controller.start();
            await tick(1);
            expect(controller.state.kind).toBe("requesting");

            controller.dispose(); // dialog closed
            const late = fakeStream();
            grant(late);
            await starting;
            expect(late.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
            expect(controller.stream).toBeNull();
        });

        it("a stale permission answer after stop() + start() does not clobber the new run", async () => {
            let grantFirst: (s: MediaStream) => void = () => undefined;
            getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => (grantFirst = r)));
            const first = controller.start();
            await tick(1);
            controller.stop();
            await controller.start(); // second request, resolves with streams[0]
            const second = controller.stream;
            const late = fakeStream();
            grantFirst(late);
            await first;
            expect(late.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
            expect(controller.stream).toBe(second);
            expect(controller.state.kind).toBe("scanning");
        });

        it("stopStream tolerates a broken stream", () => {
            expect(() =>
                stopStream({
                    getTracks: () => {
                        throw new Error("gone");
                    },
                } as unknown as MediaStream),
            ).not.toThrow();
        });
    });

    describe("scanning a picked image instead of the camera", () => {
        it("a valid code ends in 'found'", async () => {
            expect(await controller.scanImage(async () => JANE_LINK)).toBe(JANE);
            expect(controller.state).toEqual({ kind: "found", userId: JANE });
        });

        it("an unreadable or unrelated image ends in 'invalid' and 'Try again' reopens the camera", async () => {
            expect(await controller.scanImage(async () => null)).toBeNull();
            expect(controller.state).toEqual({ kind: "invalid" });
            expect(await controller.scanImage(async () => "hello")).toBeNull();
            expect(
                await controller.scanImage(async () => {
                    throw new Error("not an image");
                }),
            ).toBeNull();
            expect(controller.state).toEqual({ kind: "invalid" });

            controller.retry();
            await tick(1);
            expect(getUserMedia).toHaveBeenCalledTimes(1);
            expect(controller.state.kind).toBe("scanning");
        });

        it("releases a running camera first", async () => {
            await startScanning();
            await controller.scanImage(async () => JANE_LINK);
            expect(allTracksStopped(streams[0])).toBe(true);
        });
    });
});
