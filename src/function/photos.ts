/*
 * The job's photos, for the popup: listing them, and passing photos and files through the function
 * when the browser can't reach ServiceM8 itself (CORS).
 */

import type { Replies } from '../shared/types';
import { log } from './log';
import { API, type AddonEvent, needUuid, sm8, sm8Json, str, uploadFile, UserError } from './servicem8';

const PHOTO_TYPES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff', '.avif']);
/** Function payloads are capped at 6 MB and relayed files are base64 (+33%). */
const RELAY_MAX_BYTES = 4 * 1024 * 1024;
/** Photos come through the function in pieces this big: its replies are capped at 6 MB, and base64 adds a third. */
const RELAY_PIECE_BYTES = 3 * 1024 * 1024;

interface Attachment {
    uuid: string;
    active: number | string;
    file_type?: string;
    attachment_name?: string;
    timestamp?: string;
}

/** The job, its fields (for the PDF name's template) and its active photos, oldest first. */
export async function jobPhotos(event: AddonEvent, jobUUIDArg: unknown): Promise<Replies['photos_to_pdf_photos']> {
    const jobUUID = needUuid(jobUUIDArg, 'job');
    const filter = encodeURIComponent(`related_object_uuid eq '${jobUUID}'`);
    const [job, attachments] = await Promise.all([
        sm8Json<Record<string, unknown>>(event, `/job/${jobUUID}.json`),
        sm8Json<Attachment[]>(event, `/attachment.json?%24filter=${filter}`),
    ]);

    const photos = attachments
        .filter((a) => String(a.active) === '1' && PHOTO_TYPES.has(String(a.file_type ?? '').toLowerCase()))
        .map((a) => ({ uuid: a.uuid, name: str(a.attachment_name) ?? 'Photo', timestamp: str(a.timestamp) }))
        .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));

    // The job's fields, for the PDF name's template ({job.purchase_order_number} and so on).
    const fields = Object.fromEntries(
        Object.entries(job)
            .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
            .map(([k, v]) => [k, String(v).trim()]),
    );
    log('info', 'Listed job photos', { accountUUID: event.auth.accountUUID, jobUUID, photos: photos.length });
    return { job: { uuid: jobUUID, fields }, photos, token: event.auth.accessToken };
}

/**
 * Where a photo is stored, for the page to fetch itself: quicker than through this function, if the
 * storage lets the browser (null if ServiceM8 sends the photo itself, with no storage link).
 */
export async function photoUrl(event: AddonEvent, uuidArg: unknown): Promise<Replies['photos_to_pdf_photo_url']> {
    const uuid = needUuid(uuidArg, 'photo');
    const res = await sm8(event, `/attachment/${uuid}.file`, { redirect: 'manual', headers: { accept: '*/*' } });
    const location = res.headers.get('location');
    void res.body?.cancel(); // only the redirect's wanted
    return { url: location ? new URL(location, API).href : null };
}

/**
 * A piece of a photo (from `offset`, and its whole size), for when the browser can't fetch it from
 * ServiceM8 itself. The page asks for the pieces in turn, so photos of any size come through.
 */
