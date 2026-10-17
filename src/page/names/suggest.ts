/*
 * The job's fields, offered under a name box: all of them when it's clicked into, those matching what's
 * typed after a "{", or all of them to change a field the caret's on.
 */

import { app } from '../env';
import { esc } from '../util';
import { type FieldChoice, fieldChoices } from './fields';
import { fieldAt } from './template';

/**
 * How the fields are offered, and what a pick replaces:
 *   typed:   after a "{" typed, those matching what's typed since; a pick replaces it (and the rest of a field)
 *   change:  the caret on a field already there (clicked, or moved onto it): all of them; a pick replaces that field
 *   add:     the box just clicked into: all of them; a pick goes where the caret is (over any text selected)
 */
type Mode = 'typed' | 'change' | 'add';

interface Offer {
    input: HTMLInputElement;
    mode: Mode;
    /** What a pick replaces (typed, change): from start to end (typed: to the caret). */
    start: number | null;
    end: number | null;
    items: FieldChoice[];
}

const box = document.createElement('ul');
box.className = 'suggest';
box.hidden = true;
box.setAttribute('role', 'listbox');
document.body.append(box);

/** What's offered now, and the one picked out. */
let suggesting: (Offer & { active: number }) | null = null;
/** The name box clicked (or tabbed) into, until something's typed in it: all the fields are offered, so they're found. */
let browsing: HTMLInputElement | null = null;

/** Clicked or tabbed into (the box), or typed in (null): whether all the fields are offered. */
export function browse(input: HTMLInputElement | null): void {
    browsing = input;
}

export const suggestingFor = (): HTMLInputElement | null => suggesting?.input ?? null;

/** What to offer in a name box (and the one to pick out to start with), or null for nothing. `typing`: asked as it's typed in. */
function offerFor(input: HTMLInputElement, typing: boolean): (Offer & { now: number }) | null {
    if (document.activeElement !== input) return null;
    const caret = input.selectionStart ?? 0;
    const on = typing ? null : fieldAt(input);
    if (on) {
        // Changing a field: every field, with it picked out.
        const now = Math.max(0, fieldChoices().findIndex((f) => f.key === on.key));
        return { input, mode: 'change', start: on.start, end: on.end, items: fieldChoices(), now };
    }
    const typed = input.selectionEnd === caret ? /\{([\w.]*)$/.exec(input.value.slice(0, caret)) : null;
    if (!typed) return browsing === input ? { input, mode: 'add', start: null, end: null, items: fieldChoices(), now: 0 } : null;
    let q = (typed[1] ?? '').toLowerCase();
    if (q.includes('.')) {
        if (!q.startsWith('job.')) return null; // only the job's fields
        q = q.slice(4);
    }
    const items = fieldChoices().filter((f) => f.key.includes(q) || f.label.toLowerCase().includes(q));
    return items.length ? { input, mode: 'typed', start: caret - typed[0].length, end: null, items, now: 0 } : null;
}

/** Offers the job's fields under a name box, as its caret and text say (or hides them). `typing`: called as it's typed in. */
export function suggest(input: HTMLInputElement, typing = false): void {
    const offer = offerFor(input, typing);
    if (!offer) return hideSuggest();
    const { now, ...next } = offer;
    const { mode, items } = next;
    const same = suggesting?.input === input && suggesting.mode === mode && suggesting.start === next.start && suggesting.items.length === items.length;
    // The same as already shown (e.g. the caret moved within what's typed): left as it is, with what's picked out.
    if (same && suggesting?.items.every((f, k) => f === items[k])) return placeSuggest();
    suggesting = { ...next, active: same && suggesting ? suggesting.active : now };
    const head = { add: 'Add a job field to the name', change: 'Change this field to', typed: '' }[mode];
    const options = items.map((f, k) => {
        const label = f.label ? `<span class="s-label">${esc(f.label)}</span>` : '';
        const value = f.value ? esc(f.value) : '<i>empty</i>';
        return `<li role="option" data-k="${k}">${label}<span class="s-key">{job.${esc(f.key)}}</span><span class="s-value">${value}</span></li>`;
    });
    box.innerHTML = (head ? `<li class="s-head">${head}</li>` : '') + options.join('');
    box.hidden = false;
    placeSuggest();
    pickSuggestion(suggesting.active);
}

/** Under its box, or over it if there's no room below (above the footer). */
function placeSuggest(): void {
    if (!suggesting) return;
    const r = suggesting.input.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 320), innerWidth - 16);
    const bottom = innerHeight - (app.querySelector<HTMLElement>('.foot')?.offsetHeight ?? 0);
    const h = box.offsetHeight;
    const top = r.bottom + 2 + h <= bottom ? r.bottom + 2 : Math.max(8, r.top - 2 - h);
    Object.assign(box.style, { width: `${width}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`, top: `${top}px` });
}

/** Picks out field `k` (↑/↓ go round). */
function pickSuggestion(k: number): void {
    if (!suggesting) return;
    suggesting.active = (k + suggesting.items.length) % suggesting.items.length;
    const options = box.querySelectorAll('[data-k]');
    options.forEach((li, i) => li.classList.toggle('on', i === suggesting?.active));
    options[suggesting.active]?.scrollIntoView({ block: 'nearest' });
}

/** The field picked, in place of what it replaces (see Mode). */
function chooseSuggestion(k: number): void {
    if (!suggesting) return;
    const { input, items, mode } = suggesting;
    const text = `{job.${items[k]?.key}}`;
    const start = (mode === 'add' ? input.selectionStart : suggesting.start) ?? 0;
    let after = input.value.slice(input.selectionEnd ?? 0); // add
    if (mode === 'change') after = input.value.slice(suggesting.end ?? 0);
    else if (mode === 'typed') after = after.replace(/^[\w.]*\}/, '');
    input.value = input.value.slice(0, start) + text + after;
    input.setSelectionRange(start + text.length, start + text.length);
    hideSuggest();
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function hideSuggest(): void {
    browsing = null;
    suggesting = null;
    box.hidden = true;
}

/** ↑/↓, Enter (and Tab after a "{") and Esc in the name box while fields are offered. True if it was one of those. */
export function suggestKey(e: KeyboardEvent): boolean {
    if (!suggesting || e.target !== suggesting.input) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') pickSuggestion(suggesting.active + (e.key === 'ArrowDown' ? 1 : -1));
    // Tab picks one only after a "{": otherwise it moves on, as it would.
    else if (e.key === 'Enter' || (e.key === 'Tab' && suggesting.mode === 'typed')) chooseSuggestion(suggesting.active);
    else if (e.key === 'Escape') hideSuggest();
    else return false;
    return true;
}

box.addEventListener('mousedown', (e) => e.preventDefault()); // the box keeps the focus
box.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-k]'); // not the heading
    if (li && suggesting) chooseSuggestion(Number(li.dataset.k));
});
addEventListener('scroll', () => placeSuggest(), { passive: true });
