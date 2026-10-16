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

import { type QrDecoder } from "./scanner";

/**
 * QR decoders for the scanner: the browser's native `BarcodeDetector` where it supports QR codes (Chrome on Android,
 * Safari, Edge on macOS...), otherwise `jsQR` (pure JS, already in node_modules, loaded lazily so it only costs
 * anything when the scanner is opened). Neither needs network access; frames never leave the browser.
 */

/** Minimal typing of the Shape Detection API (not in lib.dom for this TypeScript version). */
interface BarcodeDetectorLike {
    detect(source: unknown): Promise<Array<{ rawValue?: string }>>;
}
interface BarcodeDetectorCtor {
    new (options?: { formats?: string[] }): BarcodeDetectorLike;
    getSupportedFormats?(): Promise<string[]>;
}

/** Longest side of the frame handed to jsQR. Bigger frames only make it slower; QR codes are decoded fine at this. */
const JSQR_MAX_SIDE = 800;
/** Longest side when decoding a picked image file. */
const IMAGE_MAX_SIDE = 1600;

async function createBarcodeDetectorDecoder(): Promise<QrDecoder | null> {
    const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (typeof Ctor !== "function") return null;
    try {
        const formats = await Ctor.getSupportedFormats?.();
        if (formats && !formats.includes("qr_code")) return null;
        const detector = new Ctor({ formats: ["qr_code"] });
        return {
            async decode(source: unknown): Promise<string | null> {
                const codes = await detector.detect(source);
                return codes.find((c) => typeof c.rawValue === "string" && c.rawValue.length > 0)?.rawValue ?? null;
            },
        };
    } catch {
        return null; // constructor may throw when the platform lacks a QR backend
    }
}

type JsQr = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: string },
) => {
    data: string;
} | null;

async function loadJsQr(): Promise<JsQr | null> {
    try {
        const mod: unknown = await import("jsqr");
        const fn = typeof mod === "function" ? mod : (mod as { default?: unknown }).default;
        return typeof fn === "function" ? (fn as JsQr) : null;
    } catch {
        return null;
    }
}

interface DrawableSize {
    width: number;
    height: number;
}

/** Size of a video element / image bitmap / canvas, or null when it has no frame yet. */
function sourceSize(source: unknown): DrawableSize | null {
    const s = source as Partial<{ videoWidth: number; videoHeight: number; width: number; height: number }>;
    const width = s.videoWidth ?? s.width ?? 0;
    const height = s.videoHeight ?? s.height ?? 0;
    return width > 0 && height > 0 ? { width, height } : null;
}

function createJsQrDecoder(jsQR: JsQr, maxSide: number): QrDecoder {
    let canvas: HTMLCanvasElement | undefined;
    return {
        async decode(source: unknown): Promise<string | null> {
            const size = sourceSize(source);
            if (!size) return null;
            const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
            const width = Math.max(1, Math.round(size.width * scale));
            const height = Math.max(1, Math.round(size.height * scale));
            canvas ??= document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) return null;
            ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
            const image = ctx.getImageData(0, 0, width, height);
            // attemptBoth also reads inverted codes (light modules on dark), as shown by some dark-mode screens
            const code = jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" });
            return code?.data ? code.data : null;
        },
    };
}

/**
 * The best decoder this browser offers, or null when there is none (the scanner then reports "unavailable").
 * `maxSide` caps the working resolution for the jsQR fallback.
 */
export async function createQrDecoder(maxSide: number = JSQR_MAX_SIDE): Promise<QrDecoder | null> {
    const native = await createBarcodeDetectorDecoder();
    if (native) return native;
    const jsQR = await loadJsQr();
    return jsQR ? createJsQrDecoder(jsQR, maxSide) : null;
}

/** Decode a QR code from an image file the user picked. Rejects when the file is not a readable image. */
export async function decodeQrFromImageFile(file: Blob): Promise<string | null> {
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(file);
    try {
        const native = await createBarcodeDetectorDecoder();
        if (native) {
            const text = await native.decode(bitmap);
            if (text) return text;
        }
        const jsQR = await loadJsQr();
        return jsQR ? await createJsQrDecoder(jsQR, IMAGE_MAX_SIDE).decode(bitmap) : null;
    } finally {
        bitmap.close?.();
    }
}