export async function relayPhoto(event: AddonEvent, args: Record<string, unknown>): Promise<Replies['photos_to_pdf_photo']> {
    const uuid = needUuid(args.uuid, 'photo');
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    // The page fetches photos through here only if it can't from their storage: worth knowing, as it's slower.
    if (!offset) log('info', 'Relayed photo', { accountUUID: event.auth.accountUUID, uuid });
    // .file redirects to the file's storage; the token mustn't follow it there.
    let res = await sm8(event, `/attachment/${uuid}.file`, { redirect: 'manual', headers: { accept: '*/*' } });
    const location = res.headers.get('location');
    if (location) {
        const storage = new URL(location, API);
        const range = `bytes=${offset}-${offset + RELAY_PIECE_BYTES - 1}`;
        res = await fetch(storage, { headers: { range } });
        if (!res.ok) {
            // Some storage refuses a part of a file: the whole of it is fetched, and the piece taken from that.
            log('warn', 'Photo storage refused a piece, fetching it whole', { uuid, host: storage.host, status: res.status, range, body: (await res.text()).slice(0, 200) });
            res = await fetch(storage);
        }
    }
    if (!res.ok) {
        log('warn', 'Photo download failed', { uuid, status: res.status, redirected: Boolean(location) });
        throw new Error(`Photo download ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    let piece = bytes;
    let size = bytes.length;
    if (res.status === 206) {
        // Just the piece asked for: "Content-Range: bytes start-end/size".
        size = Number(res.headers.get('content-range')?.split('/')[1]);
        if (!Number.isFinite(size)) throw new Error('Photo download without its size');
    } else {
        piece = bytes.subarray(offset); // the whole photo (the storage ignored the range, or there was no redirect)
    }
    return { type: res.headers.get('content-type') ?? 'application/octet-stream', size, data: piece.subarray(0, RELAY_PIECE_BYTES).toString('base64') };
}

/** Saves a PDF to the job diary, for when the browser can't send it to ServiceM8 itself. */
export async function relaySave(event: AddonEvent, args: Record<string, unknown>): Promise<Replies['photos_to_pdf_save']> {
    const jobUUID = needUuid(args.jobUUID, 'job');
    const bytes = Buffer.from(String(args.data ?? ''), 'base64');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new UserError("That isn't a PDF.");
    const name = fileName(args.name, 'Photos.pdf');
    await uploadFile(event, jobUUID, name, bytes, 'application/pdf');
    log('info', 'Saved photos PDF', { accountUUID: event.auth.accountUUID, jobUUID, bytes: bytes.length, relayed: true });
    return { name };
}

/** Adds a photo from the staff member's device to the job diary, for when the browser can't send it itself. */
export async function relayUpload(event: AddonEvent, args: Record<string, unknown>): Promise<Replies['photos_to_pdf_upload']> {
    const jobUUID = needUuid(args.jobUUID, 'job');
    const bytes = Buffer.from(String(args.data ?? ''), 'base64');
    if (bytes.length > RELAY_MAX_BYTES) throw new UserError('That photo is too big to add from here.');
    const type = photoType(bytes);
    if (!type) throw new UserError("That isn't a photo ServiceM8 can take.");
    const name = fileName(args.name, 'Photo.jpg');
    await uploadFile(event, jobUUID, name, bytes, type);
    log('info', 'Added photo to job', { accountUUID: event.auth.accountUUID, jobUUID, bytes: bytes.length, relayed: true });
    return { name };
}

// cspell:ignore ftyp isom heix heim heis hevx
/** HEIF brands used by photos (a video's ftyp box has others, e.g. qt, isom, mp42). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
/** AVIF brands (still and animated). Looked for in the whole brand list: AVIF files can lead with mif1. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** A photo's type from its first bytes: the browser's own type can be missing (often for HEIC) or wrong. */
export function photoType(bytes: Buffer): string | null {
    const ascii = (from: number, to: number) => bytes.subarray(from, to).toString('latin1');
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (ascii(0, 4) === '\x89PNG') return 'image/png';
    if (ascii(0, 4) === 'GIF8') return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(4, 8) === 'ftyp') {
        // The ftyp box: size, 'ftyp', major brand, minor version, then compatible brands.
        const end = Math.min(bytes.readUInt32BE(0), bytes.length);
        const brands = [ascii(8, 12)];
        for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(i, i + 4));
        if (brands.some((b) => AVIF_BRANDS.has(b))) return 'image/avif';
        if (HEIF_BRANDS.has(brands[0] ?? '')) return 'image/heic';
    }
    return null;
}

/** A name a file can have (from the popup, so not trusted), or the fallback. */
const fileName = (name: unknown, fallback: string): string => (str(name) ?? fallback).replaceAll(/[\\/:*?"<>|\p{Cc}]+/gu, '_').slice(0, 120);
