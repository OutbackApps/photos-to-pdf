/*
 * The PDFs: each a list of photo uuids, in page order. Every photo starts in one, split into PDFs of
 * perPdf photos; any not in a PDF are left out. Until photos are dragged about, leaving one out or
 * putting one back splits them again, so the PDFs stay full. After that, the PDFs are kept as
 * arranged, and one can have more than perPdf photos: it's shown as over the limit, but saved as it is.
 */

import { type Group, type Photo, PER_PDF_KEY, store } from './store';
import { remember } from './util';

/** These photos in PDFs of perPdf, in order. */
export function split(uuids: string[]): Group[] {
    const out: Group[] = [];
    for (let k = 0; k < uuids.length; k += store.perPdf) out.push(uuids.slice(k, k + store.perPdf));
    return out;
}

/**
 * A PDF given its own name in Detailed has it as the list's `name`. Lists made afresh (dragging,
 * splitting) take the name of the PDF that was in their place, so PDF 2 is still called what it was.
 */
export const regroup = (lists: Group[]): Group[] => lists.map((g, k) => Object.assign(g, { name: store.groups[k]?.name }));

/** Whether the PDFs are just the photos split evenly (nothing's been dragged about). */
export const even = (): boolean => store.groups.every((g, k) => (k < store.groups.length - 1 ? g.length === store.perPdf : g.length <= store.perPdf));

/** The photos in no PDF, in the photos' own order. */
export function leftOut(): Photo[] {
    const kept = new Set(store.groups.flat());
    return store.photos.filter((p) => !kept.has(p.uuid));
}

export const isOut = (uuid: string): boolean => !store.groups.some((g) => g.includes(uuid));

/** Out of its PDF, leaving a gap: nothing else moves ("Split into PDFs of…" closes gaps up). */
export function leaveOut(uuid: string): void {
    for (const g of store.groups) if (g.includes(uuid)) g.splice(g.indexOf(uuid), 1);
    store.groups = store.groups.filter((g) => g.length);
}

/** Back in, at the end: in the last PDF if it has room, otherwise in a new one. */
export function putBack(uuids: string[]): void {
    for (const uuid of uuids) {
        const last = store.groups.at(-1);
        if (last && last.length < store.perPdf) last.push(uuid);
        else store.groups.push([uuid]);
    }
}

/** A new number of photos per PDF. Nothing moves ("Split into PDFs of…" does that): it's the limit PDFs are checked against. */
export function setPerPdf(n: number): void {
    store.perPdf = n;
    remember(PER_PDF_KEY, String(n));
}
