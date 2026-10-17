/*
 * The tiles' small copies of the photos, made as they scroll into view.
 */

import { app } from '../env';
import { type Photo, store } from '../store';
import { errText } from '../util';
import { photoBlob } from './load';

/** How big a tile's copy is (its short side, px): enough for a sharp tile on a high-resolution screen. */
const THUMB = 240;

const urls = new Map<string, string>(); // uuid -> a small copy's object URL ('' if this browser can't show the photo)
const making = new Map<string, Promise<string>>(); // uuid -> that URL, while it's made
const observer = 'IntersectionObserver' in globalThis ? new IntersectionObserver(onSeen, { rootMargin: '200px' }) : null;
let thumbing: Promise<unknown> = Promise.resolve(); // one at a time: decoding a photo takes a lot of memory for a moment

const tileOf = (p: Photo) => app.querySelector<HTMLElement>(`.ph[data-i="${store.photos.indexOf(p)}"]`);

/** A tile's photo: shown now if it's made, otherwise when the tile comes into view. */
export function thumb(el: HTMLElement, p: Photo): void {
    if (urls.has(p.uuid)) return showThumb(el, p);
    if (observer) observer.observe(el);
    else loadThumb(p);
}

function onSeen(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer?.unobserve(e.target);
        const p = store.photos[Number((e.target as HTMLElement).dataset.i)];
        if (p) loadThumb(p);
    }
}

/** A photo's small copy for its tile: '' if this browser can't show the photo (it's still in the PDFs). */
async function smallCopy(p: Photo): Promise<string> {
    const blob = await photoBlob(p);
    try {
        return await thumbnail(blob);
    } catch {
        return '';
    }
}

function loadThumb(p: Photo): void {
    let made = making.get(p.uuid);
    if (!made) {
        made = smallCopy(p);
        making.set(p.uuid, made);
    }
    made.then(
        (url) => {
            urls.set(p.uuid, url);
            making.delete(p.uuid);
            // The grid may have been redrawn while it loaded.
            const now = tileOf(p);
            if (now) showThumb(now, p);
        },
        (err) => {
            making.delete(p.uuid); // tried again when it's next seen, or saved
            const msg = tileOf(p)?.querySelector('.ph-msg');
            if (msg) msg.textContent = "Couldn't load";
            console.warn(`Photo ${p.name} couldn't load:`, errText(err)); // for whoever looks
        },
    );
}

function showThumb(el: HTMLElement, p: Photo): void {
    // A tile redrawn while its photo loaded is seen (and loaded) twice: show it once.
    if (el.querySelector('img')) return;
    const url = urls.get(p.uuid);
    const msg = el.querySelector('.ph-msg');
    // Photos this browser can't show (e.g. HEIC outside Safari) keep their name instead.
    if (!url) {
        if (msg) msg.textContent = p.name;
        return;
    }
    const img = new Image();
    img.alt = p.name;
    img.draggable = false;
    img.src = url;
    img.onload = () => el.querySelector('.ph-msg')?.remove();
    el.prepend(img);
}

/**
 * A small copy of a photo for its tile. Shown as it is, a 12-megapixel photo is decoded in full for a
 * ~104px square, and a job's worth of those can run a phone out of memory.
 */
function thumbnail(blob: Blob): Promise<string> {
    const made = thumbing.then(async () => {
        const url = URL.createObjectURL(blob);
        const canvas = document.createElement('canvas');
        try {
            const img = new Image();
            img.src = url;
            await img.decode(); // natural* include the EXIF rotation
            const scale = Math.min(1, THUMB / Math.min(img.naturalWidth, img.naturalHeight));
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            ctx.fillStyle = '#fff'; // transparent PNGs
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const small = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
            if (!small) throw new Error("Couldn't make a thumbnail");
            return URL.createObjectURL(small);
        } finally {
            URL.revokeObjectURL(url);
            // iOS keeps canvas memory until it's resized.
            canvas.width = 0;
            canvas.height = 0;
        }
    });
    thumbing = made.catch(() => { });
    return made;
}
