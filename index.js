'use strict';

/*
 * Photos to PDF: a ServiceM8-hosted Simple Function add-on (Node.js 24, no dependencies).
 *
 * The job card's "Photos to PDF" button: tick photos from the job diary, they're put into one
 * PDF (one photo per page, filling it, nothing else) and the PDF is saved back to the job diary as
 * that staff member. Photos are shrunk to keep the PDF under the size picked (10, 5 or 2 MB).
 * Photos can also be added from the device (library, camera or files): they go into the grid,
 * selected, and are added to the job diary as they're picked.
 *
 * The page does the image work in the browser (it can decode iPhone HEIC photos; this function
 * can't). It talks to the ServiceM8 API directly with the short-lived token ServiceM8 gives this
 * function. If the browser isn't allowed to (CORS), photos and the finished PDF are passed through
 * this function instead via client.invoke(), which limits the PDF to ~3.5 MB.
 *
 * Events:
 *   photos_to_pdf          job card button (manifest)  -> the popup page
 *   photos_to_pdf_photos   invoked by the page         -> the job and its photos
 *   photos_to_pdf_token    invoked by the page         -> a fresh API token (they last 15 minutes)
 *   photos_to_pdf_photo    invoked by the page         -> one photo's bytes (when the browser can't fetch it)
 *   photos_to_pdf_save     invoked by the page         -> saves a PDF to the job diary (when the browser can't)
 *   photos_to_pdf_upload   invoked by the page         -> adds a photo from the device to the job diary (likewise)
 */

const API = 'https://api.servicem8.com/api_1.0';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_TYPES = new Set(['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff']);
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
                return reply(await relayPhoto(event, args.uuid));
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
        job: { uuid: jobUUID, number: str(job.generated_job_id), address: str(job.job_address) },
        photos,
        token: event.auth.accessToken,
    };
}

