/*
 * The function (src/function), against a pretend ServiceM8 API: its events, what it sends the popup, and
 * passing photos and files through. And the manifest, addon.jsonc.
 */

import { afterEach, beforeEach, mock, spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pkg from '../package.json';
import { EVENTS, handler, type Reply } from '../src/function/index';
import { DEFAULT_NAME } from '../src/function/page';
import type { AddonEvent } from '../src/function/servicem8';

// cspell:ignore ftyp ftypqt avifmif miaf avismsf
const JOB = '11111111-2222-3333-4444-555555555555';
const STAFF = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const auth = { accessToken: 'test-token', accountUUID: 'acct', staffUUID: STAFF };
const event = (eventName: string, eventArgs: Record<string, unknown> = {}): AddonEvent => ({ eventName, eventArgs, auth });
// JSON.parse: the replies are whatever the function sent.
const parse = (res: Reply) => JSON.parse(res.eventResponse ?? 'null');
const html = (res: Reply): string => res.eventResponse ?? '';

type Respond = (init: RequestInit & { headers?: Record<string, string> }) => Response;

/** Replaces fetch for one test (put back in afterEach); `routes` maps a URL substring to a response. */
function mockFetch(routes: Record<string, Respond>) {
    const calls: { url: string; init: RequestInit & { headers?: Record<string, string> } }[] = [];
    spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request, init: RequestInit = {}) => {
        const sent = init as RequestInit & { headers?: Record<string, string> };
        calls.push({ url: String(url), init: sent });
        for (const [match, respond] of Object.entries(routes)) {
            if (String(url).includes(match)) return respond(sent);
        }
        return new Response('not found', { status: 404 });
    }) as typeof fetch);
    return calls;
}

/** addon.jsonc. JSONC: drop comments, but not `//` inside strings (the icon URLs have them). */
function readManifest() {
    const jsonc = fs.readFileSync(path.join(import.meta.dir, '..', 'addon.jsonc'), 'utf8');
    return JSON.parse(jsonc.replaceAll(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, s?: string) => s ?? ''));
}

/** The data the popup page is started with. */
function bootOf(page: string) {
    const attr = /data-boot="([^"]*)"/.exec(page)?.[1] ?? '';
    const entities: Record<string, string> = { lt: '<', gt: '>', quot: '"', amp: '&' };
    return JSON.parse(attr.replaceAll(/&(lt|gt|quot|amp);/g, (_, e: string) => entities[e] ?? ''));
}

let warn: ReturnType<typeof spyOn>;
// Keep test output clean: the handler logs JSON lines.
beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => { });
    spyOn(console, 'error').mockImplementation(() => { });
    warn = spyOn(console, 'warn').mockImplementation(() => { });
});

// Put back fetch and console after each test.
afterEach(() => mock.restore());

test('photos_to_pdf returns the popup page with a parseable script', async () => {
    const page = html(await handler(event('photos_to_pdf', { jobUUID: JOB })));
    assert.match(page, /^<!doctype html>/);
    assert.ok(page.includes(JOB));
    // The popup's script is built from src/page: a syntax error there would only show up in the popup.
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new Function(scripts[0] ?? ''));
});

test('photos_to_pdf passes the page its data without letting it break out of the HTML', async () => {
    const staffUUID = '"></div><script>alert(1)</script>&amp;';
    const page = html(await handler({ ...event('photos_to_pdf', { jobUUID: JOB }), auth: { ...auth, staffUUID } }));
    assert.ok(!page.includes('<script>alert'));
    assert.deepEqual(bootOf(page), { jobUUID: JOB, staffUUID, token: 'test-token', nameTemplate: DEFAULT_NAME });
});

test("photos_to_pdf passes the page the account's PDF name template", async () => {
    const boot = async (preferences?: Record<string, unknown>) => bootOf(html(await handler({ ...event('photos_to_pdf', { jobUUID: JOB }), preferences })));
    assert.equal((await boot({ pdf_name: ' {job.job_address} photos ' })).nameTemplate, '{job.job_address} photos');
    // Not set, or cleared: the default.
    for (const preferences of [undefined, {}, { pdf_name: '  ' }]) assert.equal((await boot(preferences)).nameTemplate, DEFAULT_NAME);
});

test('photos_to_pdf with a bad job UUID returns an error page', async () => {
    const page = html(await handler(event('photos_to_pdf', { jobUUID: 'not-a-uuid' })));
    assert.match(page, /Missing or invalid job/);
    assert.ok(!page.includes('test-token'));
});

