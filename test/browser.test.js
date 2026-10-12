'use strict';

/*
 * The popup, in a real (headless) browser. Its calls to this add-on's function run index.js itself;
 * only ServiceM8 is pretend: its SDK, its API and its photo storage. The PDFs it saves are opened
 * with pdf.js to check what's on their pages.
 *
 * Needs Chrome, Edge or Chromium (BROWSER_PATH, or the usual places). Skipped without one, except
 * in CI, where it must run.
 */

const { describe, test, beforeAll, afterAll, spyOn, mock } = require('bun:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { handler } = require('..');

const BROWSER = [
    process.env.BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));
if (!BROWSER && process.env.CI) throw new Error('The browser tests need Chrome, Edge or Chromium (set BROWSER_PATH).');

const PDFJS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build');
const JOB = '11111111-2222-3333-4444-555555555555';
const STAFF = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const auth = { accessToken: 'test-token', accountUUID: 'acct', staffUUID: STAFF };
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The test photo's corners (stored 400 × 300): red, green on top; blue, yellow below. */
const CORNERS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
/** The corners as they should be seen (top left, top right, bottom left, bottom right) for each EXIF orientation. */
const SEEN = { 1: 'RGBY', 3: 'YBGR', 5: 'RBGY', 6: 'BRYG', 8: 'GYRB' };

/** An EXIF segment with just an Orientation tag. */
function withOrientation(jpeg, orientation) {
    const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const head = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
    return Buffer.concat([jpeg.subarray(0, 2), head, body, jpeg.subarray(2)]);
}

