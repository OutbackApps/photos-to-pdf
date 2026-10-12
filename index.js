'use strict';

/*
 * Photos to PDF: a ServiceM8-hosted add-on function (Node.js 24, no runtime dependencies), deployed with Addon Kit.
 *
 * The job card's "Photos to PDF" button: the job diary's photos are put into PDFs of a set number of
 * photos each (one photo per page, filling it, nothing else), and the PDFs are saved back to the job
 * diary as that staff member. Photos can be left out, moved between PDFs and reordered (a PDF can go
 * over the number; it's only a warning). Photos are compressed a little (up to 2400px, JPEG quality
 * 0.8); small JPEGs go in as they are. Photos can also be added from the device (library, camera or
 * files): they go on the end of the PDFs, and are added to the job diary as they're picked.
 *
 * The page (page.js) does the image work in the browser (it can decode iPhone HEIC photos; this function
 * can't). It talks to the ServiceM8 API directly with the short-lived token ServiceM8 gives this
 * function. If the browser isn't allowed to (CORS), photos and the finished PDFs are passed through
 * this function instead via client.invoke(), which limits each PDF to ~3.5 MB (photos are then shrunk).
 *
 * Events:
 *   photos_to_pdf          button in addon.jsonc       -> the popup page
 *   photos_to_pdf_photos   invoked by the page         -> the job and its photos
 *   photos_to_pdf_token    invoked by the page         -> a fresh API token (they last 15 minutes)
 *   photos_to_pdf_photo_url invoked by the page        -> where a photo's stored, for the browser to fetch it from there
 *   photos_to_pdf_photo    invoked by the page         -> a piece of a photo (when the browser can't fetch it at all)
 *   photos_to_pdf_save     invoked by the page         -> saves a PDF to the job diary (when the browser can't)
 *   photos_to_pdf_upload   invoked by the page         -> adds a photo from the device to the job diary (likewise)
 */

const { shell, photosToPdfPage } = require('./page');

const API = 'https://api.servicem8.com/api_1.0';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_TYPES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff', '.avif']);
/** Function payloads are capped at 6 MB and relayed files are base64 (+33%). */
const RELAY_MAX_BYTES = 4 * 1024 * 1024;

exports.handler = async (event) => {
    const name = String(event.eventName || '').toLowerCase();
    const args = event.eventArgs || {};
    try {
        switch (name) {
            case 'photos_to_pdf':
                return { eventResponse: page(event) };
            case 'photos_to_pdf_photos':
                return reply(await jobPhotos(event, args.jobUUID));
            case 'photos_to_pdf_token':
                return reply({ token: event.auth.accessToken });
            case 'photos_to_pdf_photo_url':
                return reply(await photoUrl(event, args.uuid));
            case 'photos_to_pdf_photo':
                return reply(await relayPhoto(event, args));
            case 'photos_to_pdf_save':
                return reply(await relaySave(event, args));
            case 'photos_to_pdf_upload':
                return reply(await relayUpload(event, args));
            default:
                log('warn', 'Unknown event', { eventName: name });
                return {};
        }
    } catch (err) {
        const expected = err instanceof UserError;
        log(expected ? 'warn' : 'error', 'Event failed', { eventName: name, error: err.message, ...(expected ? {} : { stack: err.stack }) });
        const message = expected ? err.message : 'Something went wrong. Please try again.';
        return name === 'photos_to_pdf' ? { eventResponse: errorPage(message) } : reply({ error: message });
    }
};

// ----- Server side -----

class UserError extends Error { }

