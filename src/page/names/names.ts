/*
 * What the PDFs are called: from the template (" (1 of 3)" added when there are several), or a PDF's own
 * name in Detailed. And the name boxes kept up to date: their placeholders, Reset, and beside each what
 * it's saved as.
 */

import { boot } from '../env';
import { busy, store } from '../store';
import { esc } from '../util';
import { paintTemplate } from './colour';
import { labelOf } from './fields';
import { fillTemplate, templateParts } from './template';

/** A template filled in with the job's fields, without anything a file name can't have ('' if it comes out empty). */
export const fileName = (template: string): string =>
    fillTemplate(template, { job: store.job.fields })
        .replaceAll(/[\\/:*?"<>|\p{Cc}]+/gu, '_')
        .slice(0, 120)
        .trim();

/** The name's start, before " (1 of 3)": a job number if the template comes out empty. */
export const pdfBase = (): string => fileName(store.nameTemplate) || `Job #${store.job.fields.generated_job_id || store.job.uuid.slice(0, 8)} Photos`;

/** PDF `k` (from 0) of `of`: "Job #2 Photos (1 of 3)", or just "Job #2 Photos" if it's the only one. */
export const pdfName = (base: string, k: number, of: number): string => (of > 1 ? `${base} (${k + 1} of ${of})` : base);

/** PDF `k`'s name: its own, given in Detailed (a template too, with nothing added), or from the template. */
export function nameOf(k: number, of: number): string {
    const own = store.simple ? undefined : store.groups[k]?.name;
    return (own && fileName(own)) || pdfName(pdfBase(), k, of);
}

/** The empty fields that leave a template's [ ] sections out on this job. */
function emptyFields(template: string): string[] {
    const keys = templateParts(template, { job: store.job.fields }).flatMap((part) => part.empty ?? []);
    return [...new Set(keys)];
}

/**
 * What PDF `k` of `of` is saved as with this template, in HTML: " (1 of 3)" added unless it's a PDF's
 * own name, then `more`, then, if a [ ] section was left out, which empty field left it out.
 */
function savedAs(template: string, k: number, of: number, more: string, own = false): string {
    const filled = fileName(template);
    if (!filled) return `<b>${esc(own ? nameOf(k, of) : pdfName(pdfBase(), k, of))}.pdf</b>${more}`; // the fallback
    const number = !own && of > 1 ? ` (${k + 1} of ${of})` : '';
    const names = emptyFields(template).map(labelOf);
    const are = names.length > 1 ? 'are' : 'is';
    const why = names.length ? ` <span class="left-out-why">(left out: ${esc(names.join(' and '))} ${are} empty)</span>` : '';
    return `<b>${esc(filled + number)}.pdf</b>${more}${why}`;
}

/**
 * The name boxes: empty until a name's typed in, the name from the template (filled in for this job)
 * their placeholder, and Reset to empty them again. Beside Simple's, the first PDF's name and how many
 * more; beside a PDF's in Detailed, what its own name comes out as, once it has one.
 */
export function updateNames(app: HTMLElement): void {
    const of = store.groups.length;
    const reset = app.querySelector<HTMLButtonElement>('#template-reset');
    if (reset) reset.hidden = store.nameTemplate === boot.nameTemplate;
    for (const el of app.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.pdf-name, .name-help, #template-reset, .pdf-reset')) el.disabled = busy();
    for (const input of app.querySelectorAll<HTMLInputElement>('.pdf-name')) {
        const head = input.closest('.group-head') as HTMLElement;
        const saved = head.querySelector('.pdf-saved') as HTMLElement;
        paintTemplate(input);
        if (input.id === 'template') {
            input.placeholder = fileName(boot.nameTemplate) || pdfBase();
            const more = of > 1 ? `, and ${of - 1} more` : '';
            saved.innerHTML = of ? savedAs(store.nameTemplate, 0, of, more) : '';
            continue;
        }
        const gi = Number(input.dataset.g);
        const own = store.groups[gi]?.name;
        input.placeholder = pdfName(pdfBase(), gi, of);
        (head.querySelector('.pdf-reset') as HTMLElement).hidden = !own;
        saved.innerHTML = own ? savedAs(own, gi, of, '', true) : '';
    }
}
