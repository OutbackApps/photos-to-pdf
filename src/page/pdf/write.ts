/*
 * Writing the PDF file: one photo per page, filling it, the page the photo's shape (its long edge the
 * length of A4), nothing else on the page or in the file. No page state: tested on its own.
 */

import { latin1 } from '../util';
import type { PdfImage } from './images';

const num = (n: number) => n.toFixed(2);
/** Pages are the photo's shape, with the long edge the length of A4 (in points). */
const LONG_EDGE = 842;

/**
 * Where each EXIF orientation puts the photo's pixels: a pixel x, y across and down the photo (0–1, from
 * its top left) is seen at X = ax·x + ay·y + a0, Y = bx·x + by·y + b0 on the page.
 */
const ORIENTATIONS: Record<number, readonly number[]> = {
    1: [1, 0, 0, 0, 1, 0],
    2: [-1, 0, 1, 0, 1, 0], // mirrored
    3: [-1, 0, 1, 0, -1, 1], // upside down
    4: [1, 0, 0, 0, -1, 1], // flipped
    5: [0, 1, 0, 1, 0, 0], // on its side, mirrored
    6: [0, -1, 1, 1, 0, 0], // turned a quarter clockwise to be seen
    7: [0, -1, 1, -1, 0, 1], // on its side, mirrored
    8: [0, 1, 0, -1, 0, 1], // turned a quarter anticlockwise to be seen
};

/** A page's [width, height] as it's seen: EXIF orientations 5–8 turn the photo on its side. */
const shape = (image: PdfImage): [number, number] => (image.orientation >= 5 ? [image.height, image.width] : [image.width, image.height]);

/** The matrix that draws a page's photo (PDF's unit square, y up) the right way round on a w × h page. */
function placement(orientation: number, w: number, h: number): number[] {
    const [ax = 1, ay = 0, a0 = 0, bx = 0, by = 1, b0 = 0] = ORIENTATIONS[orientation] ?? [];
    // The unit square's u, v is the photo's x = u, y = 1 - v; the page's y goes up.
    return [w * ax, -h * bx, -w * ay, h * by, w * (ay + a0), h * (1 - by - b0)];
}

/** The PDF: one photo per page, in order. Photos' own files (Blobs) go in as they are, never copied into memory. */
export function writePdf(pages: PdfImage[]): Blob {
    const parts: (Uint8Array<ArrayBuffer> | Blob)[] = [];
    const offsets: number[] = [];
    let length = 0;
    const put = (d: string | Uint8Array<ArrayBuffer> | Blob) => {
        const part = typeof d === 'string' ? latin1(d) : d;
        parts.push(part);
        length += part instanceof Blob ? part.size : part.length;
    };
    const obj = (id: number, dict: string, stream?: Uint8Array<ArrayBuffer> | Blob) => {
        offsets[id] = length;
        put(`${id} 0 obj\n${dict}\n`);
        if (stream) {
            put('stream\n');
            put(stream);
            put('\nendstream\n');
        }
        put('endobj\n');
    };

    // Objects: 1 catalog, 2 page tree, then page/contents/image for each photo.
    const pageId = (i: number) => 3 + i * 3;
    const size = pageId(pages.length);

    put('%PDF-1.4\n');
    put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = pages.map((_, i) => pageId(i) + ' 0 R').join(' ');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

    pages.forEach((image, i) => {
        const id = pageId(i);
        const [w, h] = shape(image);
        const scale = LONG_EDGE / Math.max(w, h);
        const content = latin1(`q ${placement(image.orientation, w * scale, h * scale).map(num).join(' ')} cm /Im Do Q`);
        obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w * scale)} ${num(h * scale)}] /Resources << /XObject << /Im ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
        obj(id + 1, `<< /Length ${content.length} >>`, content);
        const bytes = image.data instanceof Blob ? image.data.size : image.data.length;
        const colours = image.grey ? '/DeviceGray' : '/DeviceRGB';
        obj(id + 2, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colours} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes} >>`, image.data);
    });

    const xref = length;
    put(`xref\n0 ${size}\n0000000000 65535 f \n`);
    put(offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
    put(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
}
