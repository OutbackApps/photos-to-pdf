/*
 * Drawing the popup: the photos in their PDFs (Simple: one list), "New PDF" and "Left out", the bar at
 * the top and the footer; kept up to date as things change, without redrawing what doesn't need it.
 */

import { arrangeable } from './arrange';
import { renderSaved } from './done';
import { app } from './env';
import { even, isOut, leftOut, leaveOut, putBack, regroup, setPerPdf, split } from './groups';
import { nameBoxes, nameBoxHtml } from './names/boxes';
import { hideHelp } from './names/help';
import { updateNames } from './names/names';
import { hideSuggest } from './names/suggest';
import { canEnlarge, enlarged, hidePeek, setEnlarge } from './peek';
import { addFiles, DIARY_LABEL } from './photos/device';
import { thumb } from './photos/thumbs';
import { save } from './save';
import { busy, byUuid, MAX_PER_PDF, type Photo, perPdfFrom, store, VIEW_KEY } from './store';
import { el, esc, remember } from './util';

export function render(): void {
    if (store.step.step === 'saved') renderSaved(store.step);
    else renderPick();
    fitFoot();
}

/** Every photo's uuid in the order shown: the PDFs (or Simple's list), then "Left out". */
export const shownOrder = (): string[] => Array.from(app.querySelectorAll<HTMLElement>('.groups .ogrid > li'), (li) => li.dataset.u ?? '');

/** The top bar, the photos, and the footer (what's selected, photos per PDF, save). */
function renderPick(): void {
    const { photos, simple } = store;
    const hint = photos.length ? '' : 'No photos on this job yet. Add some from this device.';
    const checked = enlarged() ? ' checked' : '';
    const enlargeToggle = canEnlarge ? `<label class="enlarge"><input type="checkbox" id="enlarge"${checked}> Enlarge on hover</label>` : '';
    const on = (isOn: boolean) => (isOn ? ' on' : '');
    // With a mouse (as for "Enlarge on hover") or a finger.
    const how = canEnlarge
        ? 'Click to select (Shift or Ctrl for more, or drag a box), then drag them. Double-click to leave one out or put it back.'
        : 'Tap to select, hold to drag, double-tap to leave one out or put it back.';
    const selectionBar = `<div class="selection-bar">
            <span class="muted" id="sel-how">${how}</span>
            <span id="sel-count"></span>
            <button class="link" id="sel-out">Leave out</button>
            <button class="link" id="sel-back">Put back</button>
            <button class="link" id="sel-clear">Clear</button>
        </div>`;
    app.innerHTML = `
        <div class="bar">
        <span class="view" role="group" aria-label="View">
            <button class="link${on(simple)}" id="view-simple" aria-pressed="${simple}">Simple</button>
            <button class="link${on(!simple)}" id="view-detailed" aria-pressed="${!simple}">Detailed</button>
        </span>
        <span class="muted">${hint}</span>
        <span class="actions">
            ${enlargeToggle}
            <button class="link" id="none">Leave all out</button>
            <button class="link" id="every">Put all back</button>
            <button class="link" id="add-photos">+ Add photos</button>
            <input type="file" id="add" accept="image/*" multiple hidden>
        </span>
        </div>
        ${photos.length ? '<div class="groups"></div>' : ''}
        <div class="foot">
        ${photos.length ? selectionBar : ''}
        <div class="per"${simple ? ' hidden' : ''}>
            <label for="per">Photos per PDF</label>
            <input type="number" id="per" min="1" max="${MAX_PER_PDF}" step="1" inputmode="numeric" value="${store.perPdf}">
            <span class="muted" id="pdfs"></span><span class="danger" id="over"></span>
            <button id="resplit"></button>
        </div>
        <p class="danger" id="error" hidden></p>
        <button class="btn" id="save"></button>
        </div>`;
    const button = (id: string) => el<HTMLButtonElement>(id, app);
    button('#view-simple').onclick = () => {
        if (!store.simple) setView(true);
    };
    button('#view-detailed').onclick = () => {
        if (store.simple) setView(false);
    };
    button('#none').onclick = () => {
        store.groups = [];
        drawGroups();
    };
    button('#every').onclick = () => {
        putBack(leftOut().map((p) => p.uuid));
        drawGroups();
    };
    const per = el<HTMLInputElement>('#per', app);
    per.oninput = () => {
        const n = perPdfFrom(per.value);
        if (!n || n === store.perPdf) return; // e.g. cleared to type a new number
        setPerPdf(n);
        drawGroups();
    };
    per.onblur = () => {
        per.value = String(store.perPdf);
    };
    button('#resplit').onclick = () => {
        store.groups = regroup(split(store.groups.flat()));
        drawGroups();
    };
    button('#save').onclick = () => void save();
    if (photos.length) {
        button('#sel-out').onclick = () => setSelectedOut(true);
        button('#sel-back').onclick = () => setSelectedOut(false);
        button('#sel-clear').onclick = () => {
            store.selected.clear();
            update();
        };
    }
    const enlarge = app.querySelector<HTMLInputElement>('#enlarge');
    if (enlarge) enlarge.onchange = () => setEnlarge(enlarge.checked);
    const add = el<HTMLInputElement>('#add', app);
    button('#add-photos').onclick = () => add.click();
    add.onchange = () => {
        if (add.files) addFiles(add.files);
        add.value = '';
    };
    drawGroups();
}