/** A JPEG made bigger than one function reply can carry, with comment segments (it looks the same). */
function padded(jpeg, bytes) {
    const segments = [];
    for (let size = 0; size < bytes; size += 65535 + 2) segments.push(Buffer.concat([Buffer.from([0xff, 0xfe, 0xff, 0xff]), Buffer.alloc(65533, 0x20)]));
    return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

/** ServiceM8's API and photo storage, as the function sees them. */
function fakeServiceM8(photos) {
    const fake = { posts: [], ranges: [] };
    fake.fetch = async (url, init = {}) => {
        url = String(url);
        if (url.includes('/job/')) return Response.json({ generated_job_id: '1042', purchase_order_number: '77' });
        if (url.endsWith('/attachment.json') && init.method === 'POST') {
            const file = init.body.get('file');
            fake.posts.push({ name: init.body.get('attachment_name'), bytes: Buffer.from(await file.arrayBuffer()) });
            return new Response('{}');
        }
        if (url.includes('/attachment.json')) {
            return Response.json(photos.map((p) => ({ uuid: p.uuid, active: 1, file_type: '.jpg', attachment_name: p.name, timestamp: p.timestamp })));
        }
        const file = url.match(/attachment\/([0-9a-f-]+)\.file/);
        if (file) return new Response(null, { status: 302, headers: { location: `https://storage.example/${file[1]}?sig=x` } });
        const stored = url.match(/storage\.example\/([0-9a-f-]+)/);
        if (stored) {
            const bytes = photos.find((p) => p.uuid === stored[1]).bytes;
            const range = init.headers?.range?.match(/(\d+)-(\d+)/);
            if (!range) return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
            fake.ranges.push(stored[1]);
            const [from, to] = [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)];
            return new Response(bytes.subarray(from, to + 1), {
                status: 206,
                headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${from}-${to}/${bytes.length}` },
            });
        }
        return new Response('not found', { status: 404 });
    };
    return fake;
}

/** In the page: ServiceM8's API from the browser (or, not `direct`, refused as CORS would). */
function pageApi(direct, files, slowPhotos, limit, failOnce) {
    window.__posts = [];
    window.__closed = false;
    const real = window.fetch;
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    window.fetch = async (url, init = {}) => {
        url = String(url);
        if (!url.startsWith('https://api.servicem8.com')) return real(url, init);
        if (!direct) throw new TypeError('Failed to fetch');
        if (url.includes('/job/')) return new Response('{}');
        const file = url.match(/attachment\/([0-9a-f-]+)\.file/);
        if (file) return new Response(bytes(files[file[1]]));
        if (url.endsWith('/attachment.json') && init.method === 'POST') {
            const name = init.body.get('attachment_name');
            if (slowPhotos && !name.endsWith('.pdf')) await new Promise((r) => setTimeout(r, 600));
            const data = new Uint8Array(await init.body.get('file').arrayBuffer());
            if (limit && data.length > limit) return new Response('Request Entity Too Large', { status: 413 });
            if (failOnce && name.includes(failOnce) && !window.__failed) {
                window.__failed = true;
                return new Response('Server error', { status: 500 });
            }
            let s = '';
            for (let i = 0; i < data.length; i += 0x8000) s += String.fromCodePoint(...data.subarray(i, i + 0x8000));
            window.__posts.push({ name, b64: btoa(s) });
            return new Response('{}');
        }
        return new Response('not found', { status: 404 });
    };
}

describe.skipIf(!BROWSER)('the popup', () => {
    let browser;
    let makePhoto;
    let makeNoise;
    const realFetch = globalThis.fetch;

    beforeAll(async () => {
        for (const level of ['log', 'warn', 'error']) spyOn(console, level).mockImplementation(() => { });
        browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        /** A 400 × 300 photo with coloured corners, made by the browser. */
        makePhoto = async (type) =>
            Buffer.from(
                await page.evaluate(
                    async (type, corners) => {
                        const c = document.createElement('canvas');
                        c.width = 400;
                        c.height = 300;
                        const x = c.getContext('2d');
                        corners.forEach((colour, k) => {
                            x.fillStyle = colour;
                            x.fillRect((k % 2) * 200, Math.floor(k / 2) * 150, 200, 150);
                        });
                        const blob = await new Promise((r) => c.toBlob(r, type, 0.95));
                        return Array.from(new Uint8Array(await blob.arrayBuffer()));
                    },
                    type,
                    CORNERS,
                ),
            );
        /** A big phone-sized photo of noise: it stays big however it's compressed. */
        makeNoise = async () =>
            Buffer.from(
                await page.evaluate(async () => {
                    const c = document.createElement('canvas');
                    c.width = 3000;
                    c.height = 2250;
                    const x = c.getContext('2d');
                    const img = x.createImageData(c.width, c.height);
                    for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
                    x.putImageData(img, 0, 0);
                    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
                    return Array.from(new Uint8Array(await blob.arrayBuffer()));
                }),
            );
    }, 60000);

    afterAll(async () => {
        globalThis.fetch = realFetch;
        mock.restore();
        await browser?.close();
    });

    /** Photos for a job: `kinds` like ['jpeg', 6, 'png', ...] (a number: a JPEG with that EXIF orientation). */
    async function jobPhotos(kinds) {
        const jpeg = await makePhoto('image/jpeg');
        const png = await makePhoto('image/png');
        return Promise.all(
            kinds.map(async (kind, n) => {
                let bytes = jpeg;
                if (kind === 'png') bytes = png;
                else if (kind === 'big') bytes = padded(jpeg, 7 * 1024 * 1024);
                else if (typeof kind === 'string' && kind.endsWith('MB')) bytes = padded(jpeg, parseFloat(kind) * 1024 * 1024);
                else if (kind === 'noise') bytes = await makeNoise();
                else if (typeof kind === 'number') bytes = withOrientation(jpeg, kind);
                const orientation = typeof kind === 'number' ? kind : 1;
                return { uuid: uuid(n + 1), name: `photo-${n + 1}.${kind === 'png' ? 'png' : 'jpg'}`, timestamp: `2026-01-01 10:${String(n).padStart(2, '0')}:00`, bytes, orientation };
            }),
        );
    }

    /** The popup for a job with these photos, as ServiceM8 opens it. */
    async function open(photos, { direct = true, slowPhotos = false, storageLetsBrowser = false, limit = 0, failOnce = '', width = 900 } = {}) {
        const fake = fakeServiceM8(photos);
        globalThis.fetch = (url, init) => (/servicem8\.com|storage\.example/.test(String(url)) ? fake.fetch(url, init) : realFetch(url, init));
        const context = await browser.createBrowserContext(); // its own storage: "photos per PDF" starts at the default
        const page = await context.newPage();
        await page.setViewport({ width, height: 900 });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const { eventResponse: html } = await handler({ eventName: 'photos_to_pdf', eventArgs: { jobUUID: JOB }, auth });
        const invoked = [];
        await page.exposeFunction('__invoke', async (eventName, eventArgs) => {
            invoked.push(eventName);
            return (await handler({ eventName, eventArgs, auth })).eventResponse;
        });
        const sdk = `window.SMClient = { init: () => ({ resizeWindow() {}, closeWindow() { window.__closed = true; }, invoke: (name, args) => window.__invoke(name, args) }) };`;
        await serve(page, { 'https://test.local/': html, sdk });
        // The photo storage, fetched from the page: with CORS headers only if it lets the browser in.
        const fetchedFromStorage = [];
        page.on('request', (req) => {
            const stored = req.url().match(/^https:\/\/storage\.example\/([0-9a-f-]+)/);
            if (!stored) return;
            fetchedFromStorage.push(stored[1]);
            const body = photos.find((p) => p.uuid === stored[1]).bytes;
            req.respond({ contentType: 'image/jpeg', body, headers: storageLetsBrowser ? { 'access-control-allow-origin': '*' } : {} });
        });
        const files = direct ? Object.fromEntries(photos.map((p) => [p.uuid, p.bytes.toString('base64')])) : {};
        await page.evaluateOnNewDocument(pageApi, direct, files, slowPhotos, limit, failOnce);
        await page.goto('https://test.local/');
        await page.waitForSelector('.groups .ph');
        return { page, context, fake, errors, invoked, fetchedFromStorage };
    }

    /** Pretend sites: the popup (as ServiceM8 serves it), ServiceM8's SDK, and pdf.js. */
    async function serve(page, { sdk, ...pages } = {}) {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (sdk && url.includes('platform.servicem8.com/sdk')) return req.respond({ contentType: 'text/javascript', body: sdk });
            if (pages[url]) return req.respond({ contentType: 'text/html', body: pages[url] });
            if (url.startsWith('https://test.local/pdfjs/')) return req.respond({ contentType: 'text/javascript', body: fs.readFileSync(path.join(PDFJS, path.basename(url))) });
            if (url.startsWith('https://test.local/')) return req.respond({ contentType: 'text/html', body: '<!doctype html><body></body>' });
            if (url.includes('fonts.g')) return req.respond({ status: 204, body: '' }); // no fonts needed (or network)
            if (url.startsWith('https://storage.example/')) return undefined; // answered by open()
            return req.continue();
        });
    }

    const sections = (page) =>
        page.$$eval('.group', (gs) =>
            gs.map((g) => ({
                label: g.querySelector('h2').firstChild.textContent.trim(),
                count: g.querySelector('.count').textContent,
                photos: Array.from(g.querySelectorAll('li'), (li) => Number(li.dataset.u.slice(-4))),
            })),
        );
    const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
    async function setPerPdf(page, n) {
        await page.click('#per', { clickCount: 3 });
        await page.keyboard.type(String(n));
    }
    async function centre(page, sel) {
        const el = await page.$(sel);
        await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        const b = await el.boundingBox();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    /** Drags with the mouse; `during` runs while it's held over the target. */
    async function drag(page, from, to, during) {
        const a = await centre(page, from);
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        const b = await centre(page, to);
        for (let k = 1; k <= 12; k++) await page.mouse.move(a.x + ((b.x - a.x) * k) / 12, a.y + ((b.y - a.y) * k) / 12);
        await wait(80);
        if (during) await during();
        await page.mouse.up();
        await wait(120);
    }
    const tile = (section, k) => `.group:nth-child(${section}) li:nth-child(${k}) .ph`;
    async function tap(page, sel) {
        const at = await centre(page, sel);
        await page.mouse.click(at.x, at.y);
        await wait(60);
    }

    /** Each page's size and corner colours, as pdf.js draws them. */
    async function readPdf(context, bytes) {
        const page = await context.newPage();
        await serve(page);
        await page.goto('https://test.local/pdf');
        const pages = await page.evaluate(async (b64) => {
            const pdfjs = await import('https://test.local/pdfjs/pdf.min.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = 'https://test.local/pdfjs/pdf.worker.min.mjs';
            const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
            const out = [];
            for (let i = 1; i <= doc.numPages; i++) {
                const pg = await doc.getPage(i);
                const viewport = pg.getViewport({ scale: 0.5 });
                const c = document.createElement('canvas');
                c.width = Math.round(viewport.width);
                c.height = Math.round(viewport.height);
                await pg.render({ canvasContext: c.getContext('2d'), viewport }).promise;
                const at = (fx, fy) => Array.from(c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data.slice(0, 3));
                out.push({ wide: pg.view[2] > pg.view[3], corners: [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)] });
            }
            return out;
        }, bytes.toString('base64'));
        await page.close();
        const name = ([r, g, b]) => ({ '100': 'R', '010': 'G', '001': 'B', '110': 'Y' })[[r, g, b].map((v) => (v > 160 ? 1 : 0)).join('')] ?? '?';
        return pages.map((p) => ({ wide: p.wide, seen: p.corners.map(name).join('') }));
    }

    test('every photo starts in a PDF, split by the number per PDF (50, and no more than 50)', async () => {
        const { page, context, errors } = await open(await jobPhotos(Array(60).fill('jpeg')));
        try {
            assert.equal(await page.$eval('#per', (el) => el.value), '50');
            const s = await sections(page);
            assert.deepEqual(s.map((x) => x.label), ['PDF 1', 'PDF 2', 'New PDF', 'Left out']);
            assert.deepEqual(s.map((x) => x.count), ['50 of 50', '10 of 50', '', '']);
            assert.equal(await text(page, '#save'), 'Save 2 PDFs (60 photos) to job diary');
            await setPerPdf(page, 80);
            await page.$eval('#per', (el) => el.blur());
            assert.equal(await page.$eval('#per', (el) => el.value), '50');
            assert.equal(await page.$eval('#per', (el) => el.max), '50');
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test('tapping leaves a gap or puts a photo back at the end; the number per PDF moves nothing', async () => {
        const { page, context } = await open(await jobPhotos(Array(6).fill('jpeg')));
        try {
            await setPerPdf(page, 2);
            assert.deepEqual((await sections(page)).map((x) => x.count), ['6 of 2, over the limit', '', '']);
            assert.equal(await text(page, '#over'), '1 over the limit');
            assert.equal(await text(page, '#resplit'), 'Split into PDFs of 2');
            await page.click('#resplit');
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[1, 2], [3, 4], [5, 6], [], []]);
            assert.ok(await page.$eval('#resplit', (el) => el.hidden));

            // Left out: a gap in PDF 1, and the other tiles aren't redrawn.
            await page.$eval(tile(2, 1), (el) => { el.dataset.kept = 'yes'; });
            await tap(page, tile(1, 1));
            let s = await sections(page);
            assert.deepEqual(s.map((x) => x.photos), [[2], [3, 4], [5, 6], [], [1]]);
            assert.equal(await page.$eval(tile(2, 1), (el) => el.dataset.kept), 'yes');
            assert.ok(await page.$eval(tile(5, 1), (el) => el.classList.contains('out') && !el.querySelector('.tick')));

            // Put back: at the end, in a new PDF as the last one's full.
            await tap(page, tile(5, 1));
            s = await sections(page);
            assert.deepEqual(s.map((x) => x.photos), [[2], [3, 4], [5, 6], [1], [], []]);
            assert.equal(await text(page, '#save'), 'Save 4 PDFs (6 photos) to job diary');

            await page.click('#none');
            assert.deepEqual((await sections(page)).map((x) => x.label), ['New PDF', 'Left out']);
            assert.equal(await text(page, '#save'), 'Every photo is left out');
            await page.click('#every');
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[1, 2], [3, 4], [5, 6], [], []]);
        } finally {
            await context.close();
        }
    }, 60000);

    test("dragging across the page highlights nothing, and its text can't be dragged about", async () => {
        const { page, context } = await open(await jobPhotos(Array(3).fill('jpeg')));
        try {
            // From the "PDF 1" heading, across the links at the top.
            const from = await centre(page, '.group:nth-child(1) h2');
            const to = await centre(page, '#add-photos');
            await page.mouse.move(from.x - 30, from.y);
            await page.mouse.down();
            for (let k = 1; k <= 10; k++) await page.mouse.move(from.x - 30 + ((to.x - from.x + 30) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
            await page.mouse.up();
            assert.equal(await page.evaluate(() => getSelection().toString()), '');
            // Text the browser would otherwise let you drag (selected some other way) doesn't move.
            const dragged = await page.evaluate(() => {
                const e = new DragEvent('dragstart', { bubbles: true, cancelable: true });
                document.querySelector('.group h2').dispatchEvent(e);
                return !e.defaultPrevented;
            });
            assert.equal(dragged, false);
            // The number box can still be selected and typed in.
            await setPerPdf(page, 7);
            assert.equal(await page.$eval('#per', (el) => el.value), '7');
        } finally {
            await context.close();
        }
    }, 60000);

    test('photos are dragged between PDFs, into a new one or left out, with a warning over the limit', async () => {
        const { page, context } = await open(await jobPhotos(Array(6).fill('jpeg')));
        try {
            await setPerPdf(page, 2);
            await page.click('#resplit');

            await drag(page, tile(3, 1), tile(1, 2));
            let s = await sections(page);
            assert.deepEqual(s.map((x) => x.photos), [[1, 5, 2], [3, 4], [6], [], []]);
            assert.equal(s[0].count, '3 of 2, over the limit');
            assert.ok(await page.$eval('.group:nth-child(1)', (el) => el.classList.contains('over')));

            // Over an empty section, it lights up and says what letting go does.
            await drag(page, tile(2, 1), '.group:nth-child(4) .ogrid', async () => {
                assert.ok(await page.$('.new.target'));
                assert.equal(await page.$eval('.new .ogrid', (el) => getComputedStyle(el, '::after').content), '"Let go to start a new PDF"');
            });
            s = await sections(page);
            assert.deepEqual(s.map((x) => x.label), ['PDF 1', 'PDF 2', 'PDF 3', 'PDF 4', 'New PDF', 'Left out']);
            assert.deepEqual(s.map((x) => x.photos), [[1, 5, 2], [4], [6], [3], [], []]);

            await drag(page, tile(1, 1), '.group:nth-child(6) .ogrid');
            s = await sections(page);
            assert.deepEqual(s.at(-1).photos, [1]);
            assert.equal(await text(page, '#save'), 'Save 4 PDFs (5 photos) to job diary');
        } finally {
            await context.close();
        }
    }, 60000);

    test('saving: device photos first, then each PDF, full size and the right way round', async () => {
        const photos = await jobPhotos([6, 3, 'png', 8, 'jpeg', 5]);
        const { page, context, errors } = await open(photos, { slowPhotos: true });
        try {
            const device = path.join(require('node:os').tmpdir(), 'photos-to-pdf-device.jpg');
            fs.writeFileSync(device, photos[4].bytes);
            await (await page.$('#add')).uploadFile(device);
            await page.waitForFunction(() => document.querySelectorAll('.pdf:not(.new) li').length === 7);
            await setPerPdf(page, 4);
            await page.click('#resplit');

            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 30000 });
            const posts = await page.evaluate(() => window.__posts);
            assert.deepEqual(posts.map((p) => p.name), ['photos-to-pdf-device.jpg', 'Job #1042 Photos - PO 77 (1 of 2).pdf', 'Job #1042 Photos - PO 77 (2 of 2).pdf']);
            assert.match(await text(page, '.done-reopen'), /Reopen the job/);
            assert.equal(await page.evaluate(() => window.__closed), false); // only Done closes it
            await page.click('#done');
            assert.equal(await page.evaluate(() => window.__closed), true);

            const pdfs = posts.slice(1).map((p) => Buffer.from(p.b64, 'base64'));
            // JPEGs go in as they are, not re-compressed.
            for (const p of photos.filter((p) => p.name.endsWith('.jpg'))) assert.ok(Buffer.concat(pdfs).includes(p.bytes), p.name);
            const order = [photos[0], photos[1], photos[2], photos[3], photos[4], photos[5], photos[4]];
            const pages = [...(await readPdf(context, pdfs[0])), ...(await readPdf(context, pdfs[1]))];
            assert.equal(pages.length, 7);
            pages.forEach((pg, k) => {
                assert.equal(pg.seen, SEEN[order[k].orientation], `${order[k].name}, page ${k + 1}`);
                assert.equal(pg.wide, order[k].orientation < 5, `${order[k].name}'s page shape`);
            });
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);

    test('photos are compressed a little for the PDF; small JPEGs go in as they are', async () => {
        const photos = await jobPhotos(['noise', 'jpeg']);
        const { page, context, errors } = await open(photos);
        try {
            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 30000 });
            const pdf = Buffer.from((await page.evaluate(() => window.__posts))[0].b64, 'base64');
            assert.ok(pdf.includes(photos[1].bytes), 'the small JPEG, as it is');
            assert.ok(!pdf.includes(photos[0].bytes.subarray(0, 4096)), 'the big one, compressed');
            const sizes = [...pdf.toString('latin1').matchAll(/\/Width (\d+) \/Height (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
            assert.deepEqual(sizes, [[2400, 1800], [400, 300]]);
            assert.ok(pdf.length < photos[0].bytes.length * 0.8, `${pdf.length} bytes from ${photos[0].bytes.length}`);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);

    test("a PDF too big for ServiceM8 is saved in parts, in order, and the limit's remembered", async () => {
        const photos = await jobPhotos(['noise', 'noise', 'noise']);
        const limit = 5 * 1024 * 1024;
        const { page, context, errors } = await open(photos, { limit });
        try {
            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 60000 });
            const posts = await page.evaluate(() => window.__posts);
            assert.ok(posts.length >= 2, `${posts.length} parts`);
            assert.deepEqual(posts.map((p) => p.name), posts.map((_, k) => `Job #1042 Photos - PO 77 part ${k + 1}.pdf`));
            const pdfs = posts.map((p) => Buffer.from(p.b64, 'base64'));
            assert.ok(pdfs.every((pdf) => pdf.length <= limit));
            const pages = pdfs.map((pdf) => pdf.toString('latin1').match(/\/Type \/Page /g).length);
            assert.equal(pages.reduce((a, b) => a + b), 3);
            assert.match(await text(page, '.foot'), /too big for ServiceM8 in one file, so it's saved in parts/);
            const remembered = Number(await page.evaluate(() => localStorage.getItem('photos-to-pdf:pdf-limit')));
            // Learnt from what was turned away: next time, it's split before saving.
            assert.ok(remembered > 0 && remembered < pdfs.reduce((a, b) => a + b.length, 0), `remembered ${remembered}`);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);

    test('saving again after a failure part way through a PDF in parts carries on, without saving parts twice', async () => {
        const photos = await jobPhotos(['noise', 'noise', 'noise']);
        const limit = 5 * 1024 * 1024;
        const { page, context, errors } = await open(photos, { limit, failOnce: 'part 2' });
        try {
            await page.click('#save');
            await page.waitForFunction(() => !document.querySelector('#error').hidden, { timeout: 60000 });
            assert.match(await text(page, '#error'), /\(500\)/);
            const before = (await page.evaluate(() => window.__posts)).map((p) => p.name);
            assert.deepEqual(before, ['Job #1042 Photos - PO 77 part 1.pdf']);

            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 60000 });
            const names = (await page.evaluate(() => window.__posts)).map((p) => p.name);
            assert.deepEqual(names, names.map((_, k) => `Job #1042 Photos - PO 77 part ${k + 1}.pdf`)); // each part once
            const pages = (await page.evaluate(() => window.__posts)).map((p) => Buffer.from(p.b64, 'base64').toString('latin1').match(/\/Type \/Page /g).length);
            assert.equal(pages.reduce((a, b) => a + b), 3);
            assert.deepEqual(await page.$$eval('.done-names li', (els) => els.map((e) => e.textContent)), names);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 120000);

    test('a photo too big for ServiceM8 even on its own is the only one made smaller', async () => {
        const photos = await jobPhotos(['noise', 6]);
        const { page, context, errors } = await open(photos, { limit: 1024 * 1024 });
        try {
            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 30000 });
            // Once that photo's smaller, both fit in one PDF again.
            const posts = await page.evaluate(() => window.__posts);
            assert.deepEqual(posts.map((p) => p.name), ['Job #1042 Photos - PO 77.pdf']);
            const pdf = Buffer.from(posts[0].b64, 'base64');
            assert.ok(pdf.length <= 1024 * 1024);
            assert.ok(pdf.includes(photos[1].bytes), 'the other photo as it is');
            assert.match(await text(page, '.foot'), /made smaller to fit: photo-1.jpg/);
            const pages = await readPdf(context, pdf);
            assert.equal(pages[1].seen, SEEN[6]);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);

    test('photos come straight from their storage when it lets the browser, not through the function', async () => {
        const photos = await jobPhotos(['big', 6, 'jpeg', 'jpeg', 'jpeg', 'jpeg']);
        const { page, context, errors, invoked, fetchedFromStorage } = await open(photos, { direct: false, storageLetsBrowser: true });
        try {
            await page.waitForFunction(() => document.querySelectorAll('.groups .ph img').length === 6, { timeout: 30000 });
            assert.deepEqual([...fetchedFromStorage].sort(), photos.map((p) => p.uuid).sort());
            assert.equal(invoked.filter((e) => e === 'photos_to_pdf_photo').length, 0);
            assert.equal(invoked.filter((e) => e === 'photos_to_pdf_photo_url').length, 6);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test('through the function: big photos come in pieces, and each PDF fits what it can carry', async () => {
        const photos = await jobPhotos(['big', 6, 'jpeg']);
        const { page, context, fake, errors, invoked } = await open(photos, { direct: false });
        try {
            await page.waitForFunction(() => document.querySelectorAll('.groups .ph img').length === 3, { timeout: 30000 });
            assert.ok(fake.ranges.filter((u) => u === photos[0].uuid).length >= 3, 'the 7 MB photo came in 3 MB pieces');
            assert.ok(invoked.filter((e) => e === 'photos_to_pdf_photo_url').length <= 5, 'stops asking for storage links once the storage says no');

            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 60000 });
            assert.deepEqual(fake.posts.map((p) => p.name), ['Job #1042 Photos - PO 77.pdf']);
            const pdf = fake.posts[0].bytes;
            assert.ok(pdf.length < 3.5 * 1024 * 1024, `${pdf.length} bytes`);
            assert.match(await text(page, '.foot'), /made smaller to fit/);
            const pages = await readPdf(context, pdf);
            assert.deepEqual(pages.map((p) => p.seen), [SEEN[1], SEEN[6], SEEN[1]]);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);
});