/** Structured JSON logs, one object per line (never log the event: it holds the access token). */
function log(level, message, context) {
    const line = JSON.stringify({ level, message, ...context });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

/** Replies to client.invoke() calls are JSON strings. */
const reply = (data) => ({ eventResponse: JSON.stringify(data) });

function needUuid(value, what) {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new UserError(`Missing or invalid ${what}.`);
    return value;
}

async function sm8(event, path, init = {}) {
    const res = await fetch(API + path, {
        ...init,
        headers: { authorization: `Bearer ${event.auth.accessToken}`, accept: 'application/json', ...init.headers },
    });
    if (res.ok || (init.redirect === 'manual' && res.status >= 300 && res.status < 400)) return res;
    log('warn', 'ServiceM8 API request failed', { path: path.split('?')[0], status: res.status });
    if (res.status === 401 || res.status === 403) {
        throw new UserError("Photos to PDF isn't allowed to do that in ServiceM8. Check the add-on is switched on and its permissions were accepted.");
    }
    if (res.status === 404) throw new UserError("That couldn't be found in ServiceM8.");
    throw new Error(`ServiceM8 API ${res.status} for ${path.split('?')[0]}`);
}

const sm8Json = (event, path) => sm8(event, path).then((res) => res.json());
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function jobPhotos(event, jobUUIDArg) {
    const jobUUID = needUuid(jobUUIDArg, 'job');
    const filter = encodeURIComponent(`related_object_uuid eq '${jobUUID}'`);
    const [job, attachments] = await Promise.all([sm8Json(event, `/job/${jobUUID}.json`), sm8Json(event, `/attachment.json?%24filter=${filter}`)]);

    const photos = attachments
        .filter((a) => String(a.active) === '1' && PHOTO_TYPES.has(String(a.file_type || '').toLowerCase()))
        .map((a) => ({ uuid: a.uuid, name: str(a.attachment_name) || 'Photo', timestamp: str(a.timestamp) }))
        .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    log('info', 'Listed job photos', { accountUUID: event.auth.accountUUID, jobUUID, photos: photos.length });
    return {
        job: { uuid: jobUUID, number: str(job.generated_job_id), poNumber: str(job.purchase_order_number) },
        photos,
        token: event.auth.accessToken,
    };
}

/** Photos come through the function in pieces this big: its replies are capped at 6 MB, and base64 adds a third. */
const RELAY_PIECE_BYTES = 3 * 1024 * 1024;

/**
 * A piece of a photo (from `offset`, and its whole size), for when the browser can't fetch it from
 * ServiceM8 itself. The page asks for the pieces in turn, so photos of any size come through.
 */
/**
 * Where a photo is stored, for the page to fetch itself: quicker than through this function, if the
 * storage lets the browser (null if ServiceM8 sends the photo itself, with no storage link).
 */
async function photoUrl(event, uuidArg) {
    const uuid = needUuid(uuidArg, 'photo');
    const res = await sm8(event, `/attachment/${uuid}.file`, { redirect: 'manual', headers: { accept: '*/*' } });
    const location = res.headers.get('location');
    void res.body?.cancel(); // only the redirect's wanted
    return { url: location ? new URL(location, API).href : null };
}

async function relayPhoto(event, args) {
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
    return { type: res.headers.get('content-type') || 'application/octet-stream', size, data: piece.subarray(0, RELAY_PIECE_BYTES).toString('base64') };
}

/** Saves a PDF to the job diary, for when the browser can't send it to ServiceM8 itself. */
async function relaySave(event, args) {
    const jobUUID = needUuid(args.jobUUID, 'job');
    const bytes = Buffer.from(String(args.data || ''), 'base64');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new UserError("That isn't a PDF.");
    const name = fileName(args.name, 'Photos.pdf');
    await uploadFile(event, jobUUID, name, bytes, 'application/pdf');
    log('info', 'Saved photos PDF', { accountUUID: event.auth.accountUUID, jobUUID, bytes: bytes.length, relayed: true });
    return { name };
}

/** Adds a photo from the staff member's device to the job diary, for when the browser can't send it itself. */
async function relayUpload(event, args) {
    const jobUUID = needUuid(args.jobUUID, 'job');
    const bytes = Buffer.from(String(args.data || ''), 'base64');
    if (bytes.length > RELAY_MAX_BYTES) throw new UserError('That photo is too big to add from here.');
    const type = photoType(bytes);
    if (!type) throw new UserError("That isn't a photo ServiceM8 can take.");
    const name = fileName(args.name, 'Photo.jpg');
    await uploadFile(event, jobUUID, name, bytes, type);
    log('info', 'Added photo to job', { accountUUID: event.auth.accountUUID, jobUUID, bytes: bytes.length, relayed: true });
    return { name };
}

/** HEIF brands used by photos (a video's ftyp box has others, e.g. qt, isom, mp42). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
/** AVIF brands (still and animated). Looked for in the whole brand list: AVIF files can lead with mif1. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** A photo's type from its first bytes: the browser's own type can be missing (often for HEIC) or wrong. */
function photoType(bytes) {
    const ascii = (from, to) => bytes.subarray(from, to).toString('latin1');
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
        if (HEIF_BRANDS.has(brands[0])) return 'image/heic';
    }
    return null;
}

const fileName = (name, fallback) => (str(name) || fallback).replaceAll(/[\\/:*?"<>|\p{Cc}]+/gu, '_').slice(0, 120);

/** Attach a file to the job diary as the staff member who clicked the button. */
async function uploadFile(event, jobUUID, name, bytes, type) {
    const send = (impersonate) => {
        const form = new FormData();
        form.set('related_object', 'job');
        form.set('related_object_uuid', jobUUID);
        form.set('attachment_name', name);
        form.set('file', new Blob([bytes], { type }), name);
        return fetch(`${API}/attachment.json`, {
            method: 'POST',
            headers: { authorization: `Bearer ${event.auth.accessToken}`, ...(impersonate ? { 'x-impersonate-uuid': impersonate } : {}) },
            body: form,
        });
    };
    const staffUUID = UUID_RE.test(event.auth.staffUUID || '') ? event.auth.staffUUID : null;
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

// ----- The popup page (page.js) -----

/** Text that's safe in HTML, attribute values included. */
const escapeHtml = (s) => s.replaceAll(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page(event) {
    const jobUUID = needUuid(event.eventArgs?.jobUUID, 'job');
    const boot = { jobUUID, staffUUID: event.auth.staffUUID || null, token: event.auth.accessToken };
    log('info', 'Opened Photos to PDF', { accountUUID: event.auth.accountUUID, jobUUID });
    // The page's data goes in an attribute, not the script, so it only needs HTML escaping.
    const app = `<div id="app" data-boot="${escapeHtml(JSON.stringify(boot))}"></div>`;
    return shell("Photos to PDF", app, `(${photosToPdfPage.toString()})(JSON.parse(document.getElementById('app').dataset.boot));`);
}

function errorPage(message) {
    return shell("Photos to PDF", `<h1>Photos to PDF</h1><p class="danger">${escapeHtml(message)}</p>`, '');
}
