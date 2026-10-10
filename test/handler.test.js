'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handler } = require('..');

const JOB = '11111111-2222-3333-4444-555555555555';
const STAFF = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const auth = { accessToken: 'test-token', accountUUID: 'acct', staffUUID: STAFF };
const event = (eventName, eventArgs = {}) => ({ eventName, eventArgs, auth });
const parse = (res) => JSON.parse(res.eventResponse);

/** Replaces fetch for one test; `routes` maps a URL substring to a response factory. */
function mockFetch(t, routes) {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        calls.push({ url: String(url), init });
        for (const [match, respond] of Object.entries(routes)) {
            if (String(url).includes(match)) return respond(init);
        }
        return new Response('not found', { status: 404 });
    });
    return calls;
}

// Keep test output clean: the handler logs JSON lines.
test.beforeEach((t) => {
    for (const level of ['log', 'warn', 'error']) t.mock.method(console, level, () => { });
});

test('photos_to_pdf returns the popup page with a parseable script', async () => {
    const { eventResponse: html } = await handler(event('photos_to_pdf', { jobUUID: JOB }));
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes(JOB));
    // The browser code is sent via toString(), so a syntax error there would only show up in the popup.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(scripts.length, 1);
    assert.doesNotThrow(() => new Function(scripts[0]));
});

test("photos_to_pdf passes the page its data without letting it break out of the HTML", async () => {
    const staffUUID = '"></div><script>alert(1)</script>&amp;';
    const { eventResponse: html } = await handler({ ...event('photos_to_pdf', { jobUUID: JOB }), auth: { ...auth, staffUUID } });
    assert.ok(!html.includes('<script>alert'));
    const attr = html.match(/data-boot="([^"]*)"/)[1];
    const unescaped = attr.replaceAll(/&(lt|gt|quot|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', amp: '&' })[e]);
    assert.deepEqual(JSON.parse(unescaped), { jobUUID: JOB, staffUUID, token: 'test-token' });
});

test('photos_to_pdf with a bad job UUID returns an error page', async () => {
    const { eventResponse: html } = await handler(event('photos_to_pdf', { jobUUID: 'not-a-uuid' }));
    assert.match(html, /Missing or invalid job/);
    assert.ok(!html.includes('test-token'));
});

test('photos_to_pdf_photos lists active photos, oldest first', async (t) => {
    mockFetch(t, {
        [`/job/${JOB}.json`]: () => Response.json({ generated_job_id: '42', job_address: '1 Test St' }),
        '/attachment.json': () =>
            Response.json([
                { uuid: 'b', active: 1, file_type: '.JPG', attachment_name: 'Later', timestamp: '2026-02-01 10:00:00' },
                { uuid: 'a', active: 1, file_type: '.heic', attachment_name: 'Earlier', timestamp: '2026-01-01 10:00:00' },
                { uuid: 'c', active: 0, file_type: '.jpg', attachment_name: 'Deleted' },
                { uuid: 'd', active: 1, file_type: '.pdf', attachment_name: 'Not a photo' },
            ]),
    });
    const data = parse(await handler(event('photos_to_pdf_photos', { jobUUID: JOB })));
    assert.deepEqual(data.job, { uuid: JOB, number: '42', address: '1 Test St' });
    assert.deepEqual(
        data.photos.map((p) => p.uuid),
        ['a', 'b'],
    );
});

test('API permission errors become a friendly message', async (t) => {
    mockFetch(t, { '': () => new Response('', { status: 403 }) });
    const data = parse(await handler(event('photos_to_pdf_photos', { jobUUID: JOB })));
    assert.match(data.error, /isn't allowed/);
});

test('unexpected errors hide their details', async (t) => {
    mockFetch(t, { '': () => new Response('', { status: 500 }) });
    const data = parse(await handler(event('photos_to_pdf_photos', { jobUUID: JOB })));
    assert.equal(data.error, 'Something went wrong. Please try again.');
});

test('photos_to_pdf_save rejects data that is not a PDF', async () => {
    const data = parse(await handler(event('photos_to_pdf_save', { jobUUID: JOB, data: Buffer.from('hello').toString('base64') })));
    assert.equal(data.error, "That isn't a PDF.");
});

test('photos_to_pdf_save uploads as the staff member, falling back to the add-on', async (t) => {
    let attempt = 0;
    const calls = mockFetch(t, {
        '/attachment.json': () => new Response('{}', { status: ++attempt === 1 ? 403 : 200 }),
    });
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
    const data = parse(await handler(event('photos_to_pdf_save', { jobUUID: JOB, data: pdf, name: 'a/b:c.pdf' })));
    assert.equal(data.name, 'a_b_c.pdf');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers['x-impersonate-uuid'], STAFF);
    assert.equal(calls[1].init.headers['x-impersonate-uuid'], undefined);
});

test('photos_to_pdf_upload rejects files that are not photos', async () => {
    const video = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypqt  ')]);
    for (const bytes of [Buffer.from('hello'), video]) {
        const data = parse(await handler(event('photos_to_pdf_upload', { jobUUID: JOB, data: bytes.toString('base64') })));
        assert.match(data.error, /isn't a photo/);
    }
});

test('photos_to_pdf_upload sends the type the photo really is', async (t) => {
    const calls = mockFetch(t, { '/attachment.json': () => new Response('{}') });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]);
    const gif = Buffer.from('GIF89a');
    for (const [bytes, type] of [
        [heic, 'image/heic'],
        [gif, 'image/gif'],
    ]) {
        // Browsers often send HEIC with no type at all.
        const data = parse(await handler(event('photos_to_pdf_upload', { jobUUID: JOB, data: bytes.toString('base64'), type: '' })));
        assert.equal(data.name, 'Photo.jpg');
        assert.equal(calls.at(-1).init.body.get('file').type, type);
    }
});

test('photos_to_pdf_photo does not send the token to the storage redirect', async (t) => {
    const calls = mockFetch(t, {
        '.file': () => new Response(null, { status: 302, headers: { location: 'https://storage.example/photo' } }),
        'storage.example': () => new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'content-type': 'image/jpeg' } }),
    });
    const data = parse(await handler(event('photos_to_pdf_photo', { uuid: JOB })));
    assert.equal(data.type, 'image/jpeg');
    assert.equal(calls[1].init.headers, undefined);
});

test('unknown events return nothing', async () => {
    assert.deepEqual(await handler(event('nope')), {});
});

test('manifest.json is valid and its events are handled', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.ok(manifest.actions.length);
    for (const action of manifest.actions) assert.ok(source.includes(`case '${action.event}'`), action.event);
});
