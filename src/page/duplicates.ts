/*
 * Duplicates: a photo exactly the same (byte for byte) as one before it in the job is tagged
 * "Duplicate". Nothing moves: it's only a tag, and it's left to the staff member.
 */

import { photoBlob } from './photos/load';
import { update } from './render';
import { type Photo, store } from './store';

/** Each photo's SHA-256 (as a string) -> the photos with it, so far. */
const seen = new Map<string, Photo[]>();

/**
 * Tags the photo, as soon as it's loaded, if it's a copy of another: of those that are the same, the
 * first in the job is the original and the rest are tagged. That doesn't wait for photos still loading:
 * whichever comes first, the later of two the same is a copy (an earlier one loading later only makes
 * the one that was first a copy too).
 */
export function checkDuplicate(p: Photo): void {
    if (!crypto.subtle) return; // not in this window (it isn't https): no tags
    photoBlob(p)
        .then(async (blob) => {
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            const hash = String.fromCodePoint(...new Uint8Array(digest));
            const same = seen.get(hash) ?? [];
            same.push(p);
            seen.set(hash, same);
            if (same.length < 2) return;
            const first = same.reduce((a, b) => (store.photos.indexOf(a) < store.photos.indexOf(b) ? a : b));
            for (const q of same) q.duplicate = q !== first;
            update();
        })
        .catch(() => { }); // couldn't be read: not checked (its tile says so)
}
