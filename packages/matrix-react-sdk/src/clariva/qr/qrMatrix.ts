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

import { create as createQr } from "qrcode";

/**
 * QR generation for "My QR code" (spec 04 §2.10.1): error-correction level L, quiet zone 4 modules, black modules on a
 * white background (Android: ZXing `QRCodeWriter` defaults). The encoder is the `qrcode` package that Element already
 * ships; we only render its module matrix ourselves so that the output is identical in browsers and in jest and can be
 * verified by decoding it again in tests.
 */

export const QR_QUIET_ZONE_MODULES = 4;

export interface QrMatrix {
    /** Modules per side, WITHOUT the quiet zone. */
    size: number;
    /** `isDark(x, y)` for 0 <= x,y < size. */
    isDark(x: number, y: number): boolean;
}

/** Encode `data` (UTF-8, byte mode) at error-correction level L. Throws when it does not fit in a QR code. */
export function encodeQr(data: string): QrMatrix {
    const qr = createQr(data, { errorCorrectionLevel: "L" });
    const { size, data: bits } = qr.modules;
    return { size, isDark: (x, y) => bits[y * size + x] === 1 };
}

/**
 * Render as a standalone SVG string (black on white including the quiet zone), crisp at any CSS size. One `<path>`
 * with a horizontal run per dark stretch keeps it small.
 */
export function renderQrSvg(matrix: QrMatrix, quietZone: number = QR_QUIET_ZONE_MODULES): string {
    const total = matrix.size + quietZone * 2;
    let path = "";
    for (let y = 0; y < matrix.size; y++) {
        let x = 0;
        while (x < matrix.size) {
            if (!matrix.isDark(x, y)) {
                x++;
                continue;
            }
            const start = x;
            while (x < matrix.size && matrix.isDark(x, y)) x++;
            path += `M${start + quietZone} ${y + quietZone}h${x - start}v1h-${x - start}z`;
        }
    }
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
        `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
        `<path d="${path}" fill="#000000"/>` +
        `</svg>`
    );
}

/** `data:` URI of {@link renderQrSvg}, suitable for an `<img src>`. */
export function qrSvgDataUri(data: string): string {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(renderQrSvg(encodeQr(data)));
}

/**
 * Rasterise a matrix to RGBA pixels (test helper / fallback): `scale` px per module, quiet zone included.
 */
export function rasterizeQr(
    matrix: QrMatrix,
    scale: number,
    quietZone: number = QR_QUIET_ZONE_MODULES,
): { data: Uint8ClampedArray; width: number; height: number } {
    const width = (matrix.size + quietZone * 2) * scale;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let y = 0; y < matrix.size; y++) {
        for (let x = 0; x < matrix.size; x++) {
            if (!matrix.isDark(x, y)) continue;
            for (let dy = 0; dy < scale; dy++) {
                for (let dx = 0; dx < scale; dx++) {
                    const px = (x + quietZone) * scale + dx;
                    const py = (y + quietZone) * scale + dy;
                    const i = (py * width + px) * 4;
                    data[i] = data[i + 1] = data[i + 2] = 0;
                }
            }
        }
    }
    return { data, width, height: width };
}