test('photos_to_pdf_photos lists active photos, oldest first', async () => {
    mockFetch({
        [`/job/${JOB}.json`]: () => Response.json({ generated_job_id: '42', purchase_order_number: ' WO-7 ' }),
        '/attachment.json': () =>
            Response.json([
                { uuid: 'b', active: 1, file_type: '.JPG', attachment_name: 'Later', timestamp: '2026-02-01 10:00:00' },
                { uuid: 'a', active: 1, file_type: '.heic', attachment_name: 'Earlier', timestamp: '2026-01-01 10:00:00' },
                { uuid: 'c', active: 0, file_type: '.jpg', attachment_name: 'Deleted' },
                { uuid: 'd', active: 1, file_type: '.pdf', attachment_name: 'Not a photo' },
                { uuid: 'e', active: 1, file_type: '.avif', attachment_name: 'Latest', timestamp: '2026-03-01 10:00:00' },
            ]),
    });
    const data = parse(await handler(event('photos_to_pdf_photos', { jobUUID: JOB })));
    assert.deepEqual(data.job, { uuid: JOB, fields: { generated_job_id: '42', purchase_order_number: 'WO-7' } });
    assert.deepEqual(
        data.photos.map((p: { uuid: string }) => p.uuid),
        ['a', 'b', 'e'],
    );
});

test('API permission errors become a friendly message', async () => {
    mockFetch({ '': () => new Response('', { status: 403 }) });
    const data = parse(await handler(event('photos_to_pdf_photos', { jobUUID: JOB })));
    assert.match(data.error, /isn't allowed/);
});

test('unexpected errors hide their details', async () => {
    mockFetch({ '': () => new Response('', { status: 500 }) });
    const data = parse(await handler(event('photos_to_pdf_photos', { jobUUID: JOB })));
    assert.equal(data.error, 'Something went wrong. Please try again.');
});

test('photos_to_pdf_save rejects data that is not a PDF', async () => {
    const data = parse(await handler(event('photos_to_pdf_save', { jobUUID: JOB, data: Buffer.from('hello').toString('base64') })));
    assert.equal(data.error, "That isn't a PDF.");
});

test('photos_to_pdf_save uploads as the staff member, falling back to the add-on', async () => {
    let attempt = 0;
    const calls = mockFetch({
        '/attachment.json': () => new Response('{}', { status: ++attempt === 1 ? 403 : 200 }),
    });
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
    const data = parse(await handler(event('photos_to_pdf_save', { jobUUID: JOB, data: pdf, name: 'a/b:c.pdf' })));
    assert.equal(data.name, 'a_b_c.pdf');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.init.headers?.['x-impersonate-uuid'], STAFF);
    assert.equal(calls[1]?.init.headers?.['x-impersonate-uuid'], undefined);
});

test('photos_to_pdf_upload rejects files that are not photos', async () => {
    const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypqt  ')]);
    for (const bytes of [Buffer.from('hello'), video]) {
        const data = parse(await handler(event('photos_to_pdf_upload', { jobUUID: JOB, data: bytes.toString('base64') })));
        assert.match(data.error, /isn't a photo/);
    }
});

test('photos_to_pdf_upload sends the type the photo really is', async () => {
    const calls = mockFetch({ '/attachment.json': () => new Response('{}') });
    const ftyp = (brands: string) => Buffer.concat([Buffer.from([0, 0, 0, 12 + brands.length]), Buffer.from(`ftyp${brands}`)]);
    const heic = ftyp('heic\0\0\0\0mif1heic');
    const avif = ftyp('avif\0\0\0\0avifmif1miafMA1B');
    const avifAfterMif1 = ftyp('mif1\0\0\0\0mif1avif'); // a HEIF brand first, but AVIF all the same
    const animatedAvif = ftyp('avis\0\0\0\0avismsf1iso8mif1miafMA1B');
    const gif = Buffer.from('GIF89a');
    const cases: [Buffer, string][] = [
        [heic, 'image/heic'],
        [avif, 'image/avif'],
        [avifAfterMif1, 'image/avif'],
        [animatedAvif, 'image/avif'],
        [gif, 'image/gif'],
    ];
    for (const [bytes, type] of cases) {
        // Browsers often send HEIC with no type at all.
        const data = parse(await handler(event('photos_to_pdf_upload', { jobUUID: JOB, data: bytes.toString('base64'), type: '' })));
        assert.equal(data.name, 'Photo.jpg');
        const body = calls.at(-1)?.init.body as FormData;
        assert.equal((body.get('file') as File).type, type);
    }
});

test('photos_to_pdf_photo does not send the token to the storage redirect', async () => {
    const calls = mockFetch({
        '.file': () => new Response(null, { status: 302, headers: { location: 'https://storage.example/photo' } }),
        'storage.example': () => new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'content-type': 'image/jpeg' } }),
    });
    const data = parse(await handler(event('photos_to_pdf_photo', { uuid: JOB })));
    assert.equal(data.type, 'image/jpeg');
    assert.deepEqual(Object.keys(calls[1]?.init.headers ?? {}), ['range']);
});

test('photos_to_pdf_photo_url gives the photo storage link, without fetching the photo', async () => {
    const calls = mockFetch({
        '.file': () => new Response(null, { status: 302, headers: { location: 'https://storage.example/photo?sig=abc' } }),
    });
    const data = parse(await handler(event('photos_to_pdf_photo_url', { uuid: JOB })));
    assert.deepEqual(data, { url: 'https://storage.example/photo?sig=abc' });
    assert.equal(calls.length, 1); // just ServiceM8's redirect: the page fetches the photo itself
});

