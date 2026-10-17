/*
 * Arranging the photos. Click a photo to select it: Ctrl-click for one more (or one fewer), Shift-click
 * for all those from the last one clicked, or drag a box around them from a space between photos. On
 * touch screens, a tap selects or unselects. Drag a selected photo to move all those selected, in their
 * order (any other photo moves on its own) to where they should go: a new spot in its PDF, another PDF,
 * "New PDF" or "Left out"; the others move out of the way. With a mouse, dragging is enough; on touch
 * screens, press and hold first (moving straight away scrolls). Double-click (or double-tap) a photo to
 * leave it out, or put it back, on its own.
 */

import { app } from './env';
import { isOut, regroup, split } from './groups';
import { hidePeek, peek } from './peek';
import { drawGroups, renumber, setOut, shownOrder, update } from './render';
import { busy, type Group, store } from './store';
import { targetOf } from './util';

/** How far to scroll while the pointer is held within `margin` px of the top or bottom (above the footer). */
function edgeStep(y: number, margin: number, speed: number): number {
    const bottomEdge = innerHeight - (app.querySelector<HTMLElement>('.foot')?.offsetHeight ?? 0);
    if (y > bottomEdge - margin) return speed;
    if (y < margin) return -speed;
    return 0;
}

/** A photo being dragged (lifted once it's moved, or held on a touch screen). */
interface Drag {
    li: HTMLElement;
    id: number;
    mouse: boolean;
    /** Where it was pressed, and where the pointer is now. */
    x: number;
    y: number;
    cx: number;
    cy: number;
    lifted: boolean;
    timer?: ReturnType<typeof setTimeout>;
    /** Lifted: the photos going with it, the copy under the pointer, where it was held, and an empty section it's over. */
    members: HTMLElement[];
    ghost?: HTMLElement;
    offX: number;
    offY: number;
    target: HTMLElement | null;
}

/** A box being dragged out (with a mouse), to select the photos it touches. */
interface Box {
    id: number;
    /** Where it started, on the page (so it stretches as the page scrolls), and the pointer now. */
    x: number;
    y: number;
    cx: number;
    cy: number;
    /** Ctrl or Shift: added to what was selected. */
    add: boolean;
    before: Set<string>;
    el: HTMLElement | null;
}

const uuidsIn = (ul: Element): Group => Array.from(ul.children, (li) => (li as HTMLElement).dataset.u ?? '');