/** One photo's bytes, for when the browser can't fetch it from ServiceM8 itself. */
async function relayPhoto(event, uuidArg) {
    const uuid = needUuid(uuidArg, 'photo');
    // .file redirects to the file's storage; the token mustn't follow it there.
    let res = await sm8(event, `/attachment/${uuid}.file`, { redirect: 'manual', headers: { accept: '*/*' } });
    const location = res.headers.get('location');
    if (location) res = await fetch(new URL(location, API));
    if (!res.ok) throw new Error(`Photo download ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > RELAY_MAX_BYTES) throw new UserError('That photo is too big to load here.');
    return { type: res.headers.get('content-type') || 'application/octet-stream', data: bytes.toString('base64') };
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

/** A photo's type from its first bytes: the browser's own type can be missing (often for HEIC) or wrong. */
function photoType(bytes) {
    const ascii = (from, to) => bytes.subarray(from, to).toString('latin1');
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (ascii(0, 4) === '\x89PNG') return 'image/png';
    if (ascii(0, 4) === 'GIF8') return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'image/heic';
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
:root { --brand: #1f9d55; --brand-ink: #157a41; --ink: #1f2933; --muted: #6b7680; --line: #dde2e6; --surface: #fff; --surface-2: #f3f5f7; --danger: #c0392b; }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px 12px 96px; font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--surface); }
h1 { font-size: 18px; margin: 0 0 2px; }
p { margin: 0; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .6; }
.muted { color: var(--muted); font-size: 13px; }
.danger { color: var(--danger); font-size: 13px; }
.link { background: none; border: 0; padding: 0; color: var(--brand-ink); white-space: nowrap; }
.link:hover:not(:disabled) { text-decoration: underline; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 12px 0 8px; font-size: 14px; }
.grid, .ogrid { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-y; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.ph { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border: 3px solid transparent; border-radius: 8px; background: var(--surface-2); }
.ph.on { border-color: var(--brand); }
.marquee { position: absolute; z-index: 5; border: 1px solid var(--brand); background: rgba(31, 157, 85, .15); pointer-events: none; }
body.marqueeing { user-select: none; -webkit-user-select: none; cursor: default; }
.ph img { pointer-events: none; -webkit-user-drag: none; width: 100%; height: 100%; object-fit: cover; display: block; }
.ph .ph-msg { position: absolute; inset: 0; display: grid; place-items: center; padding: 4px; font-size: 11px; color: var(--muted); text-align: center; word-break: break-word; }
.tick { position: absolute; top: 6px; left: 6px; min-width: 22px; height: 22px; padding: 0 4px; border-radius: 11px; border: 2px solid rgba(255,255,255,.9); background: rgba(0,0,0,.3); color: #fff; font-size: 13px; line-height: 18px; text-align: center; }
.ph.on .tick { background: var(--brand); border-color: var(--brand); font-weight: 600; }
.ro { cursor: grab; }
.ogrid li.placeholder .ph { opacity: .25; }
.ghost { position: fixed; z-index: 10; list-style: none; pointer-events: none; transform: scale(1.06); box-shadow: 0 8px 20px rgba(0, 0, 0, .35); border-radius: 8px; }
body.reordering, body.reordering * { cursor: grabbing !important; }
.dev { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; font-size: 10px; text-align: center; color: #fff; background: rgba(0, 0, 0, .55); }
.dev.failed { background: var(--danger); }
.add-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; aspect-ratio: 1; border: 2px dashed var(--line); border-radius: 8px; color: var(--brand-ink); font-size: 13px; cursor: pointer; text-align: center; }
.add-tile:hover { background: var(--surface-2); }
.add-tile.disabled { opacity: .6; pointer-events: none; }
.add-tile .plus { font-size: 30px; line-height: 1; }
body.dropping .grid { outline: 2px dashed var(--brand); outline-offset: 4px; border-radius: 8px; }
.foot { position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 12px max(10px, env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
.foot .danger { margin-bottom: 6px; }
.sizes { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
.sizes .muted { margin-right: 2px; }
.size { padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; }
.size.on { border-color: var(--brand); background: var(--brand); color: #fff; }
.size input { position: absolute; opacity: 0; pointer-events: none; }
.btn { width: 100%; padding: 11px 14px; border: 0; border-radius: 8px; background: var(--brand); color: #fff; font-weight: 600; }
.btn.secondary { background: var(--surface-2); color: var(--ink); border: 1px solid var(--line); }
.btn.slim { width: auto; flex: none; white-space: nowrap; }
.viewer { padding: 12px; border-radius: 8px; background: #525659; display: grid; gap: 12px; justify-items: center; }
.viewer figure { margin: 0; width: 100%; max-width: 640px; }
.viewer img { display: block; width: 100%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .4); }
.viewer figcaption { margin-top: 4px; text-align: center; font-size: 11px; color: #dfe3e6; }
.foot .row { display: flex; gap: 8px; }
.foot .row .btn { padding-left: 8px; padding-right: 8px; }
.center { padding: 32px 0; text-align: center; }
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
        client.resizeWindow(820, 720);
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

        const selected = new Set();
        const blobs = new Map(); // uuid -> Promise<Blob>
        /** The PDF's size limit: the more photos, the more each is shrunk to fit. */
        let size = 'standard';
        const SIZES = {
            standard: { label: 'Up to 10 MB', bytes: 9.5 * 1024 * 1024 },
            small: { label: 'Up to 5 MB', bytes: 4.75 * 1024 * 1024 },
            smallest: { label: 'Up to 2 MB', bytes: 1.9 * 1024 * 1024 },
        };
        let state = { step: 'pick' };
        let error = null;

        async function fetchPhoto(p) {
            if (directFiles) {
                try {
                    const res = await api(`/attachment/${p.uuid}.file`);
                    if (!res.ok) throw new Error('Photo ' + res.status);
                    return await res.blob();
                } catch (err) {
                    if (!(err instanceof TypeError)) throw err;
                    directFiles = false; // the file storage doesn't allow it; use the function from now on
                }
            }
            const got = await call('photos_to_pdf_photo', { uuid: p.uuid });
            return new Blob([latin1(atob(got.data))], { type: got.type });
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

        // ----- Photos from this device: added to the grid (selected) and to the job diary -----

        let deviceCount = 0;
        let diaryQueue = Promise.resolve(); // one upload at a time
        const isImage = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name);
        const DIARY_LABEL = { saving: 'Adding to diary…', saved: 'Added to diary', failed: 'Not added to diary' };

        function addFiles(files) {
            const added = Array.from(files).filter(isImage);
            if (!added.length || busy()) return;
            added.forEach((file) => {
                const p = { uuid: `device-${++deviceCount}`, name: file.name || `Photo ${deviceCount}.jpg`, file, diary: 'saving' };
                photos.push(p);
                selected.add(p.uuid);
                void addToDiary(p); // it records its own failures on the tile
            });
            render();
            // Show the new ones.
            const last = app.querySelector('.grid li:last-child');
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
        const touchScreen = matchMedia('(pointer: coarse)').matches;
        const busy = () => state.step === 'making' || state.step === 'saving';

        /** PDF order (photo uuids). New selections go on the end; "Change order" rearranges it. */
        let order = [];
        let reordering = false;
        /** The selected photos, in PDF order. */
        function chosen() {
            const kept = order.filter((uuid) => selected.has(uuid));
            const known = new Set(kept);
            photos.forEach((p) => {
                if (selected.has(p.uuid) && !known.has(p.uuid)) kept.push(p.uuid);
            });
            order = kept;
            const byUuid = new Map(photos.map((p) => [p.uuid, p]));
            return order.map((uuid) => byUuid.get(uuid));
        }

        function render() {
            const header = `
        <h1>Job #${esc(job.number || '-')} photos</h1>
        <p class="muted">${esc(job.address || '')}</p>`;

            if (state.step === 'saved') {
                // The PDF, opened. Its pages are exactly these photos, so they're shown as the PDF has them
                // (ServiceM8's sandboxed popup can't reliably show the file itself in a PDF viewer).
                const { pages } = state;
                app.innerHTML = `
          <div class="viewer">
            ${pages.map((_, i) => `<figure><img class="pdf-page" data-p="${i}" alt="Page ${i + 1}"><figcaption>${i + 1} of ${pages.length}</figcaption></figure>`).join('')}
          </div>
          <div class="foot">
            ${state.failed.length ? `<p class="danger">Left out (couldn't be read): ${esc(state.failed.join(', '))}</p>` : ''}
            ${state.notInDiary.length ? `<p class="danger">Couldn't add to the job diary (they're still in the PDF): ${esc(state.notInDiary.join(', '))}</p>` : ''}
            <div class="row">
              <button class="btn secondary" id="again">Make another</button>
              <button class="btn" id="done">Done</button>
            </div>
          </div>`;
                const pageUrls = pages.map((jpeg) => URL.createObjectURL(new Blob([jpeg.data], { type: 'image/jpeg' })));
                app.querySelectorAll('.pdf-page').forEach((img) => {
                    const jpeg = pages[+img.dataset.p];
                    img.style.aspectRatio = `${jpeg.width} / ${jpeg.height}`;
                    img.src = pageUrls[+img.dataset.p];
                });
                app.querySelector('#done').onclick = () => client.closeWindow();
                // Back to the picker with the same photos, in the same order.
                app.querySelector('#again').onclick = () => {
                    pageUrls.forEach((u) => URL.revokeObjectURL(u));
                    state = { step: 'pick' };
                    render();
                };
            } else if (reordering) {
                const list = chosen();
                app.innerHTML = `${header}
          <div class="bar">
            <span class="muted">${touchScreen ? 'Press and hold' : 'Click and hold'} a photo, then drag it to a new spot. This is the order of the pages in the PDF.</span>
          </div>
          <ul class="ogrid">
            ${list
                        .map(
                            (p, k) => `<li data-u="${esc(p.uuid)}"><div class="ph on ro" data-i="${photos.indexOf(p)}" title="${esc(caption(p))}">
                  <span class="ph-msg">Loading…</span><span class="tick">${k + 1}</span>
                </div></li>`,
                        )
                        .join('')}
          </ul>
          <div class="foot"><button class="btn" id="order-done">Done</button></div>`;
                app.querySelector('#order-done').onclick = () => {
                    reordering = false;
                    render();
                };
                app.querySelectorAll('.ro').forEach((el) => thumb(el, photos[+el.dataset.i]));
                reorderable(app.querySelector('.ogrid'));
            } else {
                const several = touchScreen
                    ? 'Swipe sideways across photos to select several.'
                    : 'Drag a box around photos or shift-click to select several, or Ctrl+A for all.';
                const hint = photos.length ? `Tap photos to put them in the PDF, one per page. ${several}` : 'No photos on this job yet. Add some from this device.';
                app.innerHTML = `${header}
          <div class="bar">
            <span class="muted">${hint}</span>
            <button class="link" id="all" ${photos.length ? '' : 'hidden'}></button>
          </div>
          <ul class="grid">
            ${photos
                        .map(
                            (p, i) => `<li><button class="ph" data-i="${i}" title="${esc(caption(p))}">
                  <span class="ph-msg">Loading…</span><span class="tick"></span>${p.file ? '<span class="dev"></span>' : ''}
                </button></li>`,
                        )
                        .join('')}
            <li><label class="add-tile" title="Add photos from this device. They're added to the job diary too.">
              <input type="file" id="add" accept="image/*" multiple hidden>
              <span class="plus">+</span><span>Add photos</span>
            </label></li>
          </ul>
          <div class="foot">
            <div class="sizes">
              <span class="muted">PDF size</span>
              ${Object.entries(SIZES)
                        .map(([key, s]) => `<label class="size"><input type="radio" name="size" value="${key}">${s.label}</label>`)
                        .join('')}
            </div>
            <p class="danger" id="error" hidden></p>
            <div class="row">
              <button class="btn secondary slim" id="reorder">Change order</button>
              <button class="btn" id="save"></button>
            </div>
          </div>`;
                app.querySelector('#reorder').onclick = () => {
                    reordering = true;
                    render();
                    scrollTo(0, 0);
                };

                app.querySelector('#all').onclick = () => {
                    if (chosen().length === photos.length) selected.clear();
                    else photos.forEach((p) => selected.add(p.uuid));
                    update();
                };
                app.querySelectorAll('input[name="size"]').forEach((el) => {
                    el.onchange = () => {
                        size = el.value;
                        update();
                    };
                });
                app.querySelector('#save').onclick = save;
                app.querySelector('#add').onchange = (e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                };
                pickable(app.querySelector('.grid'));
                app.querySelectorAll('.ph').forEach((el) => thumb(el, photos[+el.dataset.i]));
                update();
            }
            fitFoot();
        }

        /** Room at the bottom of the page for the fixed footer, so it never covers the last row or page. */
        function fitFoot() {
            const foot = app.querySelector('.foot');
            document.body.style.paddingBottom = `${(foot ? foot.offsetHeight : 0) + 12}px`;
        }

        /** Brings the picker up to date without redrawing it (so thumbnails and drags carry on). */
        function update() {
            if (!app.querySelector('.grid')) return;
            const list = chosen();
            const n = list.length;
            const page = new Map(list.map((p, k) => [p.uuid, k + 1])); // each selected photo's page number
            app.querySelectorAll('.ph').forEach((el) => {
                const on = selected.has(photos[+el.dataset.i].uuid);
                el.classList.toggle('on', on);
                el.querySelector('.tick').textContent = on ? page.get(photos[+el.dataset.i].uuid) : '';
                el.disabled = busy();
                const dev = el.querySelector('.dev');
                if (dev) {
                    const p = photos[+el.dataset.i];
                    dev.textContent = DIARY_LABEL[p.diary];
                    dev.className = `dev ${p.diary}`;
                }
            });
            const add = app.querySelector('#add');
            add.disabled = busy();
            add.parentElement.classList.toggle('disabled', busy());
            const all = app.querySelector('#all');
            all.textContent = n === photos.length ? 'Clear' : 'Select all';
            all.disabled = busy();
            app.querySelectorAll('.size').forEach((el) => {
                const input = el.querySelector('input');
                input.checked = input.value === size;
                input.disabled = busy();
                el.classList.toggle('on', input.checked);
            });
            const err = app.querySelector('#error');
            err.hidden = !error;
            err.textContent = error || '';
            fitFoot();
            app.querySelector('#reorder').disabled = n < 2 || busy();
            const btn = app.querySelector('#save');
            btn.disabled = !n || busy();
            btn.textContent = saveLabel(n);
        }

        function saveLabel(n) {
            if (state.step === 'making') return `Making PDF: photo ${Math.min(state.done + 1, n)} of ${n}…`;
            if (state.step === 'saving') return 'Saving to the job diary…';
            if (!n) return 'Select photos for the PDF';
            return `Save PDF of ${n} ${n === 1 ? 'photo' : 'photos'} to job diary`;
        }

        /**
         * Selecting photos:
         *  - tap/click toggles one; shift-click selects (or clears) everything from the last one clicked
         *  - mouse: drag a rectangle (from anywhere on the page) to select every photo it touches,
         *    or to unselect them if the drag started on a selected photo
         *  - touch: swipe sideways across photos to select a run (up and down still scrolls)
         */
        let anchor = null; // the photo last clicked, where shift-click ranges start
        let dragged = false; // swallow the click that ends a drag
        const at = (el) => +el.dataset.i;
        const setRange = (from, to, on) => {
            for (let k = Math.min(from, to); k <= Math.max(from, to); k++) {
                if (on) selected.add(photos[k].uuid);
                else selected.delete(photos[k].uuid);
            }
        };
        const restore = (before) => {
            selected.clear();
            before.forEach((uuid) => selected.add(uuid));
        };

        function pickable(grid) {
            // Touch: a sideways swipe across photos selects the run between where it started and here.
            let swipe = null;
            grid.addEventListener('pointerdown', (e) => {
                dragged = false;
                const el = e.target.closest('.ph');
                if (!el || busy() || e.pointerType === 'mouse') return;
                const start = at(el);
                swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, start, on: !selected.has(photos[start].uuid), before: new Set(selected), active: false };
            });
            grid.addEventListener('pointermove', (e) => {
                if (!swipe || e.pointerId !== swipe.id) return;
                if (!swipe.active) {
                    const dx = Math.abs(e.clientX - swipe.x);
                    const dy = Math.abs(e.clientY - swipe.y);
                    if (Math.hypot(dx, dy) < 10) return;
                    if (dy > dx) {
                        swipe = null; // scrolling
                        return;
                    }
                    swipe.active = true;
                    try {
                        grid.setPointerCapture(e.pointerId);
                    } catch {
                        // Not capturing just means the swipe ends if it leaves the grid.
                    }
                }
                const over = document.elementFromPoint(e.clientX, e.clientY);
                const el = over?.closest('.grid .ph');
                if (!el) return;
                restore(swipe.before);
                setRange(swipe.start, at(el), swipe.on);
                anchor = swipe.start;
                update();
            });
            grid.addEventListener('pointerup', () => {
                if (swipe?.active) dragged = true;
                swipe = null;
            });
            grid.addEventListener('pointercancel', () => {
                swipe = null; // the browser took it, e.g. to scroll
            });

            grid.addEventListener('click', (e) => {
                const el = e.target.closest('.ph');
                if (!el || busy()) return;
                if (dragged) {
                    dragged = false;
                    return;
                }
                const i = at(el);
                if (e.shiftKey && anchor != null) setRange(anchor, i, selected.has(photos[anchor].uuid));
                else {
                    if (!selected.delete(photos[i].uuid)) selected.add(photos[i].uuid);
                    anchor = i;
                }
                update();
            });
        }

        // Ctrl+A (Cmd+A on a Mac) selects every photo instead of the page's text.
        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
            if (!app.querySelector('.grid') || busy()) return;
            e.preventDefault();
            photos.forEach((p) => selected.add(p.uuid));
            update();
        });

        // Image files dropped anywhere on the picker are added like "Add photos".
        const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        document.addEventListener('dragover', (e) => {
            if (!hasFiles(e) || !app.querySelector('.grid') || busy()) return;
            e.preventDefault();
            document.body.classList.add('dropping');
        });
        document.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget) document.body.classList.remove('dropping');
        });
        document.addEventListener('drop', (e) => {
            document.body.classList.remove('dropping');
            if (!hasFiles(e) || !app.querySelector('.grid')) return;
            e.preventDefault();
            addFiles(e.dataTransfer.files);
        });

        // Mouse: the selection rectangle. Set up once, for the whole page.
        const box = document.createElement('div');
        box.className = 'marquee';
        let marquee = null;
        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0 || busy() || !app.querySelector('.grid')) return;
            // Not from the buttons and options (photos are fine: that's where most drags start).
            if (e.target.closest('.foot, .bar, h1, a, input, label') || (e.target.closest('button') && !e.target.closest('.ph'))) return;
            dragged = false;
            const start = e.target.closest('.ph');
            marquee = {
                x: e.pageX,
                y: e.pageY,
                cx: e.clientX,
                cy: e.clientY,
                on: start ? !selected.has(photos[at(start)].uuid) : true,
                before: new Set(selected),
                active: false,
            };
        });
        document.addEventListener('pointermove', (e) => {
            if (!marquee) return;
            marquee.cx = e.clientX;
            marquee.cy = e.clientY;
            if (!marquee.active) {
                if (Math.hypot(e.pageX - marquee.x, e.pageY - marquee.y) < 6) return;
                marquee.active = true;
                document.body.classList.add('marqueeing');
                document.body.appendChild(box);
                scrollLoop();
            }
            drawMarquee();
        });
        const endMarquee = () => {
            if (!marquee) return;
            if (marquee.active) dragged = true;
            marquee = null;
            box.remove();
            document.body.classList.remove('marqueeing');
        };
        document.addEventListener('pointerup', endMarquee);
        document.addEventListener('pointercancel', endMarquee);
        // A click straight after a drag (wherever it lands) isn't a click.
        document.addEventListener(
            'click',
            (e) => {
                if (dragged && !e.target.closest('.ph')) dragged = false;
            },
            true,
        );

        function drawMarquee() {
            const x2 = marquee.cx + scrollX;
            const y2 = marquee.cy + scrollY;
            const left = Math.min(marquee.x, x2);
            const top = Math.min(marquee.y, y2);
            const right = Math.max(marquee.x, x2);
            const bottom = Math.max(marquee.y, y2);
            Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
            restore(marquee.before);
            app.querySelectorAll('.grid .ph').forEach((el) => {
                const r = el.getBoundingClientRect();
                const hit = r.left + scrollX < right && r.right + scrollX > left && r.top + scrollY < bottom && r.bottom + scrollY > top;
                if (hit) setRange(at(el), at(el), marquee.on);
            });
            update();
        }

        /** How far to scroll while the pointer is held within `margin` px of the top or bottom (above the footer). */
        function edgeStep(y, margin, speed) {
            const bottomEdge = innerHeight - (app.querySelector('.foot')?.offsetHeight ?? 0);
            if (y > bottomEdge - margin) return speed;
            if (y < margin) return -speed;
            return 0;
        }

        // Holding the pointer near the top or bottom while drawing scrolls the page.
        function scrollLoop() {
            if (!marquee?.active) return;
            const step = edgeStep(marquee.cy, 30, 14);
            if (step) {
                const before = scrollY;
                scrollBy(0, step);
                if (scrollY !== before) drawMarquee();
            }
            requestAnimationFrame(scrollLoop);
        }

        /**
         * "Change order": press (or click) and hold a photo, then drag it to where it should go; the
         * others move out of the way. On touch screens, moving before the hold scrolls instead.
         */
        function reorderable(ul) {
            let drag = null;
            const items = () => Array.from(ul.children);
            const renumber = () =>
                items().forEach((li, k) => {
                    li.querySelector('.tick').textContent = k + 1;
                });

            ul.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menus
            // Once a photo's lifted, a finger moving mustn't scroll the page.
            ul.addEventListener(
                'touchmove',
                (e) => {
                    if (drag?.lifted) e.preventDefault();
                },
                { passive: false },
            );

            ul.addEventListener('pointerdown', (e) => {
                const li = e.target.closest('li');
                // One photo at a time: a second finger mustn't strand the first one's ghost.
                if (!li || e.button > 0 || drag) return;
                drag = { li, id: e.pointerId, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, lifted: false };
                drag.timer = setTimeout(lift, e.pointerType === 'mouse' ? 150 : 300);
                try {
                    ul.setPointerCapture(e.pointerId);
                } catch {
                    // Without capture the drag just ends if the pointer leaves the list.
                }
            });
            ul.addEventListener('pointermove', (e) => {
                if (!drag || e.pointerId !== drag.id) return;
                drag.cx = e.clientX;
                drag.cy = e.clientY;
                if (!drag.lifted) {
                    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
                    if (e.pointerType !== 'mouse') {
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
            ul.addEventListener('pointerup', end);
            ul.addEventListener('pointercancel', end);

            function lift() {
                if (!drag || drag.lifted) return;
                drag.lifted = true;
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
                const target = over?.closest('.ogrid li');
                if (!target || target === drag.li) return;
                const list = items();
                ul.insertBefore(drag.li, list.indexOf(drag.li) < list.indexOf(target) ? target.nextSibling : target);
                renumber();
                drag.ghost.querySelector('.tick').textContent = drag.li.querySelector('.tick').textContent;
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
                if (drag.lifted) {
                    drag.ghost.remove();
                    drag.li.classList.remove('placeholder');
                    document.body.classList.remove('reordering');
                    order = items().map((li) => li.dataset.u);
                }
                drag = null;
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
                () => {
                    const now = app.querySelector(`.ph[data-i="${photos.indexOf(p)}"]`);
                    const msg = now?.querySelector('.ph-msg');
                    if (msg) msg.textContent = "Couldn't load";
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

        async function save() {
            error = null;
            const list = chosen();
            try {
                state = { step: 'making', done: 0 };
                update();
                // Through the function (no direct access), the PDF has to fit its payload limit.
                const maxBytes = Math.min(SIZES[size].bytes, direct ? Infinity : 3.5 * 1024 * 1024);
                const pdf = await photosPdf(job, list, maxBytes, (done) => {
                    state = { step: 'making', done };
                    update();
                });
                state = { step: 'saving' };
                update();
                await uploadAttachment(pdf.name, pdf.blob, 'pdf');
                const notInDiary = await finishDiary();
                state = { step: 'saved', failed: pdf.failed, notInDiary, pages: pdf.pages };
                render();
            } catch (err) {
                error = errText(err);
                state = { step: 'pick' };
                update();
            }
        }

        /** Adds a file (the PDF, or a photo from this device) to the job diary as this staff member. */
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

        // ----- Making the PDF (one photo per page, shrunk to keep the whole PDF under maxBytes) -----

        /** Long edge (px) and JPEG quality to try, best first, until a photo fits its share. */
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
                    const scale = Math.min(1, edge / Math.max(w, h));
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

        async function photosPdf(job, list, maxBytes, onProgress) {
            const perPhoto = Math.min(1.2 * 1024 * 1024, maxBytes / 3);
            const pages = [];
            const failed = [];
            // The PDF's own structure (well under 1 KB a page) counts towards maxBytes too.
            let used = 1024 * (list.length + 1);
            // One photo at a time, each starting when the one before is done: its budget depends on
            // what those used, and shrinking several at once can run a phone out of memory.
            async function addPage(i) {
                if (i >= list.length) return;
                const p = list[i];
                // Fetch the next couple while this one's shrunk.
                for (const next of list.slice(i + 1, i + 3)) photoBlob(next).catch(() => { });
                // What's left of the budget, shared by the photos still to go.
                const budget = Math.min(perPhoto, (maxBytes - used) / (list.length - i));
                try {
                    const jpeg = await toJpeg(await photoBlob(p), budget);
                    used += jpeg.data.length;
                    pages.push(jpeg);
                } catch {
                    // One unreadable photo shouldn't stop the PDF: it's left out and listed when saved.
                    failed.push(p.name);
                }
                onProgress(i + 1);
                await addPage(i + 1);
            }
            await addPage(0);
            if (!pages.length) throw new Error('None of the photos could be read on this device.');
            const name = `Job ${job.number || job.uuid.slice(0, 8)} photos.pdf`.replaceAll(/[\\/:*?"<>|]+/g, '_');
            return { name, blob: writePdf(pages), pages, failed };
        }

        const latin1 = (s) => Uint8Array.from(s, (c) => c.codePointAt(0));
        const num = (n) => n.toFixed(2);
        /** Pages are the photo's shape, with the long edge the length of A4 (in points). */
        const LONG_EDGE = 842;

        /** One photo per page, filling it: nothing else on the page or in the file. */
        function writePdf(pages) {
            const parts = [];
            const offsets = [];
            let length = 0;
            const put = (d) => {
                const bytes = typeof d === 'string' ? latin1(d) : d;
                parts.push(bytes);
                length += bytes.length;
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

            pages.forEach((jpeg, i) => {
                const id = pageId(i);
                const scale = LONG_EDGE / Math.max(jpeg.width, jpeg.height);
                const pw = num(jpeg.width * scale);
                const ph = num(jpeg.height * scale);
                const content = latin1(`q ${pw} 0 0 ${ph} 0 0 cm /Im Do Q`);
                obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
                obj(id + 1, `<< /Length ${content.length} >>`, content);
                obj(
                    id + 2,
                    `<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.data.length} >>`,
                    jpeg.data,
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
