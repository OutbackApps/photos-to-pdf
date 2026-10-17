/*
 * Photos to PDF: a ServiceM8-hosted add-on function (Node.js 24, no runtime dependencies), deployed with
 * Addon Kit, which bundles this file and what it imports.
 *
 * The job card's "Photos to PDF" button opens the popup (src/page), which does the image work in the
 * browser (it can decode iPhone HEIC photos; this function can't) and talks to the ServiceM8 API itself
 * with the short-lived token ServiceM8 gives this function. If the browser isn't allowed to (CORS),
 * photos and the finished PDFs are passed through this function instead (client.invoke()), which limits
 * each PDF to ~3.5 MB (photos are then shrunk).
 */

import { log } from './log';
import { errorPage, page } from './page';
import { jobPhotos, photoUrl, relayPhoto, relaySave, relayUpload } from './photos';
import { type AddonEvent, UserError } from './servicem8';

/** What the function answers: the popup's HTML, or a reply to the popup as JSON. */
export interface Reply {
    eventResponse?: string;
}

/** Replies to client.invoke() calls are JSON strings. */
const reply = (data: unknown): Reply => ({ eventResponse: JSON.stringify(data) });

/** What answers each event: the job card's button (in addon.jsonc), and those the popup invokes. */
export const EVENTS: Record<string, (event: AddonEvent, args: Record<string, unknown>) => Promise<Reply> | Reply> = {
    photos_to_pdf: (event) => ({ eventResponse: page(event) }),
    photos_to_pdf_photos: async (event, args) => reply(await jobPhotos(event, args.jobUUID)),
    // A fresh API token: they last 15 minutes.
    photos_to_pdf_token: (event) => reply({ token: event.auth.accessToken }),
    photos_to_pdf_photo_url: async (event, args) => reply(await photoUrl(event, args.uuid)),
    photos_to_pdf_photo: async (event, args) => reply(await relayPhoto(event, args)),
    photos_to_pdf_save: async (event, args) => reply(await relaySave(event, args)),
    photos_to_pdf_upload: async (event, args) => reply(await relayUpload(event, args)),
};

export async function handler(event: AddonEvent): Promise<Reply> {
    const name = String(event.eventName ?? '').toLowerCase();
    const answer = EVENTS[name];
    if (!answer) {
        log('warn', 'Unknown event', { eventName: name });
        return {};
    }
    try {
        return await answer(event, event.eventArgs ?? {});
    } catch (err) {
        const expected = err instanceof UserError;
        const error = err instanceof Error ? err : new Error(String(err));
        log(expected ? 'warn' : 'error', 'Event failed', { eventName: name, error: error.message, ...(expected ? {} : { stack: error.stack }) });
        const message = expected ? error.message : 'Something went wrong. Please try again.';
        return name === 'photos_to_pdf' ? { eventResponse: errorPage(message) } : reply({ error: message });
    }
}
