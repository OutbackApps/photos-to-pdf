/*
 * What the function (src/function) and the popup (src/page) send each other.
 */

/** What the popup starts with, from the function (in #app's data-boot). */
export interface Boot {
    jobUUID: string;
    /** The staff member who opened it: files are added to the job as them. */
    staffUUID: string | null;
    /** A ServiceM8 API token (they last 15 minutes: photos_to_pdf_token gets another). */
    token: string;
    /** The PDF name's template, from the account's preferences (or the default). */
    nameTemplate: string;
}

/** A job: its uuid, and its fields as text, for the PDF name's template ({job.purchase_order_number}...). */
export interface Job {
    uuid: string;
    fields: Record<string, string>;
}

/** A photo in the job diary, oldest first. */
export interface JobPhoto {
    uuid: string;
    name: string;
    timestamp: string | null;
}

/** What the popup sends with each event it invokes (as well as the job's uuid). */
export interface CallArgs {
    photos_to_pdf_photos: Record<string, never>;
    photos_to_pdf_token: Record<string, never>;
    photos_to_pdf_photo_url: { uuid: string };
    photos_to_pdf_photo: { uuid: string; offset: number };
    photos_to_pdf_save: { name: string; data: string; type: string };
    photos_to_pdf_upload: { name: string; data: string; type: string };
}

/** What the function answers each of them with (as JSON), unless it failed: then `{ error }`. */
export interface Replies {
    photos_to_pdf_photos: { job: Job; photos: JobPhoto[]; token: string };
    photos_to_pdf_token: { token: string };
    /** Where the photo's stored, for the browser to fetch it from there (null: ServiceM8 sends it itself). */
    photos_to_pdf_photo_url: { url: string | null };
    /** A piece of a photo (base64) from where it was asked for, and the photo's whole size. */
    photos_to_pdf_photo: { type: string; size: number; data: string };
    photos_to_pdf_save: { name: string };
    photos_to_pdf_upload: { name: string };
}

export type CallEvent = keyof Replies;

/** A reply when the event failed: what to tell the staff member. */
export interface ErrorReply {
    error: string;
}
