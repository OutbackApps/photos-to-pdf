/*
 * Photos as JPEGs for PDF pages: compressed a little, or as they are when they're small JPEGs already;
 * smaller still when they must fit what the function can carry.
 */

import type { Photo } from '../store';
import { type JpegInfo, jpegInfo } from './jpeg';

/** A photo ready for a page: JPEG bytes (or a small JPEG's own file), its size, colours and orientation. */
export interface PdfImage extends JpegInfo {
    data: Blob | Uint8Array<ArrayBuffer>;
}

/** A page of a PDF: its photo's image, and which photo it is. */
export interface Page extends PdfImage {
    photo: Photo;
}

/** A long edge (px) and JPEG quality to try. */
type Step = readonly [edge: number, quality: number];

/**
 * Through the function, a PDF has to fit its payload limit: photos are then shrunk to fit, trying these
 * long edges and JPEG qualities, best first, until each fits its share.
 */
export const STEPS: readonly Step[] = [
    [1600, 0.8],
    [1600, 0.65],
    [1400, 0.6],
    [1200, 0.55],
    [1000, 0.5],
    [800, 0.45],
    [640, 0.4],
    [480, 0.35],
];

/** For a device photo's diary copy, when it has to be shrunk to go through the function. */
export const DIARY_STEPS: readonly Step[] = [
    [4032, 0.85],
    [3264, 0.82],
    [2560, 0.8],
    [2048, 0.75],
    [1600, 0.7],
];

/**
 * Photos go in a PDF at up to this long edge (px) and JPEG quality: about 280 dpi across an A4 page, so
 * details can still be zoomed into, at a fraction of a phone photo's size.
 */
const PDF_PHOTO: readonly Step[] = [[2400, 0.8]];
/** A JPEG this small (and no bigger than PDF_PHOTO's edge) goes in as it is: compressing it again would only lose detail. */
const SMALL_JPEG = 800 * 1024;
/** The most pixels a canvas can have on iPhones: anything bigger is scaled down just enough to fit. */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

/** The photo as a JPEG, at the first of `steps` that fits `budget` bytes (or the last); turned the right way up. */
export async function toJpeg(blob: Blob, budget: number, steps: readonly Step[] = STEPS): Promise<PdfImage & { data: Uint8Array<ArrayBuffer> }> {
    const url = URL.createObjectURL(blob);
    const canvas = document.createElement('canvas');
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        // natural* already account for the photo's EXIF rotation.
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) throw new Error('Empty image');
        let out: (PdfImage & { data: Uint8Array<ArrayBuffer> }) | null = null;
        for (const [edge, quality] of steps) {
            const scale = Math.min(1, edge / Math.max(w, h), Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            ctx.fillStyle = '#fff'; // transparent PNGs
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
            if (!jpeg) throw new Error("Couldn't convert the photo");
            out = { data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height, orientation: 1, grey: false };
            if (out.data.length <= budget) break;
        }
        if (!out) throw new Error("Couldn't convert the photo");
        return out;
    } finally {
        URL.revokeObjectURL(url);
        // iOS keeps canvas memory until it's resized.
        canvas.width = 0;
        canvas.height = 0;
    }
}

/**
 * A photo for a PDF page: compressed a little (PDF_PHOTO), unless it's a JPEG that's small already,
 * which goes in as it is, its own bytes (the PDF turns it the way its EXIF says).
 */
export async function forPdf(blob: Blob): Promise<PdfImage> {
    const jpeg = await jpegInfo(blob);
    const [edge] = PDF_PHOTO[0] as Step;
    if (jpeg && blob.size <= SMALL_JPEG && Math.max(jpeg.width, jpeg.height) <= edge) return { data: blob, ...jpeg };
    return toJpeg(blob, Infinity, PDF_PHOTO);
}