/** The PDFs (and Left out) in `wrap`, as drawn: selecting, dragging and the box. */
export function arrangeable(wrap: HTMLElement): void {
    let drag: Drag | null = null;
    let box: Box | null = null;
    let dragged = false; // the click that ends a drag isn't a tap
    let pointer = 'mouse'; // what pressed last: a tap on a touch screen adds to the selection
    let lastClick: { uuid: string; at: number; before: Set<string> } | null = null; // a second click on it soon after is a double-click
    const { selected } = store;
    renumber(wrap);

    wrap.addEventListener('click', (e) => {
        const ph = targetOf(e).closest<HTMLElement>('.ph');
        const uuid = ph?.parentElement?.dataset.u;
        if (!uuid || dragged || busy()) return;
        const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
        // Both clicks of a double-click (or tap) select: the selection goes back to what it was before
        // them, without this photo, and the photo's left out or put back on its own.
        if (plain && lastClick?.uuid === uuid && Date.now() - lastClick.at < 400) {
            selected.clear();
            for (const u of lastClick.before) if (u !== uuid) selected.add(u);
            lastClick = null;
            return setOut([uuid], !isOut(uuid));
        }
        lastClick = plain ? { uuid, at: Date.now(), before: new Set(selected) } : null;
        select(uuid, e);
    });

    function select(uuid: string, e: MouseEvent): void {
        const more = e.ctrlKey || e.metaKey;
        const order = shownOrder();
        if (e.shiftKey && store.anchor && order.includes(store.anchor)) {
            const [a = 0, b = 0] = [order.indexOf(store.anchor), order.indexOf(uuid)].sort((x, y) => x - y);
            if (!more) selected.clear();
            for (const u of order.slice(a, b + 1)) selected.add(u);
        } else if (more || pointer !== 'mouse') {
            if (selected.has(uuid)) selected.delete(uuid);
            else selected.add(uuid);
            store.anchor = uuid;
        } else {
            // Just this one; clicked again on its own, nothing.
            const only = selected.size === 1 && selected.has(uuid);
            selected.clear();
            if (!only) selected.add(uuid);
            store.anchor = uuid;
        }
        update();
    }

    wrap.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menus
    // "Enlarge on hover": until the pointer leaves the photo, or it's pressed (to move it).
    wrap.addEventListener('pointerover', (e) => {
        const ph = targetOf(e).closest<HTMLElement>('.ph');
        if (ph && e.pointerType === 'mouse' && !drag && !busy()) peek(ph);
    });
    wrap.addEventListener('pointerout', (e) => {
        const ph = targetOf(e).closest('.ph');
        if (ph && !ph.contains(e.relatedTarget as Node | null)) hidePeek();
    });
    // Once a photo's lifted, a finger moving mustn't scroll the page.
    wrap.addEventListener(
        'touchmove',
        (e) => {
            if (drag?.lifted) e.preventDefault();
        },
        { passive: false },
    );

    wrap.addEventListener('pointerdown', (e) => {
        // One at a time: a second finger mustn't strand the first one's ghost.
        // A name box (or its Reset) isn't a drag, or a box to select photos.
        if (e.button > 0 || drag || box || busy() || targetOf(e).closest('input, button:not(.ph)')) return;
        pointer = e.pointerType;
        const li = targetOf(e).closest<HTMLElement>('li');
        if (!li) {
            lastClick = null; // pressed between photos: the next click isn't a double-click
            if (e.pointerType === 'mouse') startBox(e);
            return;
        }
        hidePeek();
        dragged = false;
        drag = { li, id: e.pointerId, mouse: e.pointerType === 'mouse', x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, lifted: false, members: [], offX: 0, offY: 0, target: null };
        if (!drag.mouse) drag.timer = setTimeout(lift, 300);
    });
    wrap.addEventListener('pointermove', (e) => {
        if (box && e.pointerId === box.id) return moveBox(e);
        if (drag?.id !== e.pointerId) return;
        drag.cx = e.clientX;
        drag.cy = e.clientY;
        if (!drag.lifted) {
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
            if (!drag.mouse) return drop(); // a finger moving straight away is scrolling
            lift(); // with a mouse, dragging is enough
        }
        follow();
    });
    const end = (e: PointerEvent) => {
        if (box?.id === e.pointerId) endBox();
        if (drag?.id === e.pointerId) drop();
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);

    function lift(): void {
        if (!drag || drag.lifted) return;
        const d = drag;
        d.lifted = true;
        // Captured only once it's lifted: a tap must stay a click on its photo.
        try {
            wrap.setPointerCapture(d.id);
        } catch {
            // Without capture the drag just ends if the pointer leaves the photos.
        }
        // Sections can grow while a photo's dragged about, but not shrink until it's dropped (the redraw
        // then), so a photo leaving one doesn't pull everything below up under the pointer.
        for (const ul of wrap.querySelectorAll<HTMLElement>('.ogrid')) ul.style.minHeight = `${ul.offsetHeight}px`;
        // A selected photo takes the others selected with it; any other goes on its own.
        const all = Array.from(wrap.querySelectorAll<HTMLElement>('.ogrid > li'));
        d.members = selected.has(d.li.dataset.u ?? '') ? all.filter((li) => selected.has(li.dataset.u ?? '')) : [d.li];
        const r = d.li.getBoundingClientRect();
        d.offX = d.cx - r.left;
        d.offY = d.cy - r.top;
        const ghost = d.li.cloneNode(true) as HTMLElement;
        ghost.className = 'ghost';
        Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px` });
        if (d.members.length > 1) {
            ghost.classList.add('stack');
            const count = document.createElement('span');
            count.className = 'ghost-count';
            count.textContent = String(d.members.length);
            ghost.append(count);
        }
        document.body.appendChild(ghost);
        d.ghost = ghost;
        // The others are carried along (out of the lists) until it's dropped.
        for (const li of d.members) if (li !== d.li) li.remove();
        renumber(wrap);
        d.li.classList.add('placeholder');
        document.body.classList.add('reordering');
        navigator.vibrate?.(10);
        follow();
        edgeScroll();
    }

    /** Ghost under the pointer; the photo's spot moves to wherever it's over. */
    function follow(): void {
        if (!drag?.ghost) return;
        drag.ghost.style.left = `${drag.cx - drag.offX}px`;
        drag.ghost.style.top = `${drag.cy - drag.offY}px`;
        const over = document.elementFromPoint(drag.cx, drag.cy);
        const ul = over?.closest<HTMLElement>('.ogrid');
        target(null);
        if (!ul || !wrap.contains(ul)) return;
        // An empty section ("New PDF") lights up instead of taking the photo's spot: growing, it would
        // push everything below it down while the photo's only passing over.
        if (!ul.children.length) return target(ul);
        if (moveTo(ul, over?.closest<HTMLElement>('li') ?? null)) renumber(wrap);
    }

    /** The empty section the photo goes into if it's dropped now (null: wherever its spot is). */
    function target(ul: HTMLElement | null): void {
        if (drag) drag.target = ul;
        for (const g of wrap.querySelectorAll('.group.target')) g.classList.remove('target');
        ul?.parentElement?.classList.add('target');
    }

    /** Moves the dragged photo onto `onto`'s spot in `ul`, or past the last photo. False if it didn't move. */
    function moveTo(ul: HTMLElement, onto: HTMLElement | null): boolean {
        if (!drag || onto === drag.li) return false;
        if (onto) {
            const list = Array.from(ul.children);
            const later = list.includes(drag.li) && list.indexOf(drag.li) < list.indexOf(onto);
            ul.insertBefore(drag.li, later ? onto.nextSibling : onto);
            return true;
        }
        // Between photos isn't a spot (it'd jump about); after the last one, or an empty list, is.
        const last = ul.lastElementChild;
        if (last === drag.li) return false;
        if (last) {
            const r = last.getBoundingClientRect();
            if (!(drag.cy > r.bottom || (drag.cy >= r.top && drag.cx > r.right))) return false;
        }
        ul.appendChild(drag.li);
        return true;
    }

    // Holding near the top or bottom scrolls, for long lists.
    function edgeScroll(): void {
        if (!drag?.lifted) return;
        const step = edgeStep(drag.cy, 40, 12);
        if (step) {
            const before = scrollY;
            scrollBy(0, step);
            if (scrollY !== before) follow();
        }
        requestAnimationFrame(edgeScroll);
    }

    /** A box dragged out from a space between photos (with a mouse) selects those it touches; a click there clears the selection. */
    function startBox(e: PointerEvent): void {
        box = { id: e.pointerId, x: e.clientX + scrollX, y: e.clientY + scrollY, cx: e.clientX, cy: e.clientY, add: e.ctrlKey || e.metaKey || e.shiftKey, before: new Set(selected), el: null };
        try {
            wrap.setPointerCapture(e.pointerId);
        } catch {
            // Without capture the box just ends if the pointer leaves the photos.
        }
    }

    function moveBox(e: PointerEvent): void {
        if (!box) return;
        box.cx = e.clientX;
        box.cy = e.clientY;
        if (!box.el) {
            if (Math.hypot(box.cx + scrollX - box.x, box.cy + scrollY - box.y) < 6) return;
            box.el = document.createElement('div');
            box.el.className = 'lasso';
            document.body.append(box.el);
            document.body.classList.add('boxing');
            boxScroll();
        }
        drawBox();
    }

    function drawBox(): void {
        if (!box?.el) return;
        // Where it started is kept on the page, so it stretches as the page scrolls.
        const x = box.x - scrollX;
        const y = box.y - scrollY;
        const left = Math.min(x, box.cx);
        const top = Math.min(y, box.cy);
        const right = Math.max(x, box.cx);
        const bottom = Math.max(y, box.cy);
        Object.assign(box.el.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        selected.clear();
        if (box.add) for (const u of box.before) selected.add(u);
        for (const li of wrap.querySelectorAll<HTMLElement>('.ogrid > li')) {
            const r = li.getBoundingClientRect();
            if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) selected.add(li.dataset.u ?? '');
        }
        update();
    }

    function boxScroll(): void {
        if (!box?.el) return;
        const step = edgeStep(box.cy, 40, 12);
        if (step) {
            const before = scrollY;
            scrollBy(0, step);
            if (scrollY !== before) drawBox();
        }
        requestAnimationFrame(boxScroll);
    }

    function endBox(): void {
        if (box?.el) {
            box.el.remove();
            document.body.classList.remove('boxing');
        } else if (!box?.add) {
            selected.clear();
            update();
        }
        box = null;
    }

    function drop(): void {
        if (!drag) return;
        const d = drag;
        drag = null;
        clearTimeout(d.timer);
        if (!d.lifted) return;
        d.ghost?.remove();
        d.li.classList.remove('placeholder');
        document.body.classList.remove('reordering');
        if (d.target) d.target.appendChild(d.li);
        // The others go either side of it, in the order they were in.
        const k = d.members.indexOf(d.li);
        d.li.before(...d.members.slice(0, k));
        d.li.after(...d.members.slice(k + 1));
        // Until the drag's click has gone by (wherever it lands, if anywhere).
        dragged = true;
        setTimeout(() => {
            dragged = false;
        });
        const pdfLists = Array.from(wrap.querySelectorAll('.pdf .ogrid'), uuidsIn);
        if (store.simple) {
            store.groups = regroup(split(pdfLists[0] ?? [])); // its one list, in even PDFs
        } else {
            store.groups = regroup(pdfLists).filter((g) => g.length);
            // A PDF emptied, or "New PDF" used: redrawn once the drag's click has gone by, to number the
            // PDFs and for a fresh "New PDF". Otherwise the photo's already where it goes.
            if (store.groups.length !== pdfLists.length - 1 || pdfLists.at(-1)?.length) return void setTimeout(drawGroups);
        }
        for (const ul of wrap.querySelectorAll<HTMLElement>('.ogrid')) ul.style.minHeight = '';
        renumber(wrap);
        update();
    }
}