/** A photo's tile. */
const tile = (p: Photo) => `<li data-u="${esc(p.uuid)}"><button class="ph" data-i="${store.photos.indexOf(p)}" aria-label="${esc(p.name)}">
                <span class="ph-msg">Loading…</span><span class="dup" hidden>Duplicate</span>${p.file ? '<span class="dev"></span>' : ''}
            </button></li>`;

/** A section: a PDF (or Simple's list, 'all'), "New PDF" or "Left out", with its name box (if it has one). */
const section = (kind: string, title: string, list: Photo[], gi?: number | 'all') => `<section class="group ${kind}">
            <div class="group-head"><h2>${title} <span class="count muted"></span></h2>${nameBoxHtml(gi)}<span class="pdf-saved muted"></span></div>
            <ul class="ogrid">${list.map(tile).join('')}</ul>
        </section>`; // An empty list mustn't hold even whitespace, or it isn't :empty (its "Drag a photo here").

/**
 * The photos, in their PDFs ("New PDF" to start another), then the ones left out. Redrawn on its own
 * when they change, so the rest of the page (e.g. "Photos per PDF" being typed in) isn't.
 */
export function drawGroups(): void {
    const old = app.querySelector('.groups');
    if (old) {
        hidePeek(); // its tile is about to go
        hideSuggest(); // and its name box
        hideHelp();
        const wrap = document.createElement('div');
        wrap.className = 'groups';
        // Simple: the photos in one list, the PDFs split up when saved.
        const pdfs = store.simple
            ? [section('pdf', 'Photos', store.groups.flat().map(byUuid), 'all')]
            : [...store.groups.map((g, gi) => section('pdf', `PDF ${gi + 1}`, g.map(byUuid), gi)), section('pdf new', 'New PDF', [])];
        wrap.innerHTML = [...pdfs, section('out', 'Left out', leftOut())].join('');
        old.replaceWith(wrap);
        nameBoxes(wrap);
        arrangeable(wrap);
        for (const ph of wrap.querySelectorAll<HTMLElement>('.ph')) {
            const p = store.photos[Number(ph.dataset.i)];
            if (p) thumb(ph, p);
        }
    }
    update();
}

/** Room at the bottom of the page for the fixed footer, so it never covers the last row or page. */
function fitFoot(): void {
    const foot = app.querySelector<HTMLElement>('.foot');
    document.body.style.paddingBottom = `${(foot ? foot.offsetHeight : 0) + 12}px`;
}

/** Brings the picker up to date without redrawing it (so thumbnails and drags carry on). */
export function update(): void {
    const btn = app.querySelector<HTMLButtonElement>('#save');
    if (!btn) return; // not the picker
    const { groups, photos, perPdf } = store;
    const n = groups.flat().length;
    for (const ph of app.querySelectorAll<HTMLButtonElement>('.ph')) updateTile(ph);
    for (const id of ['#view-simple', '#view-detailed', '#add-photos', '#none', '#every', '#per', '#resplit']) el<HTMLButtonElement>(id, app).disabled = busy();
    updateSelectionBar();
    updateNames(app);
    const resplit = el('#resplit', app);
    resplit.hidden = even();
    resplit.textContent = `Split into PDFs of ${perPdf}`;
    el('#none', app).hidden = !n;
    el('#every', app).hidden = n === photos.length;
    const over = groups.filter((g) => g.length > perPdf).length;
    const pdfs = groups.length === 1 ? '1 PDF' : `${groups.length} PDFs`;
    el('#pdfs', app).textContent = n ? pdfs : '';
    el('#over', app).textContent = over ? `${over} over the limit` : '';
    const err = el('#error', app);
    err.hidden = !store.error;
    err.textContent = store.error ?? '';
    fitFoot();
    btn.disabled = !n || busy();
    btn.textContent = saveLabel(n, groups.length);
}

