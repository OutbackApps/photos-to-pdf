/*
 * "?" at the end of a name box: how names work, by example, each with what it comes out as on this job
 * and Use to put it in the box.
 */

import { esc } from '../util';
import { colourTemplate } from './colour';
import { fileName, pdfBase } from './names';
import { hideSuggest } from './suggest';

/** Examples to Use as they are or start from. */
const NAME_EXAMPLES = ['Job #{job.generated_job_id}', 'Job #{job.generated_job_id} Photos[ - PO {job.purchase_order_number}]', '{job.job_address} - Job #{job.generated_job_id}'];

const box = document.createElement('div');
box.className = 'help-box';
box.hidden = true;
box.setAttribute('role', 'dialog');
box.setAttribute('aria-label', 'Naming the PDFs');
document.body.append(box);
let helpFor: HTMLElement | null = null; // the "?" it's open for

/** A line on how it works, then the examples, with what each comes out as on this job. */
function helpHtml(): string {
    const examples = NAME_EXAMPLES.map((template, k) => {
        const result = fileName(template) || pdfBase();
        return `<li><span class="help-template">${colourTemplate(template)}</span><span class="help-result">→ ${esc(result)}</span><button type="button" class="link" data-use="${k}">Use</button></li>`;
    });
    return [
        '<p>Click in the box to add a job field, or type <b>{</b>. Text in <span class="t-opt">[ ]</span> is left out when a field in it is empty.</p>',
        `<ul class="help-examples">${examples.join('')}</ul>`,
        '<p class="muted">Several PDFs get “(1 of 3)” added. The default is set in ServiceM8: Settings → Preferences → Add-ons.</p>',
    ].join('');
}

/** Opens the help under its "?" (right-aligned to it), or closes it if it's open for that one. */
export function toggleHelp(button: HTMLElement): void {
    if (helpFor === button) return hideHelp();
    hideHelp();
    hideSuggest();
    helpFor = button;
    button.setAttribute('aria-expanded', 'true');
    box.innerHTML = helpHtml();
    box.hidden = false;
    const r = button.getBoundingClientRect();
    const width = Math.min(380, innerWidth - 16);
    const h = box.offsetHeight;
    const top = r.bottom + 6 + h <= innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
    Object.assign(box.style, { width: `${width}px`, left: `${Math.max(8, Math.min(r.right - width, innerWidth - width - 8))}px`, top: `${top}px` });
}

export function hideHelp(): void {
    helpFor?.setAttribute('aria-expanded', 'false');
    helpFor = null;
    box.hidden = true;
}

// An example's Use: it goes in the box the "?" is for, as if typed there.
box.addEventListener('click', (e) => {
    const use = (e.target as HTMLElement).closest<HTMLElement>('[data-use]');
    const input = helpFor?.parentElement?.querySelector<HTMLInputElement>('.pdf-name');
    if (!use || !input) return;
    input.value = NAME_EXAMPLES[Number(use.dataset.use)] ?? '';
    hideHelp();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hideSuggest(); // it wasn't typed in: nothing to offer
});

// Closed by a press anywhere else, Esc, or scrolling or resizing (it'd be left behind).
addEventListener('resize', () => helpFor && hideHelp());
document.addEventListener('pointerdown', (e) => {
    if (helpFor && !box.contains(e.target as Node) && e.target !== helpFor) hideHelp();
});
document.addEventListener('keydown', (e) => {
    if (helpFor && e.key === 'Escape') hideHelp();
});
addEventListener('scroll', () => helpFor && hideHelp(), { passive: true });
