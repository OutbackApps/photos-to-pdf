/*
 * "Enlarge on hover", with a mouse: point at a photo for a moment to see it bigger beside its tile.
 * Off until it's turned on, then remembered on this device.
 */

import { photoBlob } from './photos/load';
import { store } from './store';
import { recall, remember } from './util';

const ENLARGE_KEY = 'photos-to-pdf:enlarge';
/** How long to point at a photo before it's shown bigger (ms), and the most it's shown at (px). */
const PEEK_WAIT = 400;
const PEEK_MAX = 420;

/** Only with a mouse (it needs pointing at). */
export const canEnlarge = matchMedia('(hover: hover) and (pointer: fine)').matches;
let enlargeOn = recall(ENLARGE_KEY) === '1';
export const enlarged = (): boolean => enlargeOn;

const box = document.createElement('div');
box.className = 'peek';
box.hidden = true;
document.body.append(box);
let peeking: unknown = null; // the photo pointed at (shown bigger once the wait's over)
let peekUrl: string | null = null; // its full size object URL, once it's shown
let peekTimer: ReturnType<typeof setTimeout> | undefined;
// Scrolling moves the tiles out from under it.
addEventListener('scroll', () => hidePeek(), { passive: true });

export function setEnlarge(on: boolean): void {
    enlargeOn = on;
    if (!on) hidePeek();
    remember(ENLARGE_KEY, on ? '1' : '0');
}

/**
 * Points at the photo on tile `el`: after a moment it's shown bigger beside its tile. Each photo waits
 * its moment, so moving along the photos doesn't flash each one up.
 */
export function peek(el: HTMLElement): void {
    const p = store.photos[Number(el.dataset.i)];
    if (!enlargeOn || !p || peeking === p) return;
    hidePeek();
    peeking = p;
    peekTimer = setTimeout(() => showPeek(el, p), PEEK_WAIT);
}

/** Beside its tile, on the side with more room: its small copy straight away, then the photo itself. */
function showPeek(el: HTMLElement, p: (typeof store.photos)[number]): void {
    const small = el.querySelector('img');
    if (peeking !== p || !el.isConnected || !small?.naturalWidth) return; // still loading, or this browser can't show it
    const r = el.getBoundingClientRect();
    const gap = 8;
    const edge = 12;
    const roomRight = innerWidth - r.right - gap - edge;
    const roomLeft = r.left - gap - edge;
    const right = roomRight >= roomLeft;
    const fit = Math.min(Math.min(PEEK_MAX, Math.max(roomRight, roomLeft)) / small.naturalWidth, Math.min(PEEK_MAX, innerHeight - 2 * edge) / small.naturalHeight);
    const w = Math.round(small.naturalWidth * fit);
    const h = Math.round(small.naturalHeight * fit);
    const top = Math.min(Math.max(r.top + r.height / 2 - h / 2, edge), innerHeight - edge - h);
    const img = new Image();
    img.alt = p.name;
    img.width = w;
    img.height = h;
    img.src = small.src;
    Object.assign(box.style, { left: `${right ? r.right + gap : r.left - gap - w}px`, top: `${top}px` });
    box.replaceChildren(img);
    box.hidden = false;
    photoBlob(p).then(
        async (blob) => {
            if (!img.isConnected) return; // moved off it, or onto another
            const url = URL.createObjectURL(blob);
            const full = new Image();
            full.src = url;
            try {
                await full.decode();
            } catch {
                // Leaves the small copy showing.
            }
            if (!img.isConnected || !full.naturalWidth) return URL.revokeObjectURL(url);
            peekUrl = url;
            img.src = url;
        },
        () => { }, // the small copy stays
    );
}

export function hidePeek(): void {
    clearTimeout(peekTimer);
    peeking = null;
    box.hidden = true;
    box.replaceChildren();
    if (peekUrl) URL.revokeObjectURL(peekUrl);
    peekUrl = null;
}
