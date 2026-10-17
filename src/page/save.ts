/*
 * Saving: each PDF made and added to the job diary in turn (so only one is ever held in memory), after
 * any photos from this device. A PDF too big for ServiceM8 is saved in parts; a save that stops part way
 * carries on from where it got to.
 */

import { nameOf } from './names/names';
import { DIARY_STEPS, type Page, STEPS, toJpeg } from './pdf/images';
import { photosPdf } from './pdf/make';
import { writePdf } from './pdf/write';
import { finishDiary } from './photos/device';
import { photoBlob } from './photos/load';
import { hidePeek } from './peek';
import { render, update } from './render';
import { byUuid, type Photo, type SavedPdf, store } from './store';
import { Refused, RELAY_MAX, uploadAttachment } from './upload';
import { errText, recall, remember } from './util';

/**
 * PDFs saved by a save that then failed (photo uuids -> what was saved): saving again skips them, and
 * carries on from the next part of one saved in parts part way.
 */
const savedBefore = new Map<string, SavedPdf>();

/** Makes and saves each PDF in turn. */
export async function save(): Promise<void> {
    store.error = null;
    hidePeek();
    const list = store.groups.map((g) => g.map(byUuid));
    const names = list.map((_, k) => nameOf(k, list.length));
    // Straight to ServiceM8, photos go in as they're made for PDFs. Through the function, each PDF has to fit its payload limit.
    const maxBytes = store.direct ? Infinity : RELAY_MAX;
    const pdfs: SavedPdf[] = [];
    const failed: string[] = [];
    let gi = 0;
    // One PDF at a time, each starting when the one before is saved.
    async function next(): Promise<void> {
        const photosIn = list[gi];
        if (!photosIn) return;
        const before = savedBefore.get(photosIn.map((p) => p.uuid).join());
        const saved = before?.complete ? before : await savePdf(photosIn, gi, list.length, names[gi] ?? '', maxBytes, before);
        failed.push(...saved.failed);
        if (saved.pages.length) pdfs.push(saved); // otherwise none of its photos could be read
        gi++;
        await next();
    }
    try {
        // Photos added from this device go in the job diary before the PDFs do.
        store.step = { step: 'diary' };
        update();
        const notInDiary = await finishDiary();
        await next();
        if (!pdfs.length) throw new Error('None of the photos could be read on this device.');
        savedBefore.clear();
        store.step = { step: 'saved', pdfs, failed, notInDiary, shrunk: !store.direct };
        render();
    } catch (err) {
        const which = list.length > 1 && gi < list.length ? `PDF ${gi + 1} of ${list.length} wasn't saved. ` : '';
        const done = pdfs.length === 1 ? 'the one' : `the ${pdfs.length}`;
        const kept = pdfs.length ? ` Saving again skips ${done} already saved.` : '';
        store.error = which + errText(err) + kept;
        store.step = { step: 'pick' };
        update();
    }
}

/** Makes PDF number `gi` of `of` from these photos, called `name`, and adds it to the job diary (in parts, if it's too big for ServiceM8 in one). */
async function savePdf(photosIn: Photo[], gi: number, of: number, name: string, maxBytes: number, partWay?: SavedPdf): Promise<SavedPdf> {
    const saved = partWay ?? { names: [], done: 0, pages: [], failed: [], shrunk: [], complete: false };
    savedBefore.set(photosIn.map((p) => p.uuid).join(), saved);
    const progress = (done: number) => {
        store.step = { step: 'making', pdf: gi, of, n: photosIn.length, done };
        update();
    };
    progress(0);
    const pdf = await photosPdf(photosIn, maxBytes, progress);
    Object.assign(saved, { pages: pdf.pages, failed: pdf.failed });
    if (pdf.pages.length) {
        store.step = { step: 'saving', pdf: gi, of };
        update();
        // Pages already saved (in parts, by a save that then failed) aren't saved again.
        await uploadInParts(pdf.pages.slice(saved.done), name, saved);
    }
    saved.complete = true;
    return saved;
}

/**
 * ServiceM8 turns away files over a size it doesn't say (413). When it does, that size is noted (and
 * remembered on this device), and PDFs are split into parts under it from then on: the photos stay as
 * they are, in the same order.
 */
const PDF_LIMIT_KEY = 'photos-to-pdf:pdf-limit';
let pdfLimit = Number(recall(PDF_LIMIT_KEY)) || Infinity;

function learnLimit(bytes: number): void {
    pdfLimit = Math.min(pdfLimit, Math.floor(bytes * 0.9));
    remember(PDF_LIMIT_KEY, String(pdfLimit));
}

/** A page's share of a PDF's size: its photo, and a little for the PDF's own structure. */
const pageBytes = (page: Page) => (page.data instanceof Blob ? page.data.size : page.data.length) + 1024;

/** Pages in order, in parts each under the limit (a page too big on its own is a part by itself). */
function bySize(pages: Page[]): Page[][] {
    const parts: Page[][] = [];
    let size = 0;
    for (const page of pages) {
        if (!parts.length || size + pageBytes(page) > pdfLimit) {
            parts.push([]);
            size = 1024;
        }
        parts.at(-1)?.push(page);
        size += pageBytes(page);
    }
    return parts;
}

/** Uploads the pages as one PDF, or as parts ("… part 2.pdf") if ServiceM8 needs them smaller. */
async function uploadInParts(pages: Page[], name: string, saved: SavedPdf): Promise<void> {
    let rest = pages;
    async function next(): Promise<void> {
        if (!rest.length) return;
        const parts = bySize(rest);
        const these = parts[0] ?? [];
        const inParts = parts.length > 1 || saved.names.length > 0;
        const blob = writePdf(these);
        try {
            saved.names.push(await uploadAttachment(inParts ? `${name} part ${saved.names.length + 1}.pdf` : `${name}.pdf`, blob, 'pdf'));
        } catch (err) {
            if (!(err instanceof Refused && err.tooBig)) throw err;
            learnLimit(blob.size);
            if (pdfLimit < 256 * 1024) throw new Error("ServiceM8 won't take a PDF that small. Please try again later.");
            // One photo too big for ServiceM8 by itself: only it is made smaller, just enough.
            const [only] = these;
            if (these.length === 1 && only) await shrinkPage(only, saved);
            return next(); // the same pages again, split to the new limit
        }
        saved.done += these.length;
        rest = rest.slice(these.length);
        return next();
    }
    await next();
}

/** A page's photo made smaller, just enough for ServiceM8: full size first, then a little smaller each time. */
async function shrinkPage(page: Page, saved: SavedPdf): Promise<void> {
    const steps = [[Infinity, 0.9], [Infinity, 0.8], ...DIARY_STEPS, ...STEPS] as const;
    const small = await toJpeg(await photoBlob(page.photo), Math.floor(pdfLimit * 0.9), steps);
    Object.assign(page, small);
    if (!saved.shrunk.includes(page.photo.name)) saved.shrunk.push(page.photo.name);
}
