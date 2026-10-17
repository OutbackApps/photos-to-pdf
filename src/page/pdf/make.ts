/*
 * A PDF's pages, one photo each, made one at a time.
 */

import { photoBlob } from '../photos/load';
import type { Photo } from '../store';
import { forPdf, type Page, toJpeg } from './images';

/**
 * The pages for these photos, and the names of any that couldn't be read. Within `maxBytes` (through the
 * function: photos are shrunk to share it), or compressed a little (Infinity). `onProgress` after each.
 */
export async function photosPdf(list: Photo[], maxBytes: number, onProgress: (done: number) => void): Promise<{ pages: Page[]; failed: string[] }> {
    const shrink = maxBytes !== Infinity;
    const perPhoto = Math.min(1.2 * 1024 * 1024, maxBytes / 3);
    const pages: Page[] = [];
    const failed: string[] = [];
    // The PDF's own structure (well under 1 KB a page) counts towards maxBytes too.
    let used = 1024 * (list.length + 1);
    // One photo at a time, each starting when the one before is done: a shrunk one's budget depends on
    // what those used, and doing several at once can run a phone out of memory.
    async function addPage(i: number): Promise<void> {
        const p = list[i];
        if (!p) return;
        // Fetch the next couple while this one's done.
        for (const next of list.slice(i + 1, i + 3)) photoBlob(next).catch(() => { });
        try {
            const blob = await photoBlob(p);
            // What's left of the budget, shared by the photos still to go.
            const image = shrink ? await toJpeg(blob, Math.min(perPhoto, (maxBytes - used) / (list.length - i))) : await forPdf(blob);
            used += image.data instanceof Blob ? image.data.size : image.data.length;
            pages.push({ ...image, photo: p });
        } catch {
            // One unreadable photo shouldn't stop the PDF: it's left out and listed when saved.
            failed.push(p.name);
        }
        onProgress(i + 1);
        await addPage(i + 1);
    }
    await addPage(0);
    return { pages, failed };
}
