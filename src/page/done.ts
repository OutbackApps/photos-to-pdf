/*
 * Saved: what was saved, anything that didn't work, and Done to close (ServiceM8 can't refresh the open
 * job's diary, so it says to reopen the job).
 */

import { app, client } from './env';
import type { Step } from './store';
import { el, esc } from './util';

export function renderSaved(step: Extract<Step, { step: 'saved' }>): void {
    const { pdfs } = step;
    const names = pdfs.flatMap((pdf) => pdf.names);
    const one = names.length === 1;
    const saved = one ? 'PDF saved' : `${names.length} PDFs saved`;
    const them = one ? 'it' : 'them';
    const inParts = pdfs.filter((pdf) => pdf.names.length > 1).length;
    const partsWhat = inParts === 1 ? "A PDF was too big for ServiceM8 in one file, so it's" : `${inParts} PDFs were too big for ServiceM8 in one file, so they're`;
    const shrunk = pdfs.flatMap((pdf) => pdf.shrunk);
    // Anything else worth saying, under what was saved: [class, text].
    const notes: [string, string][] = [];
    if (inParts) notes.push(['muted', `${partsWhat} saved in parts.`]);
    if (shrunk.length) notes.push(['muted', `Too big for ServiceM8 even on their own, so made smaller to fit: ${shrunk.join(', ')}`]);
    if (step.shrunk) notes.push(['muted', "This device can't send files straight to ServiceM8, so the photos were made smaller to fit."]);
    if (step.failed.length) notes.push(['danger', `Left out (couldn't be read): ${step.failed.join(', ')}`]);
    if (step.notInDiary.length) notes.push(['danger', `Couldn't add to the job diary (they're still in the PDFs): ${step.notInDiary.join(', ')}`]);
    const list = names.map((name) => `<li>${esc(name)}</li>`).join('');
    const said = notes.map(([kind, text]) => `<p class="${kind}">${esc(text)}</p>`).join('');
    app.innerHTML = `
        <div class="center done">
            <div class="done-tick" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
            <h1>${saved} to the job diary</h1>
            <ul class="done-names muted">${list}</ul>
            <p class="done-reopen">Reopen the job to see ${them} in the job diary.</p>
        </div>
        <div class="foot">
            ${said}
            <button class="btn" id="done">Done</button>
        </div>`;
    el<HTMLButtonElement>('#done', app).onclick = () => client.closeWindow();
}
