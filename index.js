'use strict';

/*
 * Photos to PDF: a ServiceM8-hosted add-on function (Node.js 24, no runtime dependencies), deployed with Addon Kit.
 *
 * The job card's "Photos to PDF" button: the job diary's photos are put into PDFs of a set number of
 * photos each (one photo per page, filling it, nothing else), and the PDFs are saved back to the job
 * diary as that staff member. Photos can be left out, moved between PDFs and reordered (a PDF can go
 * over the number; it's only a warning). Photos aren't shrunk: JPEGs go in as they are, other photos
 * as full-size JPEGs. Photos can also be added from the device (library, camera or files): they go
 * on the end of the PDFs, and are added to the job diary as they're picked.
 *
 * The page does the image work in the browser (it can decode iPhone HEIC photos; this function
 * can't). It talks to the ServiceM8 API directly with the short-lived token ServiceM8 gives this
 * function. If the browser isn't allowed to (CORS), photos and the finished PDFs are passed through
 * this function instead via client.invoke(), which limits each PDF to ~3.5 MB (photos are then shrunk).
 *
 * Events:
 *   photos_to_pdf          button in addon.jsonc       -> the popup page
 *   photos_to_pdf_photos   invoked by the page         -> the job and its photos
 *   photos_to_pdf_token    invoked by the page         -> a fresh API token (they last 15 minutes)
 *   photos_to_pdf_photo    invoked by the page         -> one photo's bytes (when the browser can't fetch it)
 *   photos_to_pdf_save     invoked by the page         -> saves a PDF to the job diary (when the browser can't)
 *   photos_to_pdf_upload   invoked by the page         -> adds a photo from the device to the job diary (likewise)
 */

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
        job: { uuid: jobUUID, number: str(job.generated_job_id), workOrder: str(job.purchase_order_number) },
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
async function relayPhoto(event, args) {
    const uuid = needUuid(args.uuid, 'photo');
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    // .file redirects to the file's storage; the token mustn't follow it there.
    let res = await sm8(event, `/attachment/${uuid}.file`, { redirect: 'manual', headers: { accept: '*/*' } });
    const location = res.headers.get('location');
    if (location) res = await fetch(new URL(location, API), { headers: { range: `bytes=${offset}-${offset + RELAY_PIECE_BYTES - 1}` } });
    if (!res.ok) throw new Error(`Photo download ${res.status}`);
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

// ----- The popup page -----

const SHELL_CSS = `
/* ServiceM8's own look: its add-on stylesheet's (sdk.css) font, greys, inputs and buttons, and its green. */
:root { --brand: #7dc836; --brand-ink: #4e8a1e; --ink: #4d4d4d; --muted: #8c8c8c; --line: #d6dadc; --field: #edeff0; --field-line: #cdd2d4; --button: #e6e6e6; --button-ink: #636362; --empty: #e2e4e6; --empty-line: #c4c9cc; --surface: #fff; --surface-2: #f4f5f6; --danger: #eb5a46; }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px 12px 96px; font: 14px/1.4 'Open Sans', Arial, Helvetica, sans-serif; color: var(--ink); background: var(--surface); }
h1, h2 { font-weight: 600; }
h1 { font-size: 18px; margin: 0 0 2px; }
p { margin: 0; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: default; }
.muted { color: var(--muted); font-size: 13px; }
.danger { color: var(--danger); font-size: 13px; }
/* Buttons, as sdk.css draws them: grey and rounded, lighter with a frame on hover. */
.link, .per #resplit { padding: 4px 10px; border: 1px solid transparent; border-radius: 6px; background: var(--button); color: var(--button-ink); font-size: 12px; line-height: 20px; white-space: nowrap; }
.link:hover:not(:disabled), .per #resplit:hover:not(:disabled) { background: #fff4ff; border-color: #e4d5dc; border-bottom-color: #90a4b3; box-shadow: 0 1px 3px rgba(157, 174, 236, .5), inset 0 1px 0 #fff; }
.link:disabled, .per #resplit:disabled { background: var(--empty); color: var(--muted); }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 12px 0 8px; font-size: 14px; }
.bar:first-child { margin-top: 0; }
.bar .actions { display: flex; align-items: center; gap: 6px; flex: none; margin-left: auto; }
.ogrid { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-y; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.ph { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border: 0; border-radius: 6px; background: var(--field); }
.ph img { pointer-events: none; -webkit-user-drag: none; width: 100%; height: 100%; object-fit: cover; display: block; }
.ph .ph-msg { position: absolute; inset: 0; display: grid; place-items: center; padding: 4px; font-size: 11px; color: var(--muted); text-align: center; word-break: break-word; }
.tick { position: absolute; top: 6px; left: 6px; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; background: rgba(0, 0, 0, .35); color: #fff; font-size: 12px; line-height: 22px; text-align: center; }
.ph.on .tick { background: var(--brand); font-weight: 600; }
.groups .ph { cursor: grab; }
.ph.out img { opacity: .4; filter: grayscale(1); }
.ogrid li.placeholder .ph { opacity: .25; }
.ghost { position: fixed; z-index: 10; list-style: none; pointer-events: none; transform: scale(1.06); box-shadow: 0 8px 20px rgba(0, 0, 0, .35); border-radius: 6px; }
body.reordering, body.reordering * { cursor: grabbing !important; }
.dev { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; font-size: 10px; text-align: center; color: #fff; background: rgba(0, 0, 0, .55); }
.dev.failed { background: var(--danger); }
body.dropping .groups { outline: 2px dashed var(--brand); outline-offset: 4px; border-radius: 6px; }
.foot { position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 12px max(10px, env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
.foot .danger { margin-bottom: 6px; }
.per { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; flex-wrap: wrap; }
.per label { font-weight: 600; }
/* Inputs, as sdk.css draws them. */
.per input { width: 64px; padding: .4em .5em; border: 1px solid var(--field-line); border-radius: 3px; font: inherit; color: var(--ink); background: var(--surface); }
.per input:hover:not(:disabled) { border-color: #b6bbbf; }
.per input:focus { border-color: #a5acb0; outline: none; box-shadow: 0 0 6px var(--field-line); }
.per #over:not(:empty)::before { content: "·"; margin-right: 6px; color: var(--muted); }
.per #pdfs:empty + #over::before { content: none; }
.per #resplit { margin-left: auto; }
.per #resplit[hidden] { display: none; }
/* Each PDF is a panel, so it's clear which photos go together; "New PDF" and empty sections are dashed, like ServiceM8's empty lists. */
.group { margin: 0 0 12px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); }
.group h2 { font-size: 14px; margin: 0 0 8px; }
.group h2 .count { font-weight: normal; }
.group .ph:not(:has(img)) { background: var(--surface); }
.group.out .ph:not(:has(img)) { background: var(--field); }
.group.over { border-color: var(--danger); box-shadow: inset 0 0 0 1px var(--danger); }
.group.over h2 .count { color: var(--danger); }
.group.out { background: none; }
.group.out h2 { color: var(--muted); }
/* An empty section a photo's being dragged over (it goes in when let go): more specific than the dashed empty look. */
.group.target, .group.target:has(> .ogrid:empty) { border: 1px solid var(--brand); box-shadow: inset 0 0 0 1px var(--brand); background: rgba(125, 200, 54, .14); }
.group.target .ogrid:empty::after { content: "Let go to put it here"; color: var(--brand-ink); font-weight: 600; }
.group.new.target .ogrid:empty::after { content: "Let go to start a new PDF"; }
.group.out.target .ogrid:empty::after { content: "Let go to leave it out"; }
.ogrid:empty { min-height: 64px; align-items: center; }
.group:has(> .ogrid:empty) { background: none; border-style: dashed; border-color: var(--empty-line); }
.ogrid:empty::after { content: "Drag a photo here"; grid-column: 1 / -1; text-align: center; color: var(--muted); font-size: 13px; }
/* The main button: ServiceM8's green. */
.btn { width: 100%; padding: .6em 1.4em; border: 0; border-radius: 6px; background: var(--brand); color: #fff; font-size: 14px; font-weight: 600; line-height: 24px; }
.btn:hover:not(:disabled) { background: #73bb30; }
.btn:active:not(:disabled) { background: #6aad2b; }
.btn:disabled { background: var(--empty); color: var(--muted); }
.center { padding: 32px 0; text-align: center; }
.done { padding-top: 48px; animation: done-in .25s ease-out; }
.done-tick { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 28px; display: grid; place-items: center; background: var(--brand); color: #fff; }
.done-names { list-style: none; margin: 8px 0 0; padding: 0; line-height: 1.6; }
.done-reopen { margin-top: 18px; font-weight: 600; }
@keyframes done-in { from { opacity: 0; transform: translateY(6px); } }
`;

/** Text that's safe in HTML, attribute values included. */
const escapeHtml = (s) => s.replaceAll(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function shell(title, body, script) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<script src="https://platform.servicem8.com/sdk/1.0/sdk.js"></script>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap">
<style>${SHELL_CSS}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

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

/*
 * Everything below runs in the browser, not in this function: it's sent as the page's script
 * (via toString), so it can't use anything from the rest of this file.
 */
function photosToPdfPage(boot) {
    const API = 'https://api.servicem8.com/api_1.0';
    const client = window.SMClient.init();
    const app = document.getElementById('app');
    try {
        // As big as the screen comfortably allows (room for the browser's toolbars and the modal's
        // title), up to 1280 x 1000; this page can't see the size of ServiceM8's own page around it.
        const fit = (room, margin, most) => Math.round(Math.max(480, Math.min(most, (room || most) - margin)));
        client.resizeWindow(fit(screen.availWidth, 120, 1280), fit(screen.availHeight, 220, 1000));
    } catch {
        // Some ServiceM8 windows can't be resized; the page fits any size.
    }

    const esc = (s) => String(s ?? '').replaceAll(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const errText = (err) => err?.message || String(err);

    /** Call this function's server side; replies are JSON strings ({ error } when it failed). */
    async function call(eventName, args) {
        let raw = await client.invoke(eventName, { jobUUID: boot.jobUUID, ...args });
        if (raw && typeof raw === 'object' && 'eventResponse' in raw) raw = raw.eventResponse;
        let data = raw;
        if (typeof raw === 'string') {
            try {
                data = JSON.parse(raw);
            } catch {
                throw new Error('Photos to PDF sent back something unexpected. Please try again.');
            }
        }
        if (!data) throw new Error('Photos to PDF didn\'t respond. Please try again.');
        if (data.error) throw new Error(data.error);
        return data;
    }

    // ServiceM8 API tokens last 15 minutes; get a new one after 10.
    let token = boot.token;
    let tokenAt = Date.now();
    let refreshing = null; // photos load a few at a time: they share one refresh
    async function apiToken(force) {
        if (force || Date.now() - tokenAt > 10 * 60 * 1000) {
            refreshing ??= call('photos_to_pdf_token')
                .then((got) => {
                    token = got.token;
                    tokenAt = Date.now();
                })
                .finally(() => {
                    refreshing = null;
                });
            await refreshing;
        }
        return token;
    }
    /** The ServiceM8 API, straight from the browser. Throws a TypeError if the browser isn't allowed (CORS). */
    async function api(path, init, retried) {
        init = init || {};
        const t = await apiToken();
        const res = await fetch(API + path, { ...init, headers: { ...init.headers, authorization: 'Bearer ' + t } });
        if (res.status === 401 && !retried) {
            await apiToken(true);
            return api(path, init, true);
        }
        return res;
    }

    // ----- Photos to PDF -----

    async function photosToPdf() {
        app.innerHTML = `<p class="muted center">Loading the job's photos&hellip;</p>`;
        let data;
        try {
            data = await call('photos_to_pdf_photos');
        } catch (err) {
            app.innerHTML = `<p class="danger">${esc(errText(err))}</p>`;
            return;
        }
        token = data.token;
        tokenAt = Date.now();
        const { job, photos } = data;

        // Can this page reach ServiceM8 itself? Otherwise everything goes through the function.
        const direct = await api(`/job/${job.uuid}.json`).then((r) => r.ok, () => false);
        let directFiles = direct;

        const blobs = new Map(); // uuid -> Promise<Blob>
        /** How many photos go in each PDF. The staff member can change it; it's remembered on this device. */
        const MAX_PER_PDF = 500;
        const PER_PDF_KEY = 'photos-to-pdf:per-pdf';
        const perPdfFrom = (value) => {
            const n = Math.floor(Number(value));
            return n >= 1 ? Math.min(n, MAX_PER_PDF) : null;
        };
        let perPdf = 25;
        try {
            perPdf = perPdfFrom(localStorage.getItem(PER_PDF_KEY)) || perPdf;
        } catch {
            // No storage in this window: it starts at the default each time.
        }
        let state = { step: 'pick' };
        let error = null;

        async function fetchPhoto(p) {
            if (directFiles) {
                try {
                    const res = await api(`/attachment/${p.uuid}.file`);
                    if (res.ok) return await res.blob();
                    // Refused from here (e.g. where this photo is stored): the function may still get it.
                } catch (err) {
                    if (!(err instanceof TypeError)) throw err;
                    directFiles = false; // the file storage doesn't allow it; use the function from now on
                }
            }
            // Through the function, a piece at a time (its replies are capped at 6 MB), each after the one before.
            const pieces = [];
            async function piece(offset) {
                const got = await call('photos_to_pdf_photo', { uuid: p.uuid, offset });
                const bytes = latin1(atob(got.data));
                pieces.push(bytes);
                const next = offset + bytes.length;
                if (next >= got.size) return got.type;
                if (!bytes.length) throw new Error('The photo stopped part way through.');
                return piece(next);
            }
            const type = await piece(0);
            return new Blob(pieces, { type });
        }

        // A few photos at a time, so thumbnails don't swamp the connection.
        const waiting = [];
        let running = 0;
        function photoBlob(p) {
            if (p.file) return Promise.resolve(p.file); // from this device
            if (!blobs.has(p.uuid)) {
                const promise = new Promise((resolve, reject) => waiting.push(() => fetchPhoto(p).then(resolve, reject)));
                blobs.set(p.uuid, promise);
                promise.catch(() => blobs.delete(p.uuid)); // try again next time
                pump();
            }
            return blobs.get(p.uuid);
        }
        function pump() {
            while (running < 3 && waiting.length) {
                running++;
                waiting.shift()().finally(() => {
                    running--;
                    pump();
                });
            }
        }

        // ----- Photos from this device: added to the end of the PDFs, and to the job diary -----

        let deviceCount = 0;
        let diaryQueue = Promise.resolve(); // one upload at a time
        const isImage = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|avif|webp|gif)$/i.test(f.name);
        const DIARY_LABEL = { saving: 'Adding to diary…', saved: 'Added to diary', failed: 'Not added to diary' };

        function addFiles(files) {
            const added = Array.from(files).filter(isImage);
            if (!added.length || busy()) return;
            const uuids = added.map((file) => {
                const p = { uuid: `device-${++deviceCount}`, name: file.name || `Photo ${deviceCount}.jpg`, file, diary: 'saving' };
                photos.push(p);
                void addToDiary(p); // it records its own failures on the tile
                return p.uuid;
            });
            putBack(uuids);
            render();
            // Show the new ones.
            const last = app.querySelector(`.ph[data-i="${photos.length - 1}"]`);
            if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        function addToDiary(p) {
            p.diary = 'saving';
            diaryQueue = diaryQueue.then(async () => {
                try {
                    await uploadAttachment(p.name, p.file, 'photo');
                    p.diary = 'saved';
                } catch {
                    // Shown on the tile; finishDiary() tries it again when the PDF is saved.
                    p.diary = 'failed';
                }
                update();
            });
            return diaryQueue;
        }

        /** Device photos still uploading (and failed ones, tried again) before the popup can be closed. */
        async function finishDiary() {
            photos.filter((p) => p.diary === 'failed').forEach(addToDiary);
            await diaryQueue;
            return photos.filter((p) => p.diary === 'failed').map((p) => p.name);
        }

        const caption = (p) => [p.name, p.timestamp?.slice(0, 16)].filter(Boolean).join('\n');
        const busy = () => ['diary', 'making', 'saving'].includes(state.step);
        const byUuid = (uuid) => photos.find((p) => p.uuid === uuid);

        /**
         * The PDFs: each a list of photo uuids, in page order. Every photo starts in one, split into PDFs
         * of perPdf photos; any not in a PDF are left out. Until photos are dragged about, leaving one out
         * or putting one back splits them again, so the PDFs stay full. After that, the PDFs are kept as
         * arranged, and one can have more than perPdf photos: it's shown as over the limit, but saved as it is.
         */
        const split = (uuids) => {
            const out = [];
            for (let k = 0; k < uuids.length; k += perPdf) out.push(uuids.slice(k, k + perPdf));
            return out;
        };
        let groups = split(photos.map((p) => p.uuid));
        /** Whether the PDFs are just the photos split evenly (nothing's been dragged about). */
        const even = () => groups.every((g, k) => (k < groups.length - 1 ? g.length === perPdf : g.length <= perPdf));
        const leftOut = () => {
            const kept = new Set(groups.flat());
            return photos.filter((p) => !kept.has(p.uuid));
        };

        /** Changes which photos are in the PDFs, splitting them again if they were split evenly. */
        function regroup(change) {
            const wasEven = even();
            change();
            groups = groups.filter((g) => g.length);
            if (wasEven) groups = split(groups.flat());
        }
        function leaveOut(uuid) {
            regroup(() => {
                for (const g of groups) if (g.includes(uuid)) g.splice(g.indexOf(uuid), 1);
            });
        }
        /** Back in, at the end: in the last PDF if it has room, otherwise in a new one. */
        function putBack(uuids) {
            regroup(() => {
                for (const uuid of uuids) {
                    const last = groups.at(-1);
                    if (last && last.length < perPdf) last.push(uuid);
                    else groups.push([uuid]);
                }
            });
        }

        /** A new number of photos per PDF. Nothing moves ("Split into PDFs of…" does that): it's the limit PDFs are checked against. */
        function setPerPdf(n) {
            perPdf = n;
            try {
                localStorage.setItem(PER_PDF_KEY, String(n));
            } catch {
                // Not remembered next time; it still applies now.
            }
        }

        function render() {
            if (state.step === 'saved') renderSaved();
            else renderPick();
            fitFoot();
        }

        /** Saved: what was saved, anything that didn't work, and Done to close (ServiceM8 can't refresh the open job's diary). */
        function renderSaved() {
            const { pdfs } = state;
            const saved = pdfs.length === 1 ? 'PDF saved' : `${pdfs.length} PDFs saved`;
            app.innerHTML = `
      <div class="center done">
        <div class="done-tick" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
        <h1>${saved} to the job diary</h1>
        <ul class="done-names muted">${pdfs.map((pdf) => `<li>${esc(pdf.name)}</li>`).join('')}</ul>
        <p class="done-reopen">Reopen the job to see ${pdfs.length === 1 ? 'it' : 'them'} in the job diary.</p>
      </div>
      <div class="foot">
        ${state.shrunk ? `<p class="muted">This device can't send files straight to ServiceM8, so the photos were made smaller to fit.</p>` : ''}
        ${state.failed.length ? `<p class="danger">Left out (couldn't be read): ${esc(state.failed.join(', '))}</p>` : ''}
        ${state.notInDiary.length ? `<p class="danger">Couldn't add to the job diary (they're still in the PDFs): ${esc(state.notInDiary.join(', '))}</p>` : ''}
        <button class="btn" id="done">Done</button>
      </div>`;
            app.querySelector('#done').onclick = () => client.closeWindow();
        }

        /** The photos, in their PDFs ("New PDF" to start another), then the ones left out. */
        function renderPick() {
            const hint = photos.length ? '' : 'No photos on this job yet. Add some from this device.';
            app.innerHTML = `
      <div class="bar">
        <span class="muted">${hint}</span>
        <span class="actions">
          <button class="link" id="none">Leave all out</button>
          <button class="link" id="every">Put all back</button>
          <button class="link" id="add-photos" title="Add photos from this device. They're added to the job diary too.">+ Add photos</button>
          <input type="file" id="add" accept="image/*" multiple hidden>
        </span>
      </div>
      ${photos.length ? '<div class="groups"></div>' : ''}
      <div class="foot">
        <div class="per">
          <label for="per">Photos per PDF</label>
          <input type="number" id="per" min="1" max="${MAX_PER_PDF}" step="1" inputmode="numeric" value="${perPdf}">
          <span class="muted" id="pdfs"></span><span class="danger" id="over"></span>
          <button id="resplit" title="Puts the photos in PDFs of this many each, keeping their order"></button>
        </div>
        <p class="danger" id="error" hidden></p>
        <button class="btn" id="save"></button>
      </div>`;
            app.querySelector('#none').onclick = () => {
                groups = [];
                drawGroups();
            };
            app.querySelector('#every').onclick = () => {
                putBack(leftOut().map((p) => p.uuid));
                drawGroups();
            };
            const per = app.querySelector('#per');
            per.oninput = () => {
                const n = perPdfFrom(per.value);
                if (!n || n === perPdf) return; // e.g. cleared to type a new number
                setPerPdf(n);
                drawGroups();
            };
            per.onblur = () => {
                per.value = perPdf;
            };
            app.querySelector('#resplit').onclick = () => {
                groups = split(groups.flat());
                drawGroups();
            };
            app.querySelector('#save').onclick = save;
            const add = app.querySelector('#add');
            app.querySelector('#add-photos').onclick = () => add.click();
            add.onchange = (e) => {
                addFiles(e.target.files);
                e.target.value = '';
            };
            drawGroups();
        }

        /**
         * The photos, in their PDFs ("New PDF" to start another), then the ones left out. Redrawn on
         * its own when they change, so the rest of the page (e.g. "Photos per PDF" being typed in) isn't.
         */
        function drawGroups() {
            const old = app.querySelector('.groups');
            if (old) {
                const tile = (p) => `<li data-u="${esc(p.uuid)}"><button class="ph" data-i="${photos.indexOf(p)}" title="${esc(caption(p))}">
              <span class="ph-msg">Loading…</span>${p.file ? '<span class="dev"></span>' : ''}
            </button></li>`;
                // An empty list mustn't hold even whitespace, or it isn't :empty (its "Drag a photo here").
                const section = (kind, title, list) => `<section class="group ${kind}">
          <h2>${title} <span class="count muted"></span></h2>
          <ul class="ogrid">${list.map(tile).join('')}</ul>
        </section>`;
                const wrap = document.createElement('div');
                wrap.className = 'groups';
                wrap.innerHTML = [
                    ...groups.map((g, gi) => section('pdf', `PDF ${gi + 1}`, g.map(byUuid))),
                    section('pdf new', 'New PDF', []),
                    section('out', 'Left out', leftOut()),
                ].join('');
                old.replaceWith(wrap);
                arrangeable(wrap);
                wrap.querySelectorAll('.ph').forEach((el) => thumb(el, photos[+el.dataset.i]));
            }
            update();
        }

        /** Room at the bottom of the page for the fixed footer, so it never covers the last row or page. */
        function fitFoot() {
            const foot = app.querySelector('.foot');
            document.body.style.paddingBottom = `${(foot ? foot.offsetHeight : 0) + 12}px`;
        }

        /** Brings the picker up to date without redrawing it (so thumbnails and drags carry on). */
        function update() {
            const btn = app.querySelector('#save');
            if (!btn) return; // not the picker
            const n = groups.flat().length;
            app.querySelectorAll('.ph').forEach((el) => {
                el.disabled = busy();
                const dev = el.querySelector('.dev');
                if (dev) {
                    const p = photos[+el.dataset.i];
                    dev.textContent = DIARY_LABEL[p.diary];
                    dev.className = `dev ${p.diary}`;
                }
            });
            for (const id of ['#add-photos', '#none', '#every', '#per', '#resplit']) app.querySelector(id).disabled = busy();
            const resplit = app.querySelector('#resplit');
            resplit.hidden = even();
            resplit.textContent = `Split into PDFs of ${perPdf}`;
            app.querySelector('#none').hidden = !n;
            app.querySelector('#every').hidden = n === photos.length;
            const over = groups.filter((g) => g.length > perPdf).length;
            const pdfs = groups.length === 1 ? '1 PDF' : `${groups.length} PDFs`;
            app.querySelector('#pdfs').textContent = n ? pdfs : '';
            app.querySelector('#over').textContent = over ? `${over} over the limit` : '';
            const err = app.querySelector('#error');
            err.hidden = !error;
            err.textContent = error || '';
            fitFoot();
            btn.disabled = !n || busy();
            btn.textContent = saveLabel(n, groups.length);
        }

        function saveLabel(n, pdfs) {
            const which = state.of > 1 ? ` ${state.pdf + 1} of ${state.of}` : '';
            if (state.step === 'making') return `Making PDF${which}: photo ${Math.min(state.done + 1, state.n)} of ${state.n}…`;
            if (state.step === 'diary') return 'Adding photos to the job diary…';
            if (state.step === 'saving') return `Saving PDF${which} to the job diary…`;
            if (!n) return 'Every photo is left out';
            const count = `${n} ${n === 1 ? 'photo' : 'photos'}`;
            return pdfs === 1 ? `Save PDF of ${count} to job diary` : `Save ${pdfs} PDFs (${count}) to job diary`;
        }

        // Image files dropped anywhere on the picker are added like "Add photos".
        const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        document.addEventListener('dragover', (e) => {
            if (!hasFiles(e) || !app.querySelector('#save') || busy()) return;
            e.preventDefault();
            document.body.classList.add('dropping');
        });
        document.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget) document.body.classList.remove('dropping');
        });
        document.addEventListener('drop', (e) => {
            document.body.classList.remove('dropping');
            if (!hasFiles(e) || !app.querySelector('#save')) return;
            e.preventDefault();
            addFiles(e.dataTransfer.files);
        });

        /** How far to scroll while the pointer is held within `margin` px of the top or bottom (above the footer). */
        function edgeStep(y, margin, speed) {
            const bottomEdge = innerHeight - (app.querySelector('.foot')?.offsetHeight ?? 0);
            if (y > bottomEdge - margin) return speed;
            if (y < margin) return -speed;
            return 0;
        }

        /** Page numbers and counts as photos move about, and which PDFs are over the limit. */
        function renumber(wrap) {
            for (const section of wrap.querySelectorAll('.group')) {
                const items = Array.from(section.querySelectorAll('.ogrid > li'));
                const inPdf = section.classList.contains('pdf');
                for (const [k, li] of items.entries()) markTile(li.firstElementChild, inPdf ? k + 1 : null);
                const over = inPdf && items.length > perPdf;
                section.classList.toggle('over', over);
                let count = '';
                if (inPdf && items.length) count = `${items.length} of ${perPdf}${over ? ', over the limit' : ''}`;
                else if (items.length) count = String(items.length);
                section.querySelector('.count').textContent = count;
            }
        }

        /** A photo in a PDF shows its page number; a left out one is greyed. */
        function markTile(el, page) {
            el.classList.toggle('on', page !== null);
            el.classList.toggle('out', page === null);
            let tick = el.querySelector('.tick');
            if (page === null) {
                tick?.remove();
                return;
            }
            if (!tick) {
                tick = document.createElement('span');
                tick.className = 'tick';
                el.append(tick);
            }
            tick.textContent = page;
        }

        /**
         * Tap or click a photo to leave it out, or to put it back. Drag one to where it should go: a new
         * spot in its PDF, another PDF, "New PDF" or "Left out"; the others move out of the way. With a
         * mouse, dragging is enough; on touch screens, press and hold first (moving straight away scrolls).
         */
        function arrangeable(wrap) {
            let drag = null;
            let dragged = false; // the click that ends a drag isn't a tap
            const uuidsIn = (ul) => Array.from(ul.children, (li) => li.dataset.u);
            renumber(wrap);

            wrap.addEventListener('click', (e) => {
                const el = e.target.closest('.ph');
                if (!el || busy()) return;
                if (dragged) {
                    dragged = false;
                    return;
                }
                const uuid = el.parentElement.dataset.u;
                if (el.classList.contains('out')) putBack([uuid]);
                else leaveOut(uuid);
                drawGroups();
            });
            wrap.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menus
            // Once a photo's lifted, a finger moving mustn't scroll the page.
            wrap.addEventListener(
                'touchmove',
                (e) => {
                    if (drag?.lifted) e.preventDefault();
                },
                { passive: false },
            );

            wrap.addEventListener('pointerdown', (e) => {
                const li = e.target.closest('li');
                // One photo at a time: a second finger mustn't strand the first one's ghost.
                if (!li || e.button > 0 || drag || busy()) return;
                dragged = false;
                drag = { li, id: e.pointerId, mouse: e.pointerType === 'mouse', x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, lifted: false };
                if (!drag.mouse) drag.timer = setTimeout(lift, 300);
            });
            wrap.addEventListener('pointermove', (e) => {
                if (!drag || e.pointerId !== drag.id) return;
                drag.cx = e.clientX;
                drag.cy = e.clientY;
                if (!drag.lifted) {
                    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
                    if (!drag.mouse) {
                        drop(); // a finger moving straight away is scrolling
                        return;
                    }
                    lift(); // with a mouse, dragging is enough
                }
                follow();
            });
            const end = (e) => {
                if (drag && e.pointerId === drag.id) drop();
            };
            wrap.addEventListener('pointerup', end);
            wrap.addEventListener('pointercancel', end);

            function lift() {
                if (!drag || drag.lifted) return;
                drag.lifted = true;
                // Captured only once it's lifted: a tap must stay a click on its photo.
                try {
                    wrap.setPointerCapture(drag.id);
                } catch {
                    // Without capture the drag just ends if the pointer leaves the photos.
                }
                // Sections can grow while a photo's dragged about, but not shrink until it's dropped (the
                // redraw then), so a photo leaving one doesn't pull everything below up under the pointer.
                for (const ul of wrap.querySelectorAll('.ogrid')) ul.style.minHeight = `${ul.offsetHeight}px`;
                const r = drag.li.getBoundingClientRect();
                drag.offX = drag.cx - r.left;
                drag.offY = drag.cy - r.top;
                drag.ghost = drag.li.cloneNode(true);
                drag.ghost.className = 'ghost';
                Object.assign(drag.ghost.style, { width: `${r.width}px`, height: `${r.height}px` });
                document.body.appendChild(drag.ghost);
                drag.li.classList.add('placeholder');
                document.body.classList.add('reordering');
                if (navigator.vibrate) navigator.vibrate(10);
                follow();
                edgeScroll();
            }

            /** Ghost under the pointer; the photo's spot moves to wherever it's over. */
            function follow() {
                drag.ghost.style.left = `${drag.cx - drag.offX}px`;
                drag.ghost.style.top = `${drag.cy - drag.offY}px`;
                const over = document.elementFromPoint(drag.cx, drag.cy);
                const ul = over?.closest('.ogrid');
                target(null);
                if (!ul || !wrap.contains(ul)) return;
                // An empty section ("New PDF") lights up instead of taking the photo's spot: growing, it
                // would push everything below it down while the photo's only passing over.
                if (!ul.children.length) return target(ul);
                if (!moveTo(ul, over.closest('li'))) return;
                renumber(wrap);
            }

            /** The empty section the photo goes into if it's dropped now (null: wherever its spot is). */
            function target(ul) {
                drag.target = ul;
                wrap.querySelectorAll('.group.target').forEach((el) => el.classList.remove('target'));
                ul?.parentElement.classList.add('target');
            }

            /** Moves the dragged photo onto `target`'s spot in `ul`, or past the last photo. False if it didn't move. */
            function moveTo(ul, target) {
                if (target === drag.li) return false;
                if (target) {
                    const list = Array.from(ul.children);
                    const later = list.includes(drag.li) && list.indexOf(drag.li) < list.indexOf(target);
                    ul.insertBefore(drag.li, later ? target.nextSibling : target);
                    return true;
                }
                // Between photos isn't a spot (it'd jump about); after the last one, or an empty list, is.
                const last = ul.lastElementChild;
                if (last === drag.li) return false;
                if (last) {
                    const r = last.getBoundingClientRect();
                    if (!(drag.cy > r.bottom || (drag.cy >= r.top && drag.cx > r.right))) return false;
                }
                ul.appendChild(drag.li);
                return true;
            }

            // Holding near the top or bottom scrolls, for long lists.
            function edgeScroll() {
                if (!drag?.lifted) return;
                const step = edgeStep(drag.cy, 40, 12);
                if (step) {
                    const before = scrollY;
                    scrollBy(0, step);
                    if (scrollY !== before) follow();
                }
                requestAnimationFrame(edgeScroll);
            }

            function drop() {
                if (!drag) return;
                clearTimeout(drag.timer);
                const lifted = drag.lifted;
                if (lifted) {
                    drag.ghost.remove();
                    drag.li.classList.remove('placeholder');
                    document.body.classList.remove('reordering');
                    if (drag.target) drag.target.appendChild(drag.li);
                }
                drag = null;
                if (!lifted) return;
                dragged = true;
                groups = Array.from(wrap.querySelectorAll('.pdf .ogrid'), uuidsIn).filter((g) => g.length);
                // Redrawn once the drag's click has gone by: to number the PDFs, and for a fresh "New PDF".
                setTimeout(drawGroups);
            }
        }

        // Thumbnails load as they scroll into view.
        const urls = new Map(); // uuid -> object URL
        const observer = 'IntersectionObserver' in window ? new IntersectionObserver(onSeen, { rootMargin: '200px' }) : null;
        function thumb(el, p) {
            if (urls.has(p.uuid)) return showThumb(el, p);
            if (observer) observer.observe(el);
            else loadThumb(p);
        }
        function onSeen(entries) {
            entries.forEach((e) => {
                if (!e.isIntersecting) return;
                observer.unobserve(e.target);
                loadThumb(photos[+e.target.dataset.i]);
            });
        }
        function loadThumb(p) {
            photoBlob(p).then(
                (blob) => {
                    if (!urls.has(p.uuid)) urls.set(p.uuid, URL.createObjectURL(blob));
                    // The grid may have been redrawn while it loaded.
                    const now = app.querySelector(`.ph[data-i="${photos.indexOf(p)}"]`);
                    if (now) showThumb(now, p);
                },
                (err) => {
                    const now = app.querySelector(`.ph[data-i="${photos.indexOf(p)}"]`);
                    const msg = now?.querySelector('.ph-msg');
                    if (msg) msg.textContent = "Couldn't load";
                    if (now) now.title = `${caption(p)}\n${errText(err)}`; // why, on hover
                },
            );
        }
        function showThumb(el, p) {
            // A tile redrawn while its photo loaded is seen (and loaded) twice: show it once.
            if (el.querySelector('img')) return;
            const img = new Image();
            img.alt = p.name;
            img.draggable = false;
            img.src = urls.get(p.uuid);
            // Photos this browser can't show (e.g. HEIC outside Safari) keep their name instead.
            img.onerror = () => {
                img.remove();
                const msg = el.querySelector('.ph-msg');
                if (msg) msg.textContent = p.name;
            };
            img.onload = () => el.querySelector('.ph-msg')?.remove();
            el.prepend(img);
        }

        /** PDFs saved by a save that then failed (photo uuids -> what was saved): saving again skips them. */
        const savedBefore = new Map();

        /** Makes and saves each PDF in turn, so only one is ever held in memory. */
        async function save() {
            error = null;
            const list = groups.map((g) => g.map(byUuid));
            const workOrder = job.workOrder ? ` WO ${job.workOrder}` : '';
            const base = `Job ${job.number || job.uuid.slice(0, 8)}${workOrder} photos`.replaceAll(/[\\/:*?"<>|]+/g, '_');
            // Straight to ServiceM8, photos go in full size. Through the function, each PDF has to fit its payload limit.
            const maxBytes = direct ? Infinity : RELAY_MAX;
            const pdfs = [];
            const failed = [];
            let gi = 0;
            // One PDF at a time, each starting when the one before is saved.
            async function next() {
                if (gi >= list.length) return;
                const saved = savedBefore.get(list[gi].map((p) => p.uuid).join()) || (await savePdf(list, gi, base, maxBytes));
                failed.push(...saved.failed);
                if (saved.pages.length) pdfs.push(saved); // otherwise none of its photos could be read
                gi++;
                await next();
            }
            try {
                // Photos added from this device go in the job diary before the PDFs do.
                state = { step: 'diary' };
                update();
                const notInDiary = await finishDiary();
                await next();
                if (!pdfs.length) throw new Error('None of the photos could be read on this device.');
                savedBefore.clear();
                state = { step: 'saved', pdfs, failed, notInDiary, shrunk: !direct };
                render();
            } catch (err) {
                const which = list.length > 1 && gi < list.length ? `PDF ${gi + 1} of ${list.length} wasn't saved. ` : '';
                const done = pdfs.length === 1 ? 'the one' : `the ${pdfs.length}`;
                const kept = pdfs.length ? ` Saving again skips ${done} already saved.` : '';
                error = which + errText(err) + kept;
                state = { step: 'pick' };
                update();
            }
        }

        /** Makes PDF number `gi` of `list` and adds it to the job diary. */
        async function savePdf(list, gi, base, maxBytes) {
            const photosIn = list[gi];
            const progress = (done) => {
                state = { step: 'making', pdf: gi, of: list.length, n: photosIn.length, done };
                update();
            };
            progress(0);
            const pdf = await photosPdf(photosIn, maxBytes, progress);
            const saved = { name: list.length > 1 ? `${base} (${gi + 1} of ${list.length}).pdf` : `${base}.pdf`, pages: pdf.pages, failed: pdf.failed };
            if (pdf.pages.length) {
                state = { step: 'saving', pdf: gi, of: list.length };
                update();
                saved.name = await uploadAttachment(saved.name, pdf.blob, 'pdf');
            }
            savedBefore.set(photosIn.map((p) => p.uuid).join(), saved);
            return saved;
        }

        /** Adds a file (a PDF, or a photo from this device) to the job diary as this staff member. */
        async function uploadAttachment(name, blob, kind) {
            // Straight to ServiceM8 if the browser may; otherwise through the function, if it's small enough.
            if (direct && (await uploadDirect(name, blob, kind))) return name;
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

        /** Straight to ServiceM8. False if the browser isn't allowed (CORS); throws if ServiceM8 says no. */
        async function uploadDirect(name, blob, kind) {
            const send = (impersonate) => {
                const form = new FormData();
                form.set('related_object', 'job');
                form.set('related_object_uuid', job.uuid);
                form.set('attachment_name', name);
                form.set('file', blob, name);
                return api('/attachment.json', { method: 'POST', body: form, headers: impersonate ? { 'x-impersonate-uuid': impersonate } : {} });
            };
            let res;
            try {
                res = await send(boot.staffUUID);
                // Not every token may act as a staff member: save it as the add-on instead.
                if (boot.staffUUID && (res.status === 400 || res.status === 401 || res.status === 403)) res = await send(null);
            } catch (err) {
                if (err instanceof TypeError) return false;
                throw err;
            }
            if (res.ok) return true;
            throw new Error(`ServiceM8 didn't accept ${kind === 'pdf' ? 'the PDF' : 'the photo'} (${res.status}).`);
        }

        const base64 = (blob) =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const url = reader.result; // a data: URL, from readAsDataURL
                    resolve(url.slice(url.indexOf(',') + 1));
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
        /** What can go through the function (its payloads are capped at 6 MB, and this is base64'd). */
        const RELAY_MAX = 3.5 * 1024 * 1024;

        // ----- Making a PDF (one photo per page, full size) -----

        /**
         * Through the function, a PDF has to fit its payload limit: photos are then shrunk to fit, trying
         * these long edges (px) and JPEG qualities, best first, until each fits its share.
         */
        const STEPS = [
            [1600, 0.8],
            [1600, 0.65],
            [1400, 0.6],
            [1200, 0.55],
            [1000, 0.5],
            [800, 0.45],
            [640, 0.4],
            [480, 0.35],
        ];

        /** For a device photo's diary copy, when it has to be shrunk to go through the function. */
        const DIARY_STEPS = [
            [4032, 0.85],
            [3264, 0.82],
            [2560, 0.8],
            [2048, 0.75],
            [1600, 0.7],
        ];

        /** Photos that aren't JPEGs (HEIC, PNG, WebP…) go in a PDF as a full-size JPEG of this quality. */
        const FULL_SIZE = [[Infinity, 0.92]];
        /** The most pixels a canvas can have on iPhones: anything bigger is scaled down just enough to fit. */
        const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

        async function toJpeg(blob, budget, steps = STEPS) {
            const url = URL.createObjectURL(blob);
            const canvas = document.createElement('canvas');
            try {
                const img = new Image();
                img.src = url;
                await img.decode();
                // natural* already account for the photo's EXIF rotation.
                const w = img.naturalWidth;
                const h = img.naturalHeight;
                if (!w || !h) throw new Error('Empty image');
                let out = null;
                for (const [edge, quality] of steps) {
                    const scale = Math.min(1, edge / Math.max(w, h), Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
                    canvas.width = Math.round(w * scale);
                    canvas.height = Math.round(h * scale);
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff'; // transparent PNGs
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const jpeg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
                    if (!jpeg) throw new Error("Couldn't convert the photo");
                    out = { data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height };
                    if (out.data.length <= budget) break;
                }
                return out;
            } finally {
                URL.revokeObjectURL(url);
                // iOS keeps canvas memory until it's resized.
                canvas.width = canvas.height = 0;
            }
        }

        /**
         * A photo for a PDF page, not shrunk. A JPEG goes in as it is, its own bytes (the PDF turns it
         * the way its EXIF says); anything else becomes a full-size JPEG, as that's what PDFs can hold.
         */
        async function fullSize(blob) {
            const jpeg = await jpegInfo(blob);
            return jpeg ? { data: blob, ...jpeg } : toJpeg(blob, Infinity, FULL_SIZE);
        }

        /** A JPEG's pixel size, colours and EXIF orientation, if PDF readers can show it as it is (otherwise null). */
        async function jpegInfo(blob) {
            // The frame header comes before the image data, after the EXIF and other metadata.
            const b = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
            if (b[0] !== 0xff || b[1] !== 0xd8) return null;
            let orientation = 1;
            let i = 2;
            while (i + 4 <= b.length) {
                if (b[i] !== 0xff) return null;
                const marker = b[i + 1];
                if (marker === 0xff) {
                    i++; // padding
                    continue;
                }
                const length = (b[i + 2] << 8) | b[i + 3];
                if (marker === 0xe1) orientation = exifOrientation(b.subarray(i + 4, i + 2 + length)) || orientation;
                if (marker === 0xda || marker === 0xd9) return null; // image data, and no frame header before it
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                    // Baseline, extended or progressive, 8 bits, grey or colour: what every PDF reader shows.
                    const components = b[i + 9];
                    const height = (b[i + 5] << 8) | b[i + 6];
                    const width = (b[i + 7] << 8) | b[i + 8];
                    if (marker > 0xc2 || b[i + 4] !== 8 || (components !== 1 && components !== 3) || !width || !height) return null;
                    return { width, height, orientation, grey: components === 1 };
                }
                i += 2 + length;
            }
            return null;
        }

        /** The Orientation (1–8) in a JPEG's EXIF segment, or 0 if it hasn't one. */
        function exifOrientation(segment) {
            if (String.fromCodePoint(...segment.subarray(0, 6)) !== 'Exif\0\0') return 0;
            const tiff = new DataView(segment.buffer, segment.byteOffset + 6, segment.byteLength - 6);
            try {
                const little = tiff.getUint16(0) === 0x4949; // "II": Intel byte order
                const ifd = tiff.getUint32(4, little);
                const count = tiff.getUint16(ifd, little);
                for (let k = 0; k < count; k++) {
                    const entry = ifd + 2 + k * 12;
                    if (tiff.getUint16(entry, little) === 0x0112) {
                        const value = tiff.getUint16(entry + 8, little);
                        return value >= 1 && value <= 8 ? value : 0;
                    }
                }
            } catch {
                // Cut short or malformed: read as no rotation.
            }
            return 0;
        }

        /** A page's [width, height] as it's seen: EXIF orientations 5–8 turn the photo on its side. */
        const shape = (image) => (image.orientation >= 5 ? [image.height, image.width] : [image.width, image.height]);

        async function photosPdf(list, maxBytes, onProgress) {
            const shrink = maxBytes !== Infinity;
            const perPhoto = Math.min(1.2 * 1024 * 1024, maxBytes / 3);
            const pages = [];
            const failed = [];
            // The PDF's own structure (well under 1 KB a page) counts towards maxBytes too.
            let used = 1024 * (list.length + 1);
            // One photo at a time, each starting when the one before is done: a shrunk one's budget
            // depends on what those used, and doing several at once can run a phone out of memory.
            async function addPage(i) {
                if (i >= list.length) return;
                const p = list[i];
                // Fetch the next couple while this one's done.
                for (const next of list.slice(i + 1, i + 3)) photoBlob(next).catch(() => { });
                try {
                    const blob = await photoBlob(p);
                    // What's left of the budget, shared by the photos still to go.
                    const image = shrink ? await toJpeg(blob, Math.min(perPhoto, (maxBytes - used) / (list.length - i))) : await fullSize(blob);
                    used += image.data.size ?? image.data.length;
                    pages.push({ ...image, photo: p });
                } catch {
                    // One unreadable photo shouldn't stop the PDF: it's left out and listed when saved.
                    failed.push(p.name);
                }
                onProgress(i + 1);
                await addPage(i + 1);
            }
            await addPage(0);
            return { blob: pages.length ? writePdf(pages) : null, pages, failed };
        }

        const latin1 = (s) => Uint8Array.from(s, (c) => c.codePointAt(0));
        const num = (n) => n.toFixed(2);
        /** Pages are the photo's shape, with the long edge the length of A4 (in points). */
        const LONG_EDGE = 842;

        /**
         * Where each EXIF orientation puts the photo's pixels: a pixel x, y across and down the photo
         * (0–1, from its top left) is seen at X = ax·x + ay·y + a0, Y = bx·x + by·y + b0 on the page.
         */
        const ORIENTATIONS = {
            1: [1, 0, 0, 0, 1, 0],
            2: [-1, 0, 1, 0, 1, 0], // mirrored
            3: [-1, 0, 1, 0, -1, 1], // upside down
            4: [1, 0, 0, 0, -1, 1], // flipped
            5: [0, 1, 0, 1, 0, 0], // on its side, mirrored
            6: [0, -1, 1, 1, 0, 0], // turned a quarter clockwise to be seen
            7: [0, -1, 1, -1, 0, 1], // on its side, mirrored
            8: [0, 1, 0, -1, 0, 1], // turned a quarter anticlockwise to be seen
        };

        /** The matrix that draws a page's photo (PDF's unit square, y up) the right way round on a w × h page. */
        function placement(orientation, w, h) {
            const [ax, ay, a0, bx, by, b0] = ORIENTATIONS[orientation] || ORIENTATIONS[1];
            // The unit square's u, v is the photo's x = u, y = 1 - v; the page's y goes up.
            return [w * ax, -h * bx, -w * ay, h * by, w * (ay + a0), h * (1 - by - b0)];
        }

        /** One photo per page, filling it: nothing else on the page or in the file. */
        function writePdf(pages) {
            const parts = [];
            const offsets = [];
            let length = 0;
            // Strings, bytes, or a photo's own file (a Blob: it's never copied into memory).
            const put = (d) => {
                const part = typeof d === 'string' ? latin1(d) : d;
                parts.push(part);
                length += part instanceof Blob ? part.size : part.length;
            };
            const obj = (id, dict, stream) => {
                offsets[id] = length;
                put(`${id} 0 obj\n${dict}\n`);
                if (stream) {
                    put('stream\n');
                    put(stream);
                    put('\nendstream\n');
                }
                put('endobj\n');
            };

            // Objects: 1 catalog, 2 page tree, then page/contents/image for each photo.
            const pageId = (i) => 3 + i * 3;
            const size = pageId(pages.length);

            put('%PDF-1.4\n');
            put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary
            obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
            const kids = pages.map((_, i) => pageId(i) + ' 0 R').join(' ');
            obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

            pages.forEach((image, i) => {
                const id = pageId(i);
                const [w, h] = shape(image);
                const scale = LONG_EDGE / Math.max(w, h);
                const content = latin1(`q ${placement(image.orientation, w * scale, h * scale).map(num).join(' ')} cm /Im Do Q`);
                obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w * scale)} ${num(h * scale)}] /Resources << /XObject << /Im ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
                obj(id + 1, `<< /Length ${content.length} >>`, content);
                const bytes = image.data instanceof Blob ? image.data.size : image.data.length;
                obj(
                    id + 2,
                    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.grey ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes} >>`,
                    image.data,
                );
            });

            const xref = length;
            put(`xref\n0 ${size}\n0000000000 65535 f \n`);
            put(offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join(''));
            put(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
            return new Blob(parts, { type: 'application/pdf' });
        }


        render();
    }

    void photosToPdf();
}
