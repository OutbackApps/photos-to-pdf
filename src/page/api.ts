/*
 * Talking to the function (its events, through ServiceM8's SDK) and to the ServiceM8 API straight from
 * the browser, with the short-lived token the function hands over.
 */

import type { CallArgs, CallEvent, Replies } from '../shared/types';
import { boot, client } from './env';

export const API = 'https://api.servicem8.com/api_1.0';

/** Calls this add-on's function; it replies with JSON (`{ error }` when it failed, thrown here). */
export async function call<E extends CallEvent>(eventName: E, args?: CallArgs[E]): Promise<Replies[E]> {
    let raw = await client.invoke(eventName, { jobUUID: boot.jobUUID, ...args });
    if (raw && typeof raw === 'object' && 'eventResponse' in raw) raw = raw.eventResponse;
    let data: unknown = raw;
    if (typeof raw === 'string') {
        try {
            data = JSON.parse(raw);
        } catch {
            throw new Error('Photos to PDF sent back something unexpected. Please try again.');
        }
    }
    if (!data || typeof data !== 'object') throw new Error("Photos to PDF didn't respond. Please try again.");
    if ('error' in data) throw new Error(String(data.error));
    return data as Replies[E];
}

// ServiceM8 API tokens last 15 minutes; get a new one after 10.
let token = boot.token;
let tokenAt = Date.now();
let refreshing: Promise<void> | null = null; // photos load a few at a time: they share one refresh

/** A token from the function that's only just been given out (with the job's photos). */
export function setToken(fresh: string): void {
    token = fresh;
    tokenAt = Date.now();
}

async function apiToken(force = false): Promise<string> {
    if (force || Date.now() - tokenAt > 10 * 60 * 1000) {
        refreshing ??= call('photos_to_pdf_token')
            .then((got) => setToken(got.token))
            .finally(() => {
                refreshing = null;
            });
        await refreshing;
    }
    return token;
}

type Init = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

/** The ServiceM8 API, straight from the browser. Throws a TypeError if the browser isn't allowed (CORS). */
export async function api(path: string, init: Init = {}, retried = false): Promise<Response> {
    const t = await apiToken();
    const res = await fetch(API + path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + t } });
    if (res.status === 401 && !retried) {
        await apiToken(true);
        return api(path, init, true);
    }
    return res;
}
