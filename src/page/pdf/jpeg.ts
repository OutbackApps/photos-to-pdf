/*
 * Reading a JPEG's header: its size, colours and EXIF orientation, and whether PDF readers can show it
 * as it is (then it goes in the PDF as its own bytes). No page state: tested on its own.
 */

/** What a JPEG is, for a PDF. */
export interface JpegInfo {
    width: number;
    height: number;
    /** EXIF orientation, 1 to 8 (1: as it's stored). */
    orientation: number;
    grey: boolean;
}

/** A JPEG's size, colours and orientation, if PDF readers can show it as it is (otherwise null). */
export async function jpegInfo(blob: Blob): Promise<JpegInfo | null> {
    // The frame header comes before the image data, after the EXIF and other metadata: usually in the
    // first few KB, but the whole file's read if it isn't in the first MB.
    const head = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
    const found = jpegHeader(head);
    if (found !== undefined || head.length >= blob.size) return found ?? null;
    return jpegHeader(new Uint8Array(await blob.arrayBuffer())) ?? null;
}

/** A JPEG's size, colours and orientation from its bytes: null if PDF readers can't show it as it is, undefined if the bytes ran out first. */
export function jpegHeader(b: Uint8Array): JpegInfo | null | undefined {
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let orientation = 1;
    let i = 2;
    while (i + 4 <= b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1] ?? 0;
        if (marker === 0xff) {
            i++; // padding
            continue;
        }
        const length = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
        if (marker === 0xe1) orientation = exifOrientation(b.subarray(i + 4, i + 2 + length)) || orientation;
        if (marker === 0xda || marker === 0xd9) return null; // image data, and no frame header before it
        if (isFrame(marker)) return frame(b, i, marker, orientation);
        i += 2 + length;
    }
    return undefined;
}

/** Start of frame markers (not DHT, JPG or DAC, which share the range). */
function isFrame(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/** The frame header at i: baseline, extended or progressive, 8 bits, grey or colour is what every PDF reader shows. */
function frame(b: Uint8Array, i: number, marker: number, orientation: number): JpegInfo | null | undefined {
    if (i + 10 > b.length) return undefined;
    const byte = (k: number) => b[i + k] ?? 0;
    const components = byte(9);
    const height = (byte(5) << 8) | byte(6);
    const width = (byte(7) << 8) | byte(8);
    const shown = marker <= 0xc2 && byte(4) === 8 && (components === 1 || components === 3) && width > 0 && height > 0;
    return shown ? { width, height, orientation, grey: components === 1 } : null;
}

/** The Orientation (1–8) in a JPEG's EXIF segment, or 0 if it hasn't one. */
function exifOrientation(segment: Uint8Array): number {
    if (String.fromCodePoint(...segment.subarray(0, 6)) !== 'Exif\0\0') return 0;
    const tiff = new DataView(segment.buffer, segment.byteOffset + 6, segment.byteLength - 6);
    try {
        const little = tiff.getUint16(0) === 0x4949; // "II": Intel byte order
        const ifd = tiff.getUint32(4, little);
        const count = tiff.getUint16(ifd, little);
        for (let k = 0; k < count; k++) {
            const entry = ifd + 2 + k * 12;
            if (tiff.getUint16(entry, little) === 0x0112) {
                const value = tiff.getUint16(entry + 8, little);
                return value >= 1 && value <= 8 ? value : 0;
            }
        }
    } catch {
        // Cut short or malformed: read as no rotation.
    }
    return 0;
}
