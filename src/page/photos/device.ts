/*
 * Photos from this device (the library, camera, files, or dropped): added to the end of the PDFs, and to
 * the job diary as they're picked.
 */

import { app } from '../env';
import { checkDuplicate } from '../duplicates';
import { putBack } from '../groups';
import { render, update } from '../render';
import { busy, type Photo, store } from '../store';
import { uploadAttachment } from '../upload';

let deviceCount = 0;
let diaryQueue: Promise<void> = Promise.resolve(); // one upload at a time

const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|avif|webp|gif)$/i.test(f.name);

/** What a device photo's tile says about adding it to the job diary. */
export const DIARY_LABEL = { saving: 'Adding to diary…', saved: 'Added to diary', failed: 'Not added to diary' };

export function addFiles(files: FileList | File[]): void {
    const added = Array.from(files).filter(isImage);
    if (!added.length || busy()) return;
    const uuids = added.map((file) => {
        deviceCount++;
        const p: Photo = { uuid: `device-${deviceCount}`, name: file.name || `Photo ${deviceCount}.jpg`, timestamp: null, file, diary: 'saving' };
        store.photos.push(p);
        void addToDiary(p); // it records its own failures on the tile
        checkDuplicate(p); // e.g. a photo that's on the job already
        return p.uuid;
    });
    putBack(uuids);
    render();
    // Show the new ones.
    app.querySelector(`.ph[data-i="${store.photos.length - 1}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function addToDiary(p: Photo): Promise<void> {
    p.diary = 'saving';
    diaryQueue = diaryQueue.then(async () => {
        try {
            await uploadAttachment(p.name, p.file as File, 'photo');
            p.diary = 'saved';
        } catch {
            // Shown on the tile; finishDiary() tries it again when the PDF is saved.
            p.diary = 'failed';
        }
        update();
    });
    return diaryQueue;
}

/** Device photos still uploading (and failed ones, tried again), before the PDFs are saved: the names of any that still failed. */
export async function finishDiary(): Promise<string[]> {
    for (const p of store.photos.filter((q) => q.diary === 'failed')) void addToDiary(p);
    await diaryQueue;
    return store.photos.filter((p) => p.diary === 'failed').map((p) => p.name);
}