test('photos_to_pdf_photo_url is null when ServiceM8 sends the photo itself', async () => {
    mockFetch({ '.file': () => new Response(new Uint8Array([0xff, 0xd8])) });
    assert.deepEqual(parse(await handler(event('photos_to_pdf_photo_url', { uuid: JOB }))), { url: null });
});

test('photos_to_pdf_photo sends a big photo in pieces', async () => {
    const photo = Buffer.alloc(7 * 1024 * 1024 + 5, 7); // more than one function reply can hold
    photo[0] = 0xff;
    photo[photo.length - 1] = 0xd9;
    const ranges: number[] = [];
    mockFetch({
        '.file': () => new Response(null, { status: 302, headers: { location: 'https://storage.example/photo' } }),
        'storage.example': (init) => {
            const [from = 0, to = 0] = (/(\d+)-(\d+)/.exec(init.headers?.range ?? '') ?? []).slice(1).map(Number);
            ranges.push(from);
            const end = Math.min(to, photo.length - 1);
            return new Response(photo.subarray(from, end + 1), {
                status: 206,
                headers: { 'content-type': 'image/jpeg', 'content-range': `bytes ${from}-${end}/${photo.length}` },
            });
        },
    });
    const pieces: Buffer[] = [];
    for (let offset = 0; offset < photo.length;) {
        const data = parse(await handler(event('photos_to_pdf_photo', { uuid: JOB, offset })));
        assert.equal(data.size, photo.length);
        // Each reply (base64, in JSON) fits the function's 6 MB limit.
        assert.ok(JSON.stringify(data).length < 6 * 1000 * 1000);
        const piece = Buffer.from(data.data, 'base64');
        pieces.push(piece);
        offset += piece.length;
    }
    assert.deepEqual(ranges, [0, 3 * 1024 * 1024, 6 * 1024 * 1024]);
    assert.ok(Buffer.concat(pieces).equals(photo));
});

test('photos_to_pdf_photo fetches the whole photo when the storage refuses a piece', async () => {
    const photo = Buffer.alloc(4 * 1024 * 1024, 5);
    const asked: string[] = [];
    mockFetch({
        '.file': () => new Response(null, { status: 302, headers: { location: 'https://storage.example/photo?sig=secret' } }),
        'storage.example': (init) => {
            asked.push(init.headers?.range ?? 'whole');
            return init.headers?.range ? new Response('<Error>AccessDenied</Error>', { status: 403 }) : new Response(photo, { headers: { 'content-type': 'image/jpeg' } });
        },
    });
    const data = parse(await handler(event('photos_to_pdf_photo', { uuid: JOB, offset: 3 * 1024 * 1024 })));
    assert.deepEqual(asked, [`bytes=${3 * 1024 * 1024}-${6 * 1024 * 1024 - 1}`, 'whole']);
    assert.equal(data.size, photo.length);
    assert.ok(Buffer.from(data.data, 'base64').equals(photo.subarray(3 * 1024 * 1024)));
    // The storage link's signature isn't logged.
    assert.ok(!warn.mock.calls.flat().join(' ').includes('secret'));
});

test('photos_to_pdf_photo copes with storage that sends the whole photo', async () => {
    const photo = Buffer.alloc(4 * 1024 * 1024, 3);
    mockFetch({
        '.file': () => new Response(null, { status: 302, headers: { location: 'https://storage.example/photo' } }),
        'storage.example': () => new Response(photo, { headers: { 'content-type': 'image/jpeg' } }),
    });
    const first = parse(await handler(event('photos_to_pdf_photo', { uuid: JOB })));
    const second = parse(await handler(event('photos_to_pdf_photo', { uuid: JOB, offset: 3 * 1024 * 1024 })));
    assert.equal(first.size, photo.length);
    assert.ok(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(second.data, 'base64')]).equals(photo));
});

test('unknown events return nothing', async () => {
    assert.deepEqual(await handler(event('nope')), {});
});

test("runs on the project's Bun version, as CI does (packageManager in package.json)", () => {
    const wanted = pkg.packageManager.replace(/^bun@/, '');
    assert.equal(Bun.version, wanted, `Bun ${Bun.version} is running; this project uses ${wanted}. README, "On another computer", says how to install it.`);
});

test('addon.jsonc is valid and its events are handled', () => {
    const manifest = readManifest();
    assert.match(manifest.slug, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    assert.ok(manifest.version);
    assert.equal(manifest.main, 'src/function/index.ts');
    assert.ok(manifest.actions.length);
    for (const action of manifest.actions) assert.ok(action.event in EVENTS, action.event);
    // The PDF name preference, as ServiceM8's manifest reference has them; the function's default is the same.
    const [pdfName] = manifest.preferences;
    assert.equal(pdfName.key, 'pdf_name');
    assert.ok([...pdfName.description].length <= 250, `${[...pdfName.description].length} characters`);
    assert.ok(pdfName.default.length <= pdfName.maxLength);
    assert.equal(pdfName.default, DEFAULT_NAME);
});
