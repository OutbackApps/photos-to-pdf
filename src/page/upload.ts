/*
 * Adding a file (a PDF, or a photo from this device) to the job diary as this staff member: straight to
 * ServiceM8 if the browser may, otherwise through the function.
 */

import { api, call } from './api';
import { boot } from './env';
import { DIARY_STEPS, toJpeg } from './pdf/images';
import { store } from './store';

/** What can go through the function (its payloads are capped at 6 MB, and this is base64'd). */
export const RELAY_MAX = 3.5 * 1024 * 1024;

/** ServiceM8 refused the file: `tooBig` when it said it was too big (413). */
export class Refused extends Error {
    constructor(
        message: string,
        readonly tooBig: boolean,
    ) {
        super(message);
    }
}

/** Adds the file to the job diary; the name it was saved as. */
export async function uploadAttachment(name: string, blob: Blob, kind: 'pdf' | 'photo'): Promise<string> {
    if (store.direct && (await uploadDirect(name, blob, kind))) return name;
    if (blob.size > RELAY_MAX) {
        if (kind === 'pdf') throw new Error("The PDF couldn't be saved from here. Try fewer photos.");
        // A photo too big for the function: a slightly smaller full-size copy for the diary.
        const jpeg = await toJpeg(blob, RELAY_MAX, DIARY_STEPS);
        if (jpeg.data.length > RELAY_MAX) throw new Error('That photo is too big to add from here.');
        blob = new Blob([jpeg.data], { type: 'image/jpeg' });
        name = name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg';
    }
    const data = await base64(blob);
    const event = kind === 'pdf' ? 'photos_to_pdf_save' : 'photos_to_pdf_upload';
    return (await call(event, { name, data, type: blob.type })).name;
}

/** Straight to ServiceM8. False if the browser isn't allowed (CORS); throws Refused if ServiceM8 says no. */
async function uploadDirect(name: string, blob: Blob, kind: 'pdf' | 'photo'): Promise<boolean> {
    const send = (impersonate: string | null) => {
        const form = new FormData();
        form.set('related_object', 'job');
        form.set('related_object_uuid', store.job.uuid);
        form.set('attachment_name', name);
        form.set('file', blob, name);
        return api('/attachment.json', { method: 'POST', body: form, headers: impersonate ? { 'x-impersonate-uuid': impersonate } : {} });
    };
    let res: Response;
    try {
        res = await send(boot.staffUUID);
        // Not every token may act as a staff member: save it as the add-on instead.
        if (boot.staffUUID && (res.status === 400 || res.status === 401 || res.status === 403)) res = await send(null);
    } catch (err) {
        if (err instanceof TypeError) return false;
        throw err;
    }
    if (res.ok) return true;
    throw new Refused(`ServiceM8 didn't accept ${kind === 'pdf' ? 'the PDF' : 'the photo'} (${res.status}).`, res.status === 413);
}

/** A file as base64, to go through the function. */
const base64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result); // a data: URL, from readAsDataURL
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
