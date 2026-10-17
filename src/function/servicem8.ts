/*
 * The ServiceM8 API, from the function, with the token ServiceM8 gives it for each event.
 */

import { log } from './log';

export const API = 'https://api.servicem8.com/api_1.0';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What ServiceM8 calls the function with: the event, its arguments, who it's for, and the account's preferences. */
export interface AddonEvent {
    eventName?: string;
    eventArgs?: Record<string, unknown>;
    auth: { accessToken: string; accountUUID?: string; staffUUID?: string };
    preferences?: Record<string, unknown>;
}

/** A problem to tell the staff member about as it is (any other error is "Something went wrong"). */
export class UserError extends Error { }

export function needUuid(value: unknown, what: string): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new UserError(`Missing or invalid ${what}.`);
    return value;
}

/** Text with something in it, trimmed; otherwise null. */
export const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

type Init = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

/** An API request: a refusal becomes a message for the staff member, anything else unexpected an error. */
export async function sm8(event: AddonEvent, path: string, init: Init = {}): Promise<Response> {
    const res = await fetch(API + path, {
        ...init,
        headers: { authorization: `Bearer ${event.auth.accessToken}`, accept: 'application/json', ...init.headers },
    });
    if (res.ok || (init.redirect === 'manual' && res.status >= 300 && res.status < 400)) return res;
    const where = path.split('?')[0];
    log('warn', 'ServiceM8 API request failed', { path: where, status: res.status });
    if (res.status === 401 || res.status === 403) {
        throw new UserError("Photos to PDF isn't allowed to do that in ServiceM8. Check the add-on is switched on and its permissions were accepted.");
    }
    if (res.status === 404) throw new UserError("That couldn't be found in ServiceM8.");
    throw new Error(`ServiceM8 API ${res.status} for ${where}`);
}

export const sm8Json = <T>(event: AddonEvent, path: string): Promise<T> => sm8(event, path).then((res) => res.json() as Promise<T>);

/** Attach a file to the job diary as the staff member who clicked the button (as the add-on if that's refused). */
export async function uploadFile(event: AddonEvent, jobUUID: string, name: string, bytes: Uint8Array, type: string): Promise<void> {
    const send = (impersonate: string | null) => {
        const form = new FormData();
        form.set('related_object', 'job');
        form.set('related_object_uuid', jobUUID);
        form.set('attachment_name', name);
        form.set('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), name);
        return fetch(`${API}/attachment.json`, {
            method: 'POST',
            headers: { authorization: `Bearer ${event.auth.accessToken}`, ...(impersonate ? { 'x-impersonate-uuid': impersonate } : {}) },
            body: form,
        });
    };
    const staffUUID = UUID_RE.test(event.auth.staffUUID ?? '') ? (event.auth.staffUUID ?? null) : null;
    let res = await send(staffUUID);
    if (staffUUID && (res.status === 400 || res.status === 401 || res.status === 403)) {
        // Not every token may act as a staff member: save it as the add-on instead.
        log('warn', 'Upload as staff member refused, saving as the add-on', { status: res.status });
        res = await send(null);
    }
    if (!res.ok) {
        log('warn', 'Upload failed', { type, status: res.status, body: (await res.text()).slice(0, 300) });
        throw new UserError(`ServiceM8 didn't accept ${type === 'application/pdf' ? 'the PDF' : 'the photo'} (${res.status}).`);
    }
}
