/*
 * The popup (bundled into one script by scripts/build-page.ts): opened from the job card's button, it
 * shows the job's photos in PDFs to arrange, name and save to the job diary.
 */

import { api, call, setToken } from './api';
import { checkDuplicate } from './duplicates';
import { app, client } from './env';
import { split } from './groups';
import { addFiles } from './photos/device';
import { render, setSelectedOut, shownOrder, update } from './render';
import { busy, store } from './store';
import { errText, esc, targetOf } from './util';

async function start(): Promise<void> {
    app.innerHTML = `<p class="muted center">Loading the job's photos&hellip;</p>`;
    let data;
    try {
        data = await call('photos_to_pdf_photos');
    } catch (err) {
        app.innerHTML = `<p class="danger">${esc(errText(err))}</p>`;
        return;
    }
    setToken(data.token);
    store.job = data.job;
    store.photos = data.photos;
    // Can this page reach ServiceM8 itself? Otherwise everything goes through the function.
    store.direct = await api(`/job/${data.job.uuid}.json`).then(
        (r) => r.ok,
        () => false,
    );
    store.groups = split(store.photos.map((p) => p.uuid));
    listen();
    render();
    // After the tiles in view have asked for their photos, so they load first.
    setTimeout(() => store.photos.forEach(checkDuplicate), 300);
}

/** The page's own keys, and files dropped on it. */
function listen(): void {
    // Image files dropped anywhere on the picker are added like "Add photos".
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const picking = () => app.querySelector('#save') !== null;
    document.addEventListener('dragover', (e) => {
        if (!hasFiles(e) || !picking() || busy()) return;
        e.preventDefault();
        document.body.classList.add('dropping');
    });
    document.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget) document.body.classList.remove('dropping');
    });
    document.addEventListener('drop', (e) => {
        document.body.classList.remove('dropping');
        if (!hasFiles(e) || !picking() || !e.dataTransfer) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
    });

    // Esc clears the selection, Delete (or Backspace) leaves it out, and Ctrl+A selects every photo.
    document.addEventListener('keydown', (e) => {
        if (!app.querySelector('.groups') || busy() || targetOf(e).closest?.('input')) return;
        if (e.key === 'Escape' && store.selected.size) {
            store.selected.clear();
            update();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selected.size) {
            e.preventDefault();
            setSelectedOut(true);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            for (const u of shownOrder()) store.selected.add(u);
            update();
        }
    });
}

// The page's own text and images can't be dragged about (or dropped into "Photos per PDF"): photos are
// moved with their own dragging. Files dragged in from the device still drop.
document.addEventListener('dragstart', (e) => e.preventDefault());
try {
    // As big as the screen comfortably allows (room for the browser's toolbars and the modal's title), up
    // to 1200 x 900; this page can't see the size of ServiceM8's own page around it.
    const fit = (room: number, margin: number, most: number) => Math.round(Math.max(480, Math.min(most, (room || most) - margin)));
    client.resizeWindow(fit(screen.availWidth, 160, 1200), fit(screen.availHeight, 260, 900));
} catch {
    // Some ServiceM8 windows can't be resized; the page fits any size.
}
void start();
