/*
 * A photo's bytes, by the quickest way that works, five at a time: straight from the ServiceM8 API,
 * from where it's stored, or through the function. A way that doesn't work here isn't tried again.
 */

import { api, call } from '../api';
import { type Photo, store } from '../store';
import { latin1 } from '../util';

let directFiles = true; // until the API's file storage turns the browser away (only if store.direct)
let fromStorage = true; // until the photo storage turns the browser away

async function fetchPhoto(p: Photo): Promise<Blob> {
    return ((store.direct && directFiles && (await fromApi(p))) || (fromStorage && (await fromStorageLink(p))) || throughFunction(p));
}

/** Straight from ServiceM8's API, with the token. Null if it isn't to be had that way. */
async function fromApi(p: Photo): Promise<Blob | null> {
    try {
        const res = await api(`/attachment/${p.uuid}.file`);
        // Refused from here (e.g. where this photo is stored): another way may still get it.
        return res.ok ? await res.blob() : null;
    } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        directFiles = false; // the file storage doesn't allow it; not tried again
        return null;
    }
}

/**
 * Straight from where it's stored, with the link the function gets for it (no token: the storage
 * link carries its own permission). Much quicker than through the function. Null if not.
 */
async function fromStorageLink(p: Photo): Promise<Blob | null> {
    try {
        const { url } = await call('photos_to_pdf_photo_url', { uuid: p.uuid });
        if (!url) return null;
        const res = await fetch(url, { credentials: 'omit' });
        // Refused (e.g. the link expired): this one comes through the function.
        return res.ok ? await res.blob() : null;
    } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        fromStorage = false; // the storage doesn't let the browser (CORS): not tried again
        return null;
    }
}

/** Through the function, a piece at a time (its replies are capped at 6 MB), each after the one before. */
async function throughFunction(p: Photo): Promise<Blob> {
    const pieces: Uint8Array<ArrayBuffer>[] = [];
    async function piece(offset: number): Promise<string> {
        const got = await call('photos_to_pdf_photo', { uuid: p.uuid, offset });
        const bytes = latin1(atob(got.data));
        pieces.push(bytes);
        const next = offset + bytes.length;
        if (next >= got.size) return got.type;
        if (!bytes.length) throw new Error('The photo stopped part way through.');
        return piece(next);
    }
    const type = await piece(0);
    return new Blob(pieces, { type });
}

const blobs = new Map<string, Promise<Blob>>();
const waiting: (() => Promise<void>)[] = [];
let running = 0;

/** A photo's bytes: from this device, or fetched (once, five at a time: quicker than one by one, without swamping the connection). */
export function photoBlob(p: Photo): Promise<Blob> {
    if (p.file) return Promise.resolve(p.file);
    let got = blobs.get(p.uuid);
    if (!got) {
        got = new Promise<Blob>((resolve, reject) => waiting.push(() => fetchPhoto(p).then(resolve, reject)));
        blobs.set(p.uuid, got);
        got.catch(() => blobs.delete(p.uuid)); // tried again next time
        pump();
    }
    return got;
}

function pump(): void {
    while (running < 5 && waiting.length) {
        running++;
        const next = waiting.shift() as () => Promise<void>;
        void next().finally(() => {
            running--;
            pump();
        });
    }
}
