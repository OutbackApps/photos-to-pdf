/*
 * The name boxes beside the PDFs' headings. Simple: one for every PDF (the template, for this save).
 * Detailed: each PDF's own. Empty until a name's typed in, with the name from the template (filled in)
 * as the placeholder; coloured as they're typed in, with the job's fields offered, and "?" for help.
 */

import { boot } from '../env';
import { update } from '../render';
import { store } from '../store';
import { esc, targetOf } from '../util';
import { paintTemplate } from './colour';
import { toggleHelp } from './help';
import { browse, hideSuggest, suggest, suggestKey } from './suggest';

/**
 * Nothing to fill in. Browsers' own autofill ignores autocomplete="off" in a box they take for a person's
 * name (an id or label like "name"), but not a value it doesn't know; and password managers have their
 * own attributes (LastPass, 1Password, Bitwarden, Dashlane).
 */
const NOT_LOGIN = 'autocomplete="photos-pdf-name" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"';
const HELP = '<button type="button" class="name-help" aria-label="How names work" aria-expanded="false">?</button>';

/** A box in a .name-field, with its text coloured in the layer behind it (paintTemplate), then "?". */
const box = (attrs: string) =>
    `<span class="name-field"><span class="name-colours" aria-hidden="true"></span><input type="text" class="pdf-name" maxlength="200" spellcheck="false" ${NOT_LOGIN} ${attrs}>${HELP}</span>`;

/** The name box for Simple's one list ('all'), PDF `gi` in Detailed, or nothing (New PDF, Left out). */
export function nameBoxHtml(gi: number | 'all' | undefined): string {
    if (gi === 'all') {
        const typed = store.nameTemplate === boot.nameTemplate ? '' : store.nameTemplate;
        return box(`id="template" value="${esc(typed)}" aria-label="What the PDFs are called"`) + '<button class="link" id="template-reset">Reset</button>';
    }
    if (gi === undefined) return '';
    const reset = `<button class="link pdf-reset" data-g="${gi}" hidden>Reset</button>`;
    return box(`data-g="${gi}" value="${esc(store.groups[gi]?.name ?? '')}" aria-label="What PDF ${gi + 1} is called"`) + reset;
}

const isBox = (el: EventTarget | null): el is HTMLInputElement => el instanceof HTMLInputElement && el.matches('.pdf-name');

/** The name boxes in `wrap` (the PDFs, as drawn): what typing, clicking and keys do in them. */
export function nameBoxes(wrap: HTMLElement): void {
    wrap.addEventListener('input', (e) => {
        const input = e.target;
        if (!isBox(input)) return;
        if (input.id === 'template') {
            // Simple's: every PDF's name for this save (cleared: the default again).
            store.nameTemplate = input.value.trim() ? input.value : boot.nameTemplate;
        } else {
            // Its own name, unless it's the template (or cleared).
            const typed = input.value.trim();
            const group = store.groups[Number(input.dataset.g)];
            if (group) group.name = typed && typed !== store.nameTemplate.trim() ? typed : undefined;
        }
        update();
        browse(null); // typing: just the fields after a "{" from now on
        suggest(input, true);
    });
    wrap.addEventListener('click', (e) => {
        const help = targetOf(e).closest<HTMLElement>('.name-help');
        if (help) return toggleHelp(help);
        const reset = targetOf(e).closest<HTMLElement>('#template-reset, .pdf-reset');
        if (!reset) return;
        if (reset.id === 'template-reset') store.nameTemplate = boot.nameTemplate;
        else delete store.groups[Number(reset.dataset.g)]?.name;
        const input = reset.closest('.group-head')?.querySelector<HTMLInputElement>('.pdf-name');
        if (input) input.value = ''; // the placeholder (the default) again
        update();
    });
    // Clicked or tabbed into: every field is offered, so it's plain they can be used.
    for (const type of ['focusin', 'click']) {
        wrap.addEventListener(type, (e) => {
            if (!isBox(e.target) || e.target.disabled) return;
            browse(e.target);
            suggest(e.target);
        });
    }
    // The caret moved by a key (clicks are above; typing is the input event) can start, end or change
    // what's offered. Not the "select" event: setting the caret from code fires it later, and it'd undo an Esc.
    const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
    wrap.addEventListener('keyup', (e) => {
        if (!isBox(e.target) || !MOVES.has(e.key)) return;
        paintTemplate(e.target); // the box may have scrolled
        suggest(e.target);
    });
    wrap.addEventListener('scroll', (e) => isBox(e.target) && paintTemplate(e.target), true);
    wrap.addEventListener('focusout', (e) => isBox(e.target) && hideSuggest());
    wrap.addEventListener('keydown', (e) => {
        if (suggestKey(e)) e.preventDefault();
    });
}
