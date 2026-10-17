'use strict';

/*
 * The popup, in a real (headless) browser. Its calls to this add-on's function run index.js itself;
 * only ServiceM8 is pretend: its SDK, its API and its photo storage. The PDFs it saves are opened
 * with pdf.js to check what's on their pages.
 *
 * Runs in the project's own browser (Chrome for Testing, the version pinned in package.json), which
 * bun install downloads (scripts/browser.js): the same on every computer and in CI. BROWSER_PATH
 * runs them in another browser instead.
 */

const { describe, test, beforeAll, afterAll, spyOn, mock } = require('bun:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { handler } = require('..');
const testBrowser = require('../scripts/browser');

const BROWSER = process.env.BROWSER_PATH || testBrowser.executablePath();
if (!fs.existsSync(BROWSER)) {
    const why = process.env.BROWSER_PATH ? `BROWSER_PATH isn't there: ${BROWSER}` : `The test browser (${testBrowser.label}) isn't downloaded: run bun run browser.`;
    throw new Error(why);
}

const PDFJS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build');
const JOB = '11111111-2222-3333-4444-555555555555';
const STAFF = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const auth = { accessToken: 'test-token', accountUUID: 'acct', staffUUID: STAFF };
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// cspell:ignore RGBY YBGR RBGY BRYG GYRB
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
        if (url.includes('/job/')) return Response.json({ generated_job_id: '1042', purchase_order_number: '77', job_address: '1 Main St', job_description: '' });
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
function pageApi(direct, files, slowPhotos, limit, failOnce, slowFile) {
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
        if (file && file[1] === slowFile) await new Promise((r) => setTimeout(r, 1500)); // this one's slow to load
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

describe('the popup', () => {
    let browser;
    let makePhoto;
    let makeNoise;
    let sdkCss = ''; // ServiceM8's add-on stylesheet, as the popup loads it (none if it can't be fetched)
    const realFetch = globalThis.fetch;

    beforeAll(async () => {
        for (const level of ['log', 'warn', 'error']) spyOn(console, level).mockImplementation(() => { });
        sdkCss = await realFetch('https://platform.servicem8.com/sdk/1.0/sdk.css').then((r) => (r.ok ? r.text() : ''), () => '');
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
    async function open(photos, { direct = true, slowPhotos = false, storageLetsBrowser = false, limit = 0, failOnce = '', slowFile = '', width = 900, view } = {}) {
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
        await page.evaluateOnNewDocument(pageApi, direct, files, slowPhotos, limit, failOnce, slowFile);
        // Simple, unless the test's about arranging each PDF (as if Detailed was used last).
        if (view) await page.evaluateOnNewDocument((v) => localStorage.setItem('photos-to-pdf:view', v), view);
        await page.goto('https://test.local/');
        await page.waitForSelector('.groups .ph');
        return { page, context, fake, errors, invoked, fetchedFromStorage };
    }

    /** Pretend sites: the popup (as ServiceM8 serves it), ServiceM8's SDK, and pdf.js. */
    async function serve(page, { sdk, ...pages } = {}) {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (sdk && url.includes('platform.servicem8.com/sdk/1.0/sdk.css')) return req.respond({ contentType: 'text/css', body: sdkCss });
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
    /** Clicks a photo, with Control or Shift held if given. */
    async function tap(page, sel, key) {
        const at = await centre(page, sel);
        if (key) await page.keyboard.down(key);
        await page.mouse.click(at.x, at.y);
        if (key) await page.keyboard.up(key);
        await wait(60);
    }
    async function doubleClick(page, sel) {
        const at = await centre(page, sel);
        await page.mouse.click(at.x, at.y, { count: 2 });
        await wait(60);
    }
    const selectedPhotos = (page) => page.$$eval('.ph.sel', (els) => els.map((el) => Number(el.parentElement.dataset.u.slice(-4))));

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
        const { page, context, errors } = await open(await jobPhotos(Array(60).fill('jpeg')), { view: 'detailed' });
        try {
            // ServiceM8's stylesheet is loaded (when it could be fetched for the test), and the tiles are still squares.
            // (Its rules can't be read from the page: it's another site's. What it does to a <pre>, which the popup doesn't style, can.)
            const preBackground = await page.evaluate(() => {
                const pre = document.body.appendChild(document.createElement('pre'));
                const background = getComputedStyle(pre).backgroundColor;
                pre.remove();
                return background;
            });
            if (sdkCss) assert.equal(preBackground, 'rgb(237, 239, 240)');
            assert.ok(await page.$eval('.ph', (el) => Math.abs(el.offsetWidth - el.offsetHeight) <= 1));
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

    test('double-clicking leaves a gap, or puts a photo back at the end; the number per PDF moves nothing', async () => {
        const { page, context } = await open(await jobPhotos(Array(6).fill('jpeg')), { view: 'detailed' });
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
            await doubleClick(page, tile(1, 1));
            let s = await sections(page);
            assert.deepEqual(s.map((x) => x.photos), [[2], [3, 4], [5, 6], [], [1]]);
            assert.equal(await page.$eval(tile(2, 1), (el) => el.dataset.kept), 'yes');
            assert.ok(await page.$eval(tile(5, 1), (el) => el.classList.contains('out')));

            // Put back: at the end, in a new PDF as the last one's full.
            await doubleClick(page, tile(5, 1));
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
        const { page, context } = await open(await jobPhotos(Array(3).fill('jpeg')), { view: 'detailed' });
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
        const { page, context } = await open(await jobPhotos(Array(6).fill('jpeg')), { view: 'detailed' });
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

    test('Simple: one list to reorder and leave photos out of, saved as even PDFs; the view is remembered', async () => {
        const photos = await jobPhotos([1, 3, 5, 6, 8]);
        const { page, context, errors } = await open(photos);
        try {
            let s = await sections(page);
            assert.deepEqual(s.map((x) => x.label), ['Photos', 'Left out']);
            assert.deepEqual(s.map((x) => x.count), ['5', '']);
            assert.ok(await page.$eval('.per', (el) => el.hidden));

            // "Left out" is as tall empty as with a photo in it.
            const outHeight = () => page.$eval('.out .ogrid', (el) => el.offsetHeight);
            const emptyHeight = await outHeight();
            await drag(page, tile(1, 1), tile(1, 4));
            await doubleClick(page, tile(1, 2));
            assert.equal(await outHeight(), emptyHeight);
            s = await sections(page);
            assert.deepEqual(s.map((x) => x.photos), [[2, 4, 1, 5], [3]]);
            assert.equal(await text(page, '#save'), 'Save PDF of 4 photos to job diary');

            // Detailed shows the same photos as PDFs; back in Simple, they're split by its number per PDF.
            await page.click('#view-detailed');
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[2, 4, 1, 5], [], [3]]);
            await setPerPdf(page, 2);
            await page.click('#view-simple');
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[2, 4, 1, 5], [3]]);
            assert.equal(await text(page, '#save'), 'Save 2 PDFs (4 photos) to job diary');
            assert.equal(await page.evaluate(() => localStorage.getItem('photos-to-pdf:view')), 'simple');

            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 30000 });
            const posts = await page.evaluate(() => window.__posts);
            assert.deepEqual(posts.map((p) => p.name), ['Job #1042 Photos - PO 77 (1 of 2).pdf', 'Job #1042 Photos - PO 77 (2 of 2).pdf']);
            const pdfs = posts.map((p) => Buffer.from(p.b64, 'base64'));
            const pages = [...(await readPdf(context, pdfs[0])), ...(await readPdf(context, pdfs[1]))];
            assert.deepEqual(pages.map((p) => p.seen), [SEEN[3], SEEN[6], SEEN[1], SEEN[8]]);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);

    test("Simple: the PDFs' name, from the settings' template, changed here for this save, with a preview", async () => {
        const { page, context, errors } = await open(await jobPhotos(Array(3).fill('jpeg')));
        try {
            const preview = () => text(page, '.group:nth-child(1) .pdf-saved');
            // Empty, with the settings' name (filled in) as its placeholder.
            assert.deepEqual(await page.$eval('#template', (el) => [el.value, el.placeholder]), ['', 'Job #1042 Photos - PO 77']);
            assert.equal(await preview(), 'Job #1042 Photos - PO 77.pdf');
            assert.ok(await page.$eval('#template-reset', (el) => el.hidden));
            // Two per PDF (set in Detailed): two PDFs.
            await page.click('#view-detailed');
            await setPerPdf(page, 2);
            await page.click('#view-simple');
            assert.equal(await preview(), 'Job #1042 Photos - PO 77 (1 of 2).pdf, and 1 more');

            // Typed in: the preview follows, and Backspace there doesn't leave out the selected photo.
            await tap(page, tile(1, 1));
            await page.click('#template', { clickCount: 3 });
            await page.keyboard.type('{job.job_address}: {job.nope}[ PO {job.job_description}] photos');
            await page.keyboard.press('Backspace');
            // The section left out (its field's empty) isn't in the name; it says why.
            assert.equal(await preview(), '1 Main St_ {job.nope} photo (1 of 2).pdf, and 1 more (left out: Job description is empty)');
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[1, 2, 3], []]);
            assert.ok(!(await page.$eval('#template-reset', (el) => el.hidden)));
            await page.click('#template-reset');
            assert.equal(await page.$eval('#template', (el) => el.value), '');
            assert.equal(await preview(), 'Job #1042 Photos - PO 77 (1 of 2).pdf, and 1 more');

            // Detailed names its PDFs from it (their boxes' placeholders), and it's kept when the page is redrawn.
            await page.click('#template', { clickCount: 3 });
            await page.keyboard.type('{job.job_address} photos');
            await page.click('#view-detailed');
            assert.ok(!(await page.$('.foot .pdf-name')), 'no name box in the footer');
            assert.deepEqual(await page.$$eval('.pdf-name', (els) => els.map((el) => [el.value, el.placeholder])), [
                ['', '1 Main St photos (1 of 2)'],
                ['', '1 Main St photos (2 of 2)'],
            ]);
            await page.click('#view-simple');
            assert.equal(await page.$eval('#template', (el) => el.value), '{job.job_address} photos');
            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 30000 });
            const posts = await page.evaluate(() => window.__posts);
            assert.deepEqual(posts.map((p) => p.name), ['1 Main St photos (1 of 2).pdf', '1 Main St photos (2 of 2).pdf']);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test('name boxes: fields coloured in, and offered after a "{", fewer as more is typed', async () => {
        const { page, context, errors } = await open(await jobPhotos(['jpeg']));
        try {
            const painted = () => page.$$eval('.name-colours span', (els) => els.map((el) => [el.className, el.textContent]));
            const offered = () => page.$$eval('.suggest:not([hidden]) .s-key', (els) => els.map((el) => el.textContent));
            const value = () => page.$eval('#template', (el) => el.value);
            assert.deepEqual(await painted(), []); // empty: just its placeholder

            // Clicked into: every field's offered, to put in where the caret is (here, over the text selected).
            await page.click('#template', { clickCount: 3 });
            const all = ['{job.generated_job_id}', '{job.purchase_order_number}', '{job.job_address}', '{job.job_description}'];
            assert.deepEqual(await offered(), all);
            assert.match(await text(page, '.suggest .s-head'), /Add a job field/);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            assert.equal(await value(), '{job.job_address}');
            await page.keyboard.type(' x'); // typing: they go
            assert.deepEqual(await offered(), []);

            await page.click('#template', { clickCount: 3 });
            await page.keyboard.type('{');
            assert.deepEqual(await offered(), all);
            assert.equal(await page.$('.suggest .s-head'), null);
            await page.keyboard.type('po'); // "PO number"
            assert.deepEqual(await offered(), ['{job.purchase_order_number}']);
            await page.keyboard.press('Enter');
            await page.keyboard.type(' at {job.add');
            assert.deepEqual(await offered(), ['{job.job_address}']);
            await page.keyboard.press('Tab');
            assert.equal(await value(), '{job.purchase_order_number} at {job.job_address}');

            // Clicked on a field already there: every field, to change it to, with it picked out.
            await page.$eval('#template', (el) => {
                el.setSelectionRange(9, 9); // in "{job.purchase_order_number}"
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            assert.deepEqual(await offered(), all);
            assert.equal(await text(page, '.suggest .s-head'), 'Change this field to');
            assert.equal(await text(page, '.suggest .on .s-key'), '{job.purchase_order_number}');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            assert.equal(await value(), '{job.job_address} at {job.job_address}');
            await page.keyboard.press('End');

            // Esc closes the list; a click picks one.
            await page.keyboard.type(' {');
            await page.keyboard.press('Escape');
            assert.deepEqual(await offered(), []);
            await page.keyboard.type('des');
            assert.deepEqual(await offered(), ['{job.job_description}']);
            await page.click('.suggest li');
            await page.keyboard.type(' {job.nope}');
            assert.deepEqual(await offered(), []);
            assert.equal(await value(), '{job.job_address} at {job.job_address} {job.job_description} {job.nope}');
            assert.deepEqual(await painted(), [
                ['t-field', '{job.job_address}'],
                ['t-field', '{job.job_address}'],
                ['t-field', '{job.job_description}'],
                ['t-bad', '{job.nope}'],
            ]);
            assert.equal(await text(page, '.group:nth-child(1) .pdf-saved'), '1 Main St at 1 Main St {job.nope}.pdf');

            // A [ ] section left out (its field's empty on this job): not in the name beside the box, which says why.
            await page.click('#template', { clickCount: 3 });
            await page.keyboard.type('Photos[ for {job.job_description}]');
            assert.equal(await text(page, '.group:nth-child(1) .pdf-saved'), 'Photos.pdf (left out: Job description is empty)');
            assert.deepEqual(await painted(), [
                ['t-section', '[ for {job.job_description}]'],
                ['t-opt', '['],
                ['t-field', '{job.job_description}'],
                ['t-opt', ']'],
            ]);
            assert.equal(await page.$('[title]'), null, 'no tooltips');

            // Not for the browser's autofill (a value it doesn't know, no "name" for it to go on) or password managers to fill in.
            assert.deepEqual(await page.$eval('#template', (el) => ['autocomplete', 'data-lpignore', 'data-1p-ignore', 'data-bwignore'].map((a) => el.getAttribute(a))), ['photos-pdf-name', 'true', '', '']);
            assert.deepEqual(await page.$$eval('.pdf-name', (els) => els.filter((el) => /name/i.test(el.id + el.getAttribute('aria-label'))).length), 0);

            // "?": how names work, by example, until it's pressed again, Esc, or a press elsewhere. Its text can be copied.
            const helpOpen = () => page.$eval('.help-box', (el) => !el.hidden);
            await page.click('.name-help');
            assert.ok(await helpOpen());
            assert.deepEqual(await page.$$eval('.help-examples li', (els) => els.map((el) => [el.querySelector('.help-template').textContent, el.querySelector('.help-result').textContent])), [
                ['Job #{job.generated_job_id}', '→ Job #1042'],
                ['Job #{job.generated_job_id} Photos[ - PO {job.purchase_order_number}]', '→ Job #1042 Photos - PO 77'],
                ['{job.job_address} - Job #{job.generated_job_id}', '→ 1 Main St - Job #1042'],
            ]);
            assert.equal(await page.$eval('.help-box', (el) => getComputedStyle(el).userSelect), 'text');
            assert.equal(await page.$eval('.name-help', (el) => el.getAttribute('aria-expanded')), 'true');
            // Use: it goes in the box, and the help closes.
            await page.click('.help-examples li:nth-child(2) [data-use]');
            assert.ok(!(await helpOpen()));
            assert.equal(await value(), 'Job #{job.generated_job_id} Photos[ - PO {job.purchase_order_number}]');
            assert.equal(await text(page, '.group:nth-child(1) .pdf-saved'), 'Job #1042 Photos - PO 77.pdf');
            await page.click('.name-help');
            await page.click('.name-help');
            assert.ok(!(await helpOpen()));
            await page.click('.name-help');
            await page.keyboard.press('Escape');
            assert.ok(!(await helpOpen()));
            await page.click('.name-help');
            await page.mouse.click(5, 300);
            assert.ok(!(await helpOpen()));
            assert.deepEqual(await offered(), []); // the "?" isn't the box: no fields offered
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test('Detailed: a PDF can be given its own name, which stays with it as PDFs come and go', async () => {
        const { page, context, errors } = await open(await jobPhotos(Array(3).fill('jpeg')), { view: 'detailed' });
        try {
            await setPerPdf(page, 2);
            await page.click('#resplit');
            // Each starts empty, with the name from the template (filled in) as its placeholder.
            const boxes = () => page.$$eval('.pdf-name', (els) => els.map((el) => [el.value, el.placeholder, el.closest('.group-head').querySelector('.pdf-saved').textContent]));
            const resets = () => page.$$eval('.pdf-reset', (els) => els.map((el) => !el.hidden));
            assert.deepEqual(await boxes(), [
                ['', 'Job #1042 Photos - PO 77 (1 of 2)', ''],
                ['', 'Job #1042 Photos - PO 77 (2 of 2)', ''],
            ]);
            assert.deepEqual(await resets(), [false, false]);

            // Its own name can have fields too (what it comes out as is beside it); Reset empties it again.
            const rename = async (gi, name) => {
                await page.click(`.pdf-name[data-g="${gi}"]`, { clickCount: 3 });
                await page.keyboard.type(name);
            };
            await rename(1, 'Kitchen {job.job_address}');
            assert.equal(await text(page, '.group:nth-child(2) .pdf-saved'), 'Kitchen 1 Main St.pdf');
            assert.deepEqual(await resets(), [false, true]);
            assert.deepEqual(await selectedPhotos(page), []); // typing there isn't selecting
            await page.click('.group:nth-child(2) .pdf-reset');
            assert.deepEqual((await boxes())[1], ['', 'Job #1042 Photos - PO 77 (2 of 2)', '']);
            await rename(1, 'Kitchen {job.job_address}');

            // PDF 1 emptied: the named PDF is now PDF 1, still with its name.
            await doubleClick(page, tile(1, 1));
            await wait(450);
            await doubleClick(page, tile(1, 1));
            assert.deepEqual((await sections(page)).map((x) => x.label), ['PDF 1', 'New PDF', 'Left out']);
            assert.deepEqual(await boxes(), [['Kitchen {job.job_address}', 'Job #1042 Photos - PO 77', 'Kitchen 1 Main St.pdf']]);
            await page.click('#every'); // back at the end: into it (it has room), then a new PDF
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[3, 1], [2], [], []]);

            await page.click('#save');
            await page.waitForSelector('.done', { timeout: 30000 });
            const posts = await page.evaluate(() => window.__posts);
            assert.deepEqual(posts.map((p) => p.name), ['Kitchen 1 Main St.pdf', 'Job #1042 Photos - PO 77 (2 of 2).pdf']);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test('a photo exactly the same as one before it is tagged "Duplicate", and nothing moves', async () => {
        // 1 and 3 are the same file; 4 is the same picture with an EXIF orientation, so not the same file.
        const photos = await jobPhotos(['jpeg', 'png', 'jpeg', 6]);
        const { page, context, errors } = await open(photos, { view: 'detailed' });
        try {
            const tagged = () => page.$$eval('.ph', (els) => els.filter((el) => !el.querySelector('.dup').hidden).map((el) => Number(el.parentElement.dataset.u.slice(-4))));
            await page.waitForFunction(() => document.querySelectorAll('.dup:not([hidden])').length, { timeout: 30000 });
            assert.deepEqual(await tagged(), [3]);
            assert.equal(await text(page, '.dup:not([hidden])'), 'Duplicate');
            assert.deepEqual((await sections(page)).map((x) => x.photos), [[1, 2, 3, 4], [], []]);

            // Added from the device: a copy of one on the job is tagged too. Left out, it stays tagged.
            const device = path.join(require('node:os').tmpdir(), 'photos-to-pdf-copy.png');
            fs.writeFileSync(device, photos[1].bytes);
            await (await page.$('#add')).uploadFile(device);
            await page.waitForFunction(() => document.querySelectorAll('.dup:not([hidden])').length === 2, { timeout: 30000 });
            await doubleClick(page, tile(1, 3));
            assert.deepEqual((await sections(page)).at(-1).photos, [3]);
            assert.equal((await tagged()).length, 2);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test("a duplicate is tagged as soon as it's found, without waiting for photos before it still loading", async () => {
        // 1, 3 and 4 are the same file; 1 is slow to load.
        const photos = await jobPhotos(['jpeg', 'png', 'jpeg', 'jpeg']);
        const { page, context, errors } = await open(photos, { slowFile: uuid(1) });
        try {
            const tagged = () => page.$$eval('.ph', (els) => els.filter((el) => !el.querySelector('.dup').hidden).map((el) => Number(el.parentElement.dataset.u.slice(-4))));
            // 4 is a copy of 3 whatever 1 turns out to be.
            await page.waitForFunction(() => document.querySelectorAll('.dup:not([hidden])').length, { timeout: 30000 });
            assert.deepEqual(await tagged(), [4]);
            assert.equal(await page.$eval('.ph[data-i="0"]', (el) => !!el.querySelector('img')), false, 'photo 1 still loading');
            // Then 1 loads, and it's the original: 3 is a copy too.
            await page.waitForFunction(() => document.querySelectorAll('.dup:not([hidden])').length === 2, { timeout: 30000 });
            assert.deepEqual(await tagged(), [3, 4]);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 60000);

    test('photos are selected by clicking (Ctrl, Shift) or a box, then dragged or left out together', async () => {
        const { page, context, errors } = await open(await jobPhotos(Array(8).fill('jpeg')));
        try {
            const photosIn = async () => (await sections(page)).map((x) => x.photos);
            await tap(page, tile(1, 2));
            assert.deepEqual(await selectedPhotos(page), [2]);
            assert.equal(await text(page, '#sel-count'), '1 selected');
            await wait(450); // not so soon after that it's a double-click
            await tap(page, tile(1, 2)); // on its own again: unselected
            assert.deepEqual(await selectedPhotos(page), []);
            assert.ok(await page.$eval('#sel-count', (el) => el.hidden));

            await wait(450);
            await tap(page, tile(1, 2));
            await tap(page, tile(1, 4), 'Shift');
            await tap(page, tile(1, 3), 'Control');
            await tap(page, tile(1, 7), 'Control');
            assert.deepEqual(await selectedPhotos(page), [2, 4, 7]);

            // Dragging one drags them all, in order, to where it's let go.
            await drag(page, tile(1, 4), tile(1, 1));
            assert.deepEqual(await photosIn(), [[2, 4, 7, 1, 3, 5, 6, 8], []]);
            assert.deepEqual(await selectedPhotos(page), [2, 4, 7]);

            // Delete leaves them out, and the selection's cleared.
            await page.keyboard.press('Delete');
            assert.deepEqual(await photosIn(), [[1, 3, 5, 6, 8], [2, 4, 7]]);
            assert.deepEqual(await selectedPhotos(page), []);

            // A box dragged out from the space below the photos selects those it touches.
            const below = await page.$eval('.pdf', (el) => el.getBoundingClientRect().bottom + 30);
            const first = await centre(page, tile(1, 1));
            const second = await centre(page, tile(1, 2));
            await page.mouse.move(first.x, below);
            await page.mouse.down();
            for (let k = 1; k <= 8; k++) await page.mouse.move(first.x + ((second.x - first.x) * k) / 8, below + ((second.y - below) * k) / 8);
            assert.ok(await page.$('.lasso'));
            await page.mouse.up();
            assert.deepEqual(await selectedPhotos(page), [1, 3]);
            await page.click('#sel-out');
            assert.deepEqual(await photosIn(), [[5, 6, 8], [1, 2, 3, 4, 7]]);

            // Left out ones are put back at the end.
            await tap(page, tile(2, 1));
            assert.ok(await page.$eval('#sel-out', (el) => el.hidden));
            await page.click('#sel-back');
            assert.deepEqual(await photosIn(), [[5, 6, 8, 1], [2, 3, 4, 7]]);

            // Ctrl+A selects every photo; Esc, or a click between photos, clears it.
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            assert.equal((await selectedPhotos(page)).length, 8);
            await page.keyboard.press('Escape');
            assert.deepEqual(await selectedPhotos(page), []);
            await tap(page, tile(1, 1));
            await page.mouse.click(first.x, below);
            assert.deepEqual(await selectedPhotos(page), []);

            // A double-click leaves one out on its own: what was selected before stays selected.
            await tap(page, tile(1, 1));
            await tap(page, tile(1, 2), 'Control');
            await doubleClick(page, tile(1, 3));
            assert.deepEqual(await photosIn(), [[5, 6, 1], [2, 3, 4, 7, 8]]);
            assert.deepEqual(await selectedPhotos(page), [5, 6]);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }, 90000);

    test('saving: device photos first, then each PDF, full size and the right way round', async () => {
        const photos = await jobPhotos([6, 3, 'png', 8, 'jpeg', 5]);
        const { page, context, errors } = await open(photos, { slowPhotos: true, view: 'detailed' });
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