/** A tile: selected, tagged as a duplicate, and how adding it to the diary went (a photo from this device). */
function updateTile(ph: HTMLButtonElement): void {
    const p = store.photos[Number(ph.dataset.i)];
    if (!p) return;
    ph.disabled = busy();
    ph.classList.toggle('sel', store.selected.has(p.uuid));
    (ph.querySelector('.dup') as HTMLElement).hidden = !p.duplicate;
    ph.setAttribute('aria-label', p.duplicate ? `${p.name} (duplicate)` : p.name);
    const dev = ph.querySelector('.dev');
    if (dev && p.diary) {
        dev.textContent = DIARY_LABEL[p.diary];
        dev.className = `dev ${p.diary}`;
    }
}

/** How many are selected, with Leave out and Put back for those it applies to (or how to select, when none are). */
function updateSelectionBar(): void {
    if (!app.querySelector('.selection-bar')) return; // no photos yet
    const uuids = [...store.selected];
    const show = (id: string, on: boolean) => {
        const shown = el(id, app);
        shown.hidden = !on;
        if (shown instanceof HTMLButtonElement) shown.disabled = busy();
    };
    show('#sel-how', !uuids.length);
    show('#sel-count', uuids.length > 0);
    show('#sel-out', uuids.some((u) => !isOut(u)));
    show('#sel-back', uuids.some(isOut));
    show('#sel-clear', uuids.length > 0);
    el('#sel-count', app).textContent = `${uuids.length} selected`;
}

/** The save button: what saving will do, or how far it's got. */
function saveLabel(n: number, pdfs: number): string {
    const s = store.step;
    const which = (step: { pdf: number; of: number }) => (step.of > 1 ? ` ${step.pdf + 1} of ${step.of}` : '');
    if (s.step === 'making') return `Making PDF${which(s)}: photo ${Math.min(s.done + 1, s.n)} of ${s.n}…`;
    if (s.step === 'diary') return 'Adding photos to the job diary…';
    if (s.step === 'saving') return `Saving PDF${which(s)} to the job diary…`;
    if (!n) return 'Every photo is left out';
    const count = `${n} ${n === 1 ? 'photo' : 'photos'}`;
    return pdfs === 1 ? `Save PDF of ${count} to job diary` : `Save ${pdfs} PDFs (${count}) to job diary`;
}

/** Counts as photos move about, which PDFs are over the limit, and which photos are left out. */
export function renumber(wrap: HTMLElement): void {
    const { simple, perPdf } = store;
    for (const group of wrap.querySelectorAll('.group')) {
        const items = Array.from(group.querySelectorAll('.ogrid > li'));
        const inPdf = group.classList.contains('pdf');
        // A left out photo is greyed.
        for (const li of items) li.firstElementChild?.classList.toggle('out', !inPdf);
        // Simple's one list is split up when saved, so it's never over the limit.
        const over = !simple && inPdf && items.length > perPdf;
        group.classList.toggle('over', over);
        let count = '';
        if (!simple && inPdf && items.length) count = `${items.length} of ${perPdf}${over ? ', over the limit' : ''}`;
        else if (items.length) count = String(items.length);
        (group.querySelector('.count') as HTMLElement).textContent = count;
    }
}

/**
 * Leaves these photos out (true) or puts them back at the end (false), in the order given. Unless a PDF
 * comes or goes in Detailed, just they move, so the rest (and their thumbnails) stay as they are.
 */
export function setOut(uuids: string[], out: boolean): void {
    const wrap = el('.groups', app);
    const pdfs = store.groups.length;
    if (out) uuids.forEach(leaveOut);
    else putBack(uuids);
    if (store.simple) store.groups = regroup(split(store.groups.flat())); // still even PDFs, in its one list
    else if (store.groups.length !== pdfs) return drawGroups(); // redrawn, to number them
    const li = (uuid: string) => el(`li[data-u="${CSS.escape(uuid)}"]`, wrap);
    const lists = wrap.querySelectorAll('.pdf:not(.new) .ogrid');
    for (const uuid of uuids) {
        const gi = store.groups.findIndex((g) => g.includes(uuid));
        if (gi >= 0) lists[store.simple ? 0 : gi]?.appendChild(li(uuid));
    }
    // Left out ones are in the photos' own order.
    const outList = el('.out .ogrid', wrap);
    for (const p of leftOut()) outList.appendChild(li(p.uuid));
    renumber(wrap);
    update();
}

/** The selected photos that are in a PDF, left out (true) or put back (false), and the selection cleared. */
export function setSelectedOut(out: boolean): void {
    const uuids = shownOrder().filter((u) => store.selected.has(u) && isOut(u) !== out);
    store.selected.clear();
    store.anchor = null;
    if (uuids.length) setOut(uuids, out);
    else update();
}

/** Switching to Simple puts the photos back into even PDFs, in the order they're in. */
function setView(toSimple: boolean): void {
    store.simple = toSimple;
    if (toSimple) store.groups = regroup(split(store.groups.flat()));
    remember(VIEW_KEY, toSimple ? 'simple' : 'detailed');
    render();
}
