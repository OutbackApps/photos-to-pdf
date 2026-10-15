'use strict';

/*
 * The popup page: its styles, the HTML around it, and photosToPdfPage, the code that runs in it.
 * index.js (the function) sends it to ServiceM8 when the job card's button is tapped.
 */

const SHELL_CSS = `
/* ServiceM8's own look: its add-on stylesheet's (sdk.css) font, greys, inputs and buttons, and its green. */
:root { --brand: #7dc836; --brand-ink: #4e8a1e; --ink: #4d4d4d; --muted: #8c8c8c; --line: #d6dadc; --field: #edeff0; --field-line: #cdd2d4; --button: #e6e6e6; --button-ink: #636362; --empty: #e2e4e6; --empty-line: #c4c9cc; --surface: #fff; --surface-2: #f4f5f6; --danger: #eb5a46; }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px 12px 96px; font: 14px/1.4 'Open Sans', Arial, Helvetica, sans-serif; color: var(--ink); background: var(--surface); }
/* Nothing on the page highlights when a mouse is dragged across it (photos are dragged here), except what's for typing or copying. */
body { user-select: none; -webkit-user-select: none; }
input, .done-names { user-select: text; -webkit-user-select: text; }
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
.bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin: 12px 0 8px; font-size: 14px; }
/* Simple / Detailed: two buttons side by side, the one in use green. */
.view { display: inline-flex; flex: none; }
.view .link { border-radius: 0; }
.view .link:first-child { border-radius: 6px 0 0 6px; }
.view .link:last-child { border-radius: 0 6px 6px 0; }
.view .link.on, .view .link.on:hover:not(:disabled) { background: var(--brand); border-color: transparent; box-shadow: none; color: #fff; }
.bar:first-child { margin-top: 0; }
.bar .actions { display: flex; align-items: center; gap: 6px; flex: none; margin-left: auto; }
.ogrid { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-y; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.ph { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border: 0; border-radius: 6px; background: var(--field); }
.ph img { pointer-events: none; -webkit-user-drag: none; width: 100%; height: 100%; object-fit: cover; display: block; }
.ph .ph-msg { position: absolute; inset: 0; display: grid; place-items: center; padding: 4px; font-size: 11px; color: var(--muted); text-align: center; word-break: break-word; }
.groups .ph { cursor: grab; }
.ph.out img { opacity: .4; filter: grayscale(1); }
.ogrid li.placeholder .ph { opacity: .25; }
.ghost { position: fixed; z-index: 10; list-style: none; pointer-events: none; transform: scale(1.06); box-shadow: 0 8px 20px rgba(0, 0, 0, .35); border-radius: 6px; }
/* Selected photos: a green frame and tint. Several being dragged: a stack, with how many. */
.ogrid li { position: relative; }
.ph.sel { outline: 3px solid var(--brand); outline-offset: 2px; }
.ph.sel::after { content: ""; position: absolute; inset: 0; background: rgba(125, 200, 54, .25); }
.ghost.stack { box-shadow: 5px 5px 0 -1px var(--surface), 6px 6px 0 0 var(--line), 0 8px 20px rgba(0, 0, 0, .35); }
.ghost-count { position: absolute; top: -9px; right: -9px; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 12px; background: var(--brand); color: #fff; font-size: 12px; font-weight: 600; line-height: 24px; text-align: center; }
.lasso { position: fixed; z-index: 15; pointer-events: none; border: 1px solid var(--brand); border-radius: 2px; background: rgba(125, 200, 54, .15); }
/* What's selected, and what to do with it (or how to select, when nothing is): always the same height. */
.selection-bar { display: flex; align-items: center; gap: 6px; min-height: 30px; margin-bottom: 8px; font-size: 13px; }
.selection-bar #sel-count { font-weight: 600; margin-right: 4px; }
.selection-bar #sel-how { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.selection-bar [hidden] { display: none; }
body.reordering, body.reordering * { cursor: grabbing !important; }
/* "Enlarge on hover": the photo pointed at, bigger, beside its tile, fading in. */
.bar .enlarge { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--button-ink); white-space: nowrap; cursor: pointer; }
.peek { position: fixed; z-index: 20; pointer-events: none; }
.peek[hidden] { display: none; }
.peek { animation: peek-in .15s ease-out; }
.peek img { display: block; border-radius: 6px; background: var(--field); box-shadow: 0 6px 18px rgba(0, 0, 0, .3); }
@keyframes peek-in { from { opacity: 0; transform: scale(.96); } }
.dev { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; font-size: 10px; text-align: center; color: #fff; background: rgba(0, 0, 0, .55); }
.dev.failed { background: var(--danger); }
/* A photo exactly the same as one before it: tagged, top left. It's still used unless it's left out. */
.dup { position: absolute; top: 4px; left: 4px; padding: 1px 6px; border-radius: 3px; background: #d9822b; color: #fff; font-size: 10px; font-weight: 600; line-height: 16px; }
.dup[hidden] { display: none; }
/* The picker fills the window, so "Left out" sits at the bottom, just above the footer, when there's room. */
body:has(.groups) { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
body:has(.groups) #app, .groups { flex: 1; display: flex; flex-direction: column; }
.groups > .out { margin-top: auto; }
body.dropping .groups { outline: 2px dashed var(--brand); outline-offset: 4px; border-radius: 6px; }
.foot { position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 12px max(10px, env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--line); }
.foot .danger { margin-bottom: 6px; }
.per { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; flex-wrap: wrap; }
.per[hidden] { display: none; }
.per label { font-weight: 600; }
/* Inputs, as sdk.css draws them. */
.per input, .pdf-name { width: 64px; padding: .4em .5em; border: 1px solid var(--field-line); border-radius: 3px; font: inherit; color: var(--ink); background: var(--surface); }
.per input:hover:not(:disabled), .pdf-name:hover:not(:disabled) { border-color: #b6bbbf; }
.per input:focus, .pdf-name:focus { border-color: #a5acb0; outline: none; box-shadow: 0 0 6px var(--field-line); }
.per #over:not(:empty)::before { content: "·"; margin-right: 6px; color: var(--muted); }
.per #pdfs:empty + #over::before { content: none; }
.per #resplit { margin-left: auto; }
.per #resplit[hidden] { display: none; }
/* Each PDF is a panel, so it's clear which photos go together; "New PDF" and empty sections are dashed, like ServiceM8's empty lists. */
.group { margin: 0 0 12px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); }
.group h2 { font-size: 14px; margin: 0; white-space: nowrap; }
/* A PDF's heading, then its name (Simple: every PDF's): beside it, or under it on a narrow screen. */
.group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 0 0 8px; font-size: 13px; }
/*
 * A name box: its text is drawn coloured in a layer behind it, and the box's own is see-through (its
 * caret and selection still show). Fields the job has are green, ones it doesn't red, [ ] blue.
 */
.name-field { position: relative; display: flex; flex: 1 1 220px; max-width: 520px; min-width: 0; }
.name-field .pdf-name { position: relative; flex: 1; min-width: 0; padding-right: 30px; color: transparent; caret-color: var(--ink); background: transparent; }
.name-field .pdf-name::selection { color: transparent; background: rgba(125, 200, 54, .35); }
.name-colours { position: absolute; inset: 0; padding: .4em 30px .4em .5em; border: 1px solid transparent; border-radius: 3px; background: var(--surface); color: var(--ink); white-space: pre; overflow: hidden; pointer-events: none; }
.name-field .pdf-name:disabled, .name-field:has(.pdf-name:disabled) .name-colours { opacity: .6; }
.t-field { color: var(--brand-ink); background: rgba(125, 200, 54, .18); border-radius: 3px; }
.t-bad { color: var(--danger); text-decoration: underline wavy; text-underline-offset: 3px; }
.t-opt { color: #2f7bbf; }
/* "?" at the end of a name box (room's left for it), and how names work, under it. */
.name-help { position: absolute; top: 50%; right: 5px; width: 20px; height: 20px; padding: 0; transform: translateY(-50%); border: 1px solid var(--field-line); border-radius: 10px; background: var(--surface-2); color: var(--muted); font-size: 12px; font-weight: 600; line-height: 18px; }
.name-help:hover, .name-help[aria-expanded="true"] { border-color: var(--brand); color: var(--brand-ink); }
/* Its text can be selected and copied (the rest of the page can't: photos are dragged there). */
.help-box { position: fixed; z-index: 30; padding: 10px 14px 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, .18); font-size: 13px; line-height: 1.5; user-select: text; -webkit-user-select: text; }
.help-box[hidden] { display: none; }
.help-box p { margin: 0 0 8px; }
.help-box p.muted { font-size: 12px; }
/* Each example: the template, what it comes out as on this job, and Use. */
.help-examples { list-style: none; margin: 0 0 8px; padding: 0; }
.help-examples li { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 10px; padding: 6px 0; border-top: 1px solid var(--line); }
.help-examples li:last-child { border-bottom: 1px solid var(--line); }
.help-template { min-width: 0; overflow-wrap: anywhere; }
.help-result { grid-row: 2; min-width: 0; color: var(--muted); overflow-wrap: anywhere; }
.help-examples .link { grid-row: 1 / 3; grid-column: 2; }
/* The job's fields, offered after a "{" in a name box. */
.suggest { position: fixed; z-index: 30; margin: 0; padding: 4px; list-style: none; max-height: 240px; overflow-y: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, .18); font-size: 13px; }
.suggest[hidden] { display: none; }
.suggest li { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.suggest li.on { background: rgba(125, 200, 54, .18); }
.suggest li.s-head { padding: 3px 8px 5px; color: var(--muted); font-size: 12px; cursor: default; }
/* A [ ] section: tinted as a whole, so what goes with its field is plain. */
.t-section { background: rgba(47, 123, 191, .18); border-radius: 3px; }
/* After what a name comes out as: why a [ ] section was left out (a field in it is empty on this job). */
.left-out-why { color: var(--muted); }
.suggest .s-label { font-weight: 600; }
.suggest .s-key { color: var(--brand-ink); }
.suggest .s-value { flex: 1; min-width: 0; text-align: right; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
/* Empty, it shows the name from the template: plainly not typed in. */
.group-head .pdf-name::placeholder { color: var(--muted); font-style: italic; opacity: 1; }
.group-head .pdf-saved { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.group-head .pdf-saved:empty { display: none; }
.group-head .pdf-saved b { font-weight: 600; color: var(--ink); }
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
/* Empty, a list other than "New PDF" is still a tile tall (an unseen tile sets the row's height), so it doesn't grow when the first photo goes in. */
.group:not(.new) .ogrid:empty::before { content: ""; grid-row: 1; grid-column: 1; aspect-ratio: 1; }
.group:not(.new) .ogrid:empty::after { grid-row: 1; }
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

/*
 * Reading a JPEG's header, and filling in the PDF name's template, in the browser. They use nothing
 * but what they're given, so they're sent with the page's script on their own (pageScript), not
 * inside photosToPdfPage.
 */

/** A JPEG's pixel size, colours and EXIF orientation, if PDF readers can show it as it is (otherwise null). */
async function jpegInfo(blob) {
    // The frame header comes before the image data, after the EXIF and other metadata: usually
    // in the first few KB, but the whole file's read if it isn't in the first MB.
    const head = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
    const found = jpegHeader(head);
    if (found !== undefined || head.length >= blob.size) return found ?? null;
    return jpegHeader(new Uint8Array(await blob.arrayBuffer())) ?? null;
}

/** A JPEG's size, colours and EXIF orientation from its bytes: null if PDF readers can't show it as it is, undefined if the bytes ran out first. */
function jpegHeader(b) {
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
        if (isFrame(marker)) return frame(b, i, marker, orientation);
        i += 2 + length;
    }
    return undefined;
}

/** Start of frame markers (not DHT, JPG or DAC, which share the range). */
function isFrame(marker) {
    return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/** The frame header at i: baseline, extended or progressive, 8 bits, grey or colour is what every PDF reader shows. */
function frame(b, i, marker, orientation) {
    if (i + 10 > b.length) return undefined;
    const components = b[i + 9];
    const height = (b[i + 5] << 8) | b[i + 6];
    const width = (b[i + 7] << 8) | b[i + 8];
    const shown = marker <= 0xc2 && b[i + 4] === 8 && (components === 1 || components === 3) && width > 0 && height > 0;
    return shown ? { width, height, orientation, grey: components === 1 } : null;
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

/**
 * Fills in a name template the way ServiceM8's email templates do: {job.purchase_order_number}
 * is that field of the job (`values.job`). Text in [ ] is left out when a field in it is empty, so
 * "Photos[ - PO {job.purchase_order_number}]" is just "Photos" for a job without one. A field it
 * doesn't know stays as it's written, so a mistake shows in the preview.
 */
function fillTemplate(template, values) {
    const kept = templateParts(template, values).filter((part) => !part.dropped);
    return kept.map((part) => part.text).join('').replaceAll(/\s+/g, ' ').trim();
}

/** The whole field ("{job.…}") a name box's caret is in, if it's in one (just after its "{" to just before its "}"). */
function fieldAt(input) {
    const caret = input.selectionStart;
    if (input.selectionEnd !== caret) return null;
    for (const m of input.value.matchAll(/\{(\w+)\.(\w+)\}/g)) {
        if (m.index < caret && caret < m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, key: m[2].toLowerCase() };
    }
    return null;
}

/**
 * A name template filled in (as fillTemplate), in parts: { text }, and for a [ ] section left out,
 * { text, dropped: true, empty } (the text it would have had, and its fields that are empty), so
 * the preview can show what was left out and why.
 */
function templateParts(template, values) {
    const field = (whole, object, key) => {
        const fields = values[object.toLowerCase()];
        const name = key.toLowerCase();
        if (!fields || !Object.hasOwn(fields, name)) return { text: whole, empty: false, name };
        const text = String(fields[name] ?? '').trim();
        return { text, empty: !text, name };
    };
    const PLACEHOLDER = /\{(\w+)\.(\w+)\}/g;
    const source = String(template ?? '');
    const parts = [];
    let at = 0;
    for (const m of source.matchAll(/\[([^[\]]*)\]|\{(\w+)\.(\w+)\}/g)) {
        if (m.index > at) parts.push({ text: source.slice(at, m.index) });
        at = m.index + m[0].length;
        const [whole, section, object, key] = m;
        if (section === undefined) {
            parts.push({ text: field(whole, object, key).text });
            continue;
        }
        const found = Array.from(section.matchAll(PLACEHOLDER), (f) => field(f[0], f[1], f[2]));
        let k = 0;
        const text = section.replaceAll(PLACEHOLDER, () => found[k++].text);
        const empty = found.filter((f) => f.empty).map((f) => f.name);
        parts.push(empty.length ? { text, dropped: true, empty } : { text });
    }
    if (at < source.length) parts.push({ text: source.slice(at) });
    return parts;
}

/*
 * Runs in the browser, not in the function: index.js sends it as the page's script (via
 * toString, in pageScript), so it can't use anything from the rest of this file but the JPEG
 * helpers above, which go with it, or require anything.
 */
function photosToPdfPage(boot) {
    const API = 'https://api.servicem8.com/api_1.0';
    const client = window.SMClient.init();
    const app = document.getElementById('app');
    // The page's own text and images can't be dragged about (or dropped into "Photos per PDF"):
    // photos are moved with their own dragging. Files dragged in from the device still drop.
    document.addEventListener('dragstart', (e) => e.preventDefault());
    try {
        // As big as the screen comfortably allows (room for the browser's toolbars and the modal's
        // title), up to 1200 x 900; this page can't see the size of ServiceM8's own page around it.
        const fit = (room, margin, most) => Math.round(Math.max(480, Math.min(most, (room || most) - margin)));
        client.resizeWindow(fit(screen.availWidth, 160, 1200), fit(screen.availHeight, 260, 900));
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
        let fromStorage = true; // until the photo storage turns the browser away

        const blobs = new Map(); // uuid -> Promise<Blob>
        /** How many photos go in each PDF. The staff member can change it; it's remembered on this device. */
        const MAX_PER_PDF = 50;
        const PER_PDF_KEY = 'photos-to-pdf:per-pdf';
        const perPdfFrom = (value) => {
            const n = Math.floor(Number(value));
            return n >= 1 ? Math.min(n, MAX_PER_PDF) : null;
        };
        let perPdf = MAX_PER_PDF;
        try {
            perPdf = perPdfFrom(localStorage.getItem(PER_PDF_KEY)) || perPdf;
        } catch {
            // No storage in this window: it starts at the default each time.
        }
        /**
         * Simple: one list of photos in page order, split into PDFs of perPdf when saved. Detailed: each
         * PDF arranged on its own. Simple unless Detailed was used last on this device.
         */
        const VIEW_KEY = 'photos-to-pdf:view';
        let simple = true;
        try {
            simple = localStorage.getItem(VIEW_KEY) !== 'detailed';
        } catch {
            // No storage in this window: it starts Simple each time.
        }
        /** "Enlarge on hover", with a mouse: off until it's turned on, then remembered on this device. */
        const ENLARGE_KEY = 'photos-to-pdf:enlarge';
        const canEnlarge = matchMedia('(hover: hover) and (pointer: fine)').matches;
        let enlargeOn = false;
        try {
            enlargeOn = localStorage.getItem(ENLARGE_KEY) === '1';
        } catch {
            // No storage in this window: it starts off each time.
        }
        let state = { step: 'pick' };
        let error = null;

        /**
         * The PDFs' name: the template set in ServiceM8's settings (Preferences → Add-ons), which can be
         * changed here for this save; " (1 of 3)" is added when there are several.
         */
        let nameTemplate = boot.nameTemplate;
        /** A template filled in with the job's fields, without anything a file name can't have ('' if it comes out empty). */
        const fileName = (template) => fillTemplate(template, { job: job.fields }).replaceAll(/[\\/:*?"<>|\p{Cc}]+/gu, '_').slice(0, 120).trim();
        /** The name's start, before " (1 of 3)": a job number if the template comes out empty. */
        const pdfBase = () => fileName(nameTemplate) || `Job #${job.fields.generated_job_id || job.uuid.slice(0, 8)} Photos`;
        /** PDF `k` (from 0) of `of`: "Job #2 Photos (1 of 3)", or just "Job #2 Photos" if it's the only one. */
        const pdfName = (base, k, of) => (of > 1 ? `${base} (${k + 1} of ${of})` : base);
        /** PDF `k`'s name: its own, given in Detailed (a template too, with nothing added), or from the template. */
        const nameOf = (k, of) => (!simple && groups[k]?.name && fileName(groups[k].name)) || pdfName(pdfBase(), k, of);
        /**
         * The name boxes: empty until a name's typed in, the name from the template (filled in for this
         * job) their placeholder, and Reset to empty them again. Beside Simple's, the first PDF's name and
         * how many more; beside a PDF's in Detailed, what its own name comes out as, once it has one.
         */
        function updateNames() {
            const of = groups.length;
            const reset = app.querySelector('#template-reset');
            if (reset) reset.hidden = nameTemplate === boot.nameTemplate;
            app.querySelectorAll('.pdf-name, .name-help, #template-reset, .pdf-reset').forEach((el) => {
                el.disabled = busy();
            });
            app.querySelectorAll('.pdf-name').forEach((input) => {
                const head = input.closest('.group-head');
                const saved = head.querySelector('.pdf-saved');
                paintTemplate(input);
                if (input.id === 'template') {
                    input.placeholder = fileName(boot.nameTemplate) || pdfBase();
                    const more = of > 1 ? `, and ${of - 1} more` : '';
                    saved.innerHTML = of ? savedAs(nameTemplate, 0, of, more) : '';
                    return;
                }
                const gi = +input.dataset.g;
                const own = groups[gi]?.name;
                input.placeholder = pdfName(pdfBase(), gi, of);
                head.querySelector('.pdf-reset').hidden = !own;
                saved.innerHTML = own ? savedAs(own, gi, of, '', true) : '';
            });
        }

        /**
         * What PDF `k` of `of` is saved as with this template, in HTML: " (1 of 3)" added unless it's a
         * PDF's own name, then `more`, then, if a [ ] section was left out, which empty field left it out.
         */
        function savedAs(template, k, of, more, own) {
            const filled = fileName(template);
            if (!filled) return `<b>${esc(own ? nameOf(k, of) : pdfName(pdfBase(), k, of))}.pdf</b>${more}`; // the fallback
            const number = !own && of > 1 ? ` (${k + 1} of ${of})` : '';
            const names = emptyFields(template).map((key) => FIELD_LABELS[key] || key);
            const are = names.length > 1 ? 'are' : 'is';
            const why = names.length ? ` <span class="left-out-why">(left out: ${esc(names.join(' and '))} ${are} empty)</span>` : '';
            return `<b>${esc(filled + number)}.pdf</b>${more}${why}`;
        }

        /** The empty fields that leave a template's [ ] sections out on this job. */
        function emptyFields(template) {
            const keys = templateParts(template, { job: job.fields }).flatMap((part) => part.empty ?? []);
            return [...new Set(keys)];
        }

        // ----- Name boxes: the template coloured in, and the job's fields offered after a "{" -----

        /** Friendlier names for the job fields most used in a name, offered first (any of the job's fields can be used). */
        const FIELD_LABELS = {
            generated_job_id: 'Job number',
            purchase_order_number: 'PO number',
            job_address: 'Job address',
            job_description: 'Job description',
            status: 'Status',
            date: 'Job date',
            billing_address: 'Billing address',
            work_done_description: 'Work done',
            geo_street: 'Street',
            geo_city: 'Suburb or city',
            geo_state: 'State',
            geo_postcode: 'Postcode',
            quote_date: 'Quote date',
            work_order_date: 'Work order date',
            completion_date: 'Completion date',
        };
        /** The fields offered: those above first, then the rest of the job's, but not its ids. */
        const fieldChoices = (() => {
            const keys = Object.keys(job.fields).filter((k) => !/(^|_)uuid$/.test(k) && k !== 'active');
            const first = Object.keys(FIELD_LABELS).filter((k) => keys.includes(k));
            const rest = keys.filter((k) => !FIELD_LABELS[k]).sort((a, b) => a.localeCompare(b));
            return [...first, ...rest].map((key) => ({ key, label: FIELD_LABELS[key] || '', value: job.fields[key] }));
        })();

        /**
         * A name box's text, coloured, in the layer behind it (the box's own text is see-through): fields
         * the job has, ones it doesn't (they stay as typed), and each [ ] section (left out when a field
         * in it is empty), tinted as a whole so it's plain what goes with the field.
         */
        function paintTemplate(input) {
            const layer = input.previousElementSibling;
            layer.innerHTML = colourTemplate(input.value);
            layer.scrollLeft = input.scrollLeft; // a long name scrolls in its box
        }
        /** A template as HTML, coloured as in the name boxes (see paintTemplate). */
        function colourTemplate(template) {
            const fields = (text) =>
                text.replaceAll(/\{(\w+)\.(\w+)\}/g, (whole, object, key) => {
                    const known = object.toLowerCase() === 'job' && Object.hasOwn(job.fields, key.toLowerCase());
                    return `<span class="${known ? 't-field' : 't-bad'}">${whole}</span>`;
                });
            const bracket = (b) => `<span class="t-opt">${b}</span>`;
            return esc(template).replaceAll(/\[([^[\]]*)\]|[^[]+|\[/g, (whole, section) =>
                section === undefined ? fields(whole) : '<span class="t-section">' + bracket('[') + fields(section) + bracket(']') + '</span>',
            );
        }

        // ----- "?" at the end of a name box: how names work, by example -----

        /** Examples, each shown with what it comes out as on this job, to Use as they are or start from. */
        const NAME_EXAMPLES = [
            'Job #{job.generated_job_id}',
            'Job #{job.generated_job_id} Photos[ - PO {job.purchase_order_number}]',
            '{job.job_address} - Job #{job.generated_job_id}',
        ];
        const helpBox = document.createElement('div');
        helpBox.className = 'help-box';
        helpBox.hidden = true;
        helpBox.setAttribute('role', 'dialog');
        helpBox.setAttribute('aria-label', 'Naming the PDFs');
        document.body.append(helpBox);
        let helpFor = null; // the "?" it's open for

        /** The help: a line on how it works, then the examples, with what each comes out as on this job. */
        function helpHtml() {
            const examples = NAME_EXAMPLES.map((template, k) => {
                const result = fileName(template) || pdfBase();
                return `<li><span class="help-template">${colourTemplate(template)}</span><span class="help-result">→ ${esc(result)}</span><button type="button" class="link" data-use="${k}">Use</button></li>`;
            });
            return [
                '<p>Click in the box to add a job field, or type <b>{</b>. Text in <span class="t-opt">[ ]</span> is left out when a field in it is empty.</p>',
                `<ul class="help-examples">${examples.join('')}</ul>`,
                '<p class="muted">Several PDFs get “(1 of 3)” added. The default is set in ServiceM8: Settings → Preferences → Add-ons.</p>',
            ].join('');
        }

        // An example's Use: it goes in the box the "?" is for, as if typed there.
        helpBox.addEventListener('click', (e) => {
            const use = e.target.closest('[data-use]');
            if (!use || !helpFor) return;
            const input = helpFor.parentElement.querySelector('.pdf-name');
            input.value = NAME_EXAMPLES[+use.dataset.use];
            hideHelp();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            hideSuggest(); // it wasn't typed in: nothing to offer
        });

        /** Opens the help under its "?" (right-aligned to it), or closes it if it's open for that one. */
        function toggleHelp(button) {
            if (helpFor === button) return hideHelp();
            hideHelp();
            hideSuggest();
            helpFor = button;
            button.setAttribute('aria-expanded', 'true');
            helpBox.innerHTML = helpHtml();
            helpBox.hidden = false;
            const r = button.getBoundingClientRect();
            const width = Math.min(380, innerWidth - 16);
            const h = helpBox.offsetHeight;
            const top = r.bottom + 6 + h <= innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
            Object.assign(helpBox.style, { width: `${width}px`, left: `${Math.max(8, Math.min(r.right - width, innerWidth - width - 8))}px`, top: `${top}px` });
        }
        function hideHelp() {
            helpFor?.setAttribute('aria-expanded', 'false');
            helpFor = null;
            helpBox.hidden = true;
        }
        // Closed by a press anywhere else, Esc, or scrolling or resizing (it'd be left behind).
        addEventListener('resize', () => helpFor && hideHelp());
        document.addEventListener('pointerdown', (e) => {
            if (helpFor && !helpBox.contains(e.target) && e.target !== helpFor) hideHelp();
        });
        document.addEventListener('keydown', (e) => {
            if (helpFor && e.key === 'Escape') hideHelp();
        });
        addEventListener('scroll', () => helpFor && hideHelp(), { passive: true });

        const suggestBox = document.createElement('ul');
        suggestBox.className = 'suggest';
        suggestBox.hidden = true;
        suggestBox.setAttribute('role', 'listbox');
        document.body.append(suggestBox);
        /**
         * The fields being offered: for which box, how (`mode`, below), what a pick replaces (`start` to
         * `end`), the ones offered, and the one picked out.
         *   typed:   after a "{" typed, those matching what's typed since; a pick replaces it (and the rest of a field)
         *   change:  the caret on a field already there (clicked, or moved onto it): all of them; a pick replaces that field
         *   add:     the box just clicked into: all of them; a pick goes where the caret is (over any text selected)
         */
        let suggesting = null;
        /** The name box clicked (or tabbed) into, until something's typed in it: all the fields are offered, so they're found. */
        let browsing = null;

        /**
         * What to offer in a name box, as `suggesting` (without `active`, and `now`: the one to pick out
         * to start with), or null for nothing. `typing`: asked as the box is typed in.
         */
        function offerFor(input, typing) {
            if (document.activeElement !== input) return null;
            const caret = input.selectionStart;
            const on = !typing && fieldAt(input);
            if (on) {
                // Changing a field: every field, with it picked out.
                const now = Math.max(0, fieldChoices.findIndex((f) => f.key === on.key));
                return { input, mode: 'change', start: on.start, end: on.end, items: fieldChoices, now };
            }
            const typed = input.selectionEnd === caret && input.value.slice(0, caret).match(/\{([\w.]*)$/);
            if (!typed) return browsing === input ? { input, mode: 'add', start: null, end: null, items: fieldChoices, now: 0 } : null;
            let q = typed[1].toLowerCase();
            if (q.includes('.')) {
                if (!q.startsWith('job.')) return null; // only the job's fields
                q = q.slice(4);
            }
            const items = fieldChoices.filter((f) => f.key.includes(q) || f.label.toLowerCase().includes(q));
            return items.length ? { input, mode: 'typed', start: caret - typed[0].length, end: null, items, now: 0 } : null;
        }

        /**
         * The job's fields, under a name box: after a "{" typed, those matching what's typed since (a label
         * or a field name); otherwise, with the caret on a field, all of them to change it to; or, the box
         * just clicked into, all of them to add. `typing`: called as the box's typed in.
         */
        function suggest(input, typing) {
            const offer = offerFor(input, typing);
            if (!offer) return hideSuggest();
            const { now, ...next } = offer;
            const { mode, items } = next;
            const same = suggesting?.input === input && suggesting.mode === mode && suggesting.start === next.start && suggesting.items.length === items.length;
            // The same as already shown (e.g. the caret moved within what's typed): left as it is, with what's picked out.
            if (same && suggesting.items.every((f, k) => f === items[k])) return placeSuggest();
            suggesting = { ...next, active: same ? suggesting.active : now };
            const head = { add: 'Add a job field to the name', change: 'Change this field to' }[mode];
            const options = items.map((f, k) => {
                const label = f.label ? `<span class="s-label">${esc(f.label)}</span>` : '';
                const value = f.value ? esc(f.value) : '<i>empty</i>';
                return `<li role="option" data-k="${k}">${label}<span class="s-key">{job.${esc(f.key)}}</span><span class="s-value">${value}</span></li>`;
            });
            suggestBox.innerHTML = (head ? `<li class="s-head">${head}</li>` : '') + options.join('');
            suggestBox.hidden = false;
            placeSuggest();
            pickSuggestion(suggesting.active);
        }

        /** Under its box, or over it if there's no room below (above the footer). */
        function placeSuggest() {
            const r = suggesting.input.getBoundingClientRect();
            const width = Math.min(Math.max(r.width, 320), innerWidth - 16);
            const bottom = innerHeight - (app.querySelector('.foot')?.offsetHeight ?? 0);
            const h = suggestBox.offsetHeight;
            const top = r.bottom + 2 + h <= bottom ? r.bottom + 2 : Math.max(8, r.top - 2 - h);
            Object.assign(suggestBox.style, { width: `${width}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`, top: `${top}px` });
        }

        function pickSuggestion(k) {
            suggesting.active = (k + suggesting.items.length) % suggesting.items.length;
            const options = suggestBox.querySelectorAll('[data-k]');
            options.forEach((li, i) => li.classList.toggle('on', i === suggesting.active));
            options[suggesting.active].scrollIntoView({ block: 'nearest' });
        }

        /** The field picked, in place of what it replaces (see `suggesting`). */
        function chooseSuggestion(k) {
            const { input, items, mode } = suggesting;
            const text = `{job.${items[k].key}}`;
            const start = mode === 'add' ? input.selectionStart : suggesting.start;
            let after = input.value.slice(input.selectionEnd); // add
            if (mode === 'change') after = input.value.slice(suggesting.end);
            else if (mode === 'typed') after = after.replace(/^[\w.]*\}/, '');
            input.value = input.value.slice(0, start) + text + after;
            input.setSelectionRange(start + text.length, start + text.length);
            hideSuggest();
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function hideSuggest() {
            browsing = null;
            suggesting = null;
            suggestBox.hidden = true;
        }

        suggestBox.addEventListener('mousedown', (e) => e.preventDefault()); // the box keeps the focus
        suggestBox.addEventListener('click', (e) => {
            const li = e.target.closest('[data-k]'); // not the heading or the help under them
            if (li && suggesting) chooseSuggestion(+li.dataset.k);
        });
        addEventListener('scroll', () => suggesting && placeSuggest(), { passive: true });

        /** The name boxes in `wrap`: coloured as they're typed in, with fields offered when clicked into and after a "{". */
        function nameBoxes(wrap) {
            const isBox = (el) => el?.matches?.('.pdf-name');
            // Clicked or tabbed into: every field is offered, so it's plain they can be used.
            for (const type of ['focusin', 'click']) {
                wrap.addEventListener(type, (e) => {
                    if (!isBox(e.target) || e.target.disabled) return;
                    browsing = e.target;
                    suggest(e.target);
                });
            }
            // The caret moved by a key (clicks are above; typing is the box's input event) can start, end or change
            // what's offered. Not the "select" event: setting the caret from code fires it later, and it'd undo an Esc.
            const MOVES = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
            wrap.addEventListener('keyup', (e) => {
                if (!isBox(e.target) || !MOVES.has(e.key)) return;
                paintTemplate(e.target); // the box may have scrolled
                suggest(e.target);
            });
            wrap.addEventListener('scroll', (e) => isBox(e.target) && paintTemplate(e.target), true);
            wrap.addEventListener('focusout', (e) => isBox(e.target) && hideSuggest());
            wrap.addEventListener('keydown', (e) => {
                if (!suggesting || e.target !== suggesting.input) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') pickSuggestion(suggesting.active + (e.key === 'ArrowDown' ? 1 : -1));
                // Tab picks one only after a "{": otherwise it moves on, as it would.
                else if (e.key === 'Enter' || (e.key === 'Tab' && suggesting.mode === 'typed')) chooseSuggestion(suggesting.active);
                else if (e.key === 'Escape') hideSuggest();
                else return;
                e.preventDefault();
            });
        }

        /** A photo's bytes, by the quickest way that works: the ones that don't are skipped from then on. */
        async function fetchPhoto(p) {
            return (directFiles && (await fromApi(p))) || (fromStorage && (await fromStorageLink(p))) || throughFunction(p);
        }

        /** Straight from ServiceM8's API, with the token. Null if it isn't to be had that way. */
        async function fromApi(p) {
            try {
                const res = await api(`/attachment/${p.uuid}.file`);
                // Refused from here (e.g. where this photo is stored): another way may still get it.
                return res.ok ? await res.blob() : null;
            } catch (err) {
                if (!(err instanceof TypeError)) throw err;
                directFiles = false; // the file storage doesn't allow it; not tried again
                return null;
            }
        }

        /**
         * Straight from where it's stored, with the link the function gets for it (no token: the storage
         * link carries its own permission). Much quicker than through the function. Null if not.
         */
        async function fromStorageLink(p) {
            try {
                const { url } = await call('photos_to_pdf_photo_url', { uuid: p.uuid });
                if (!url) return null;
                const res = await fetch(url, { credentials: 'omit' });
                // Refused (e.g. the link expired): this one comes through the function.
                return res.ok ? await res.blob() : null;
            } catch (err) {
                if (!(err instanceof TypeError)) throw err;
                fromStorage = false; // the storage doesn't let the browser (CORS): not tried again
                return null;
            }
        }

        /** Through the function, a piece at a time (its replies are capped at 6 MB), each after the one before. */
        async function throughFunction(p) {
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

        // Five photos at a time: quicker than one by one, without swamping the connection.
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
            while (running < 5 && waiting.length) {
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
                checkDuplicate(p); // e.g. a photo that's on the job already
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
        /**
         * A PDF given its own name in Detailed has it as the list's `name`. Lists made afresh (dragging,
         * splitting) take the name of the PDF that was in their place, so PDF 2 is still called what it was.
         */
        const regroup = (lists) => lists.map((g, k) => Object.assign(g, { name: groups[k]?.name }));
        /** Whether the PDFs are just the photos split evenly (nothing's been dragged about). */
        const even = () => groups.every((g, k) => (k < groups.length - 1 ? g.length === perPdf : g.length <= perPdf));
        const leftOut = () => {
            const kept = new Set(groups.flat());
            return photos.filter((p) => !kept.has(p.uuid));
        };

        /** Out of its PDF, leaving a gap: nothing else moves ("Split into PDFs of…" closes gaps up). */
        function leaveOut(uuid) {
            for (const g of groups) if (g.includes(uuid)) g.splice(g.indexOf(uuid), 1);
            groups = groups.filter((g) => g.length);
        }
        /** Back in, at the end: in the last PDF if it has room, otherwise in a new one. */
        function putBack(uuids) {
            for (const uuid of uuids) {
                const last = groups.at(-1);
                if (last && last.length < perPdf) last.push(uuid);
                else groups.push([uuid]);
            }
        }

        /** The photos selected (uuids), to drag about or leave out together, and the one a Shift-click selects from. */
        const selected = new Set();
        let anchor = null;
        /** Every photo's uuid in the order shown: the PDFs (or Simple's list), then "Left out". */
        const shownOrder = () => Array.from(app.querySelectorAll('.groups .ogrid > li'), (li) => li.dataset.u);
        const isOut = (uuid) => !groups.some((g) => g.includes(uuid));

        /**
         * Leaves these photos out (true) or puts them back at the end (false), in the order given. Unless
         * a PDF comes or goes in Detailed, just they move, so the rest (and their thumbnails) stay as they are.
         */
        function setOut(uuids, out) {
            const wrap = app.querySelector('.groups');
            const pdfs = groups.length;
            if (out) uuids.forEach(leaveOut);
            else putBack(uuids);
            if (simple) groups = regroup(split(groups.flat())); // still even PDFs, in its one list
            else if (groups.length !== pdfs) return drawGroups(); // redrawn, to number them
            const li = (uuid) => wrap.querySelector(`li[data-u="${CSS.escape(uuid)}"]`);
            const lists = wrap.querySelectorAll('.pdf:not(.new) .ogrid');
            for (const uuid of uuids) {
                const gi = groups.findIndex((g) => g.includes(uuid));
                if (gi >= 0) lists[simple ? 0 : gi].appendChild(li(uuid));
            }
            // Left out ones are in the photos' own order.
            const outList = wrap.querySelector('.out .ogrid');
            for (const p of leftOut()) outList.appendChild(li(p.uuid));
            renumber(wrap);
            update();
        }

        /** The selected photos that are in a PDF, left out (true) or put back (false), and the selection cleared. */
        function setSelectedOut(out) {
            const uuids = shownOrder().filter((u) => selected.has(u) && isOut(u) !== out);
            selected.clear();
            anchor = null;
            if (uuids.length) setOut(uuids, out);
            else update();
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

        /** Switching to Simple puts the photos back into even PDFs, in the order they're in. */
        function setView(toSimple) {
            simple = toSimple;
            if (simple) groups = regroup(split(groups.flat()));
            try {
                localStorage.setItem(VIEW_KEY, simple ? 'simple' : 'detailed');
            } catch {
                // Not remembered next time; it still applies now.
            }
            render();
        }

        function render() {
            if (state.step === 'saved') renderSaved();
            else renderPick();
            fitFoot();
        }

        /** Saved: what was saved, anything that didn't work, and Done to close (ServiceM8 can't refresh the open job's diary). */
        function renderSaved() {
            const { pdfs } = state;
            const names = pdfs.flatMap((pdf) => pdf.names);
            const one = names.length === 1;
            const saved = one ? 'PDF saved' : `${names.length} PDFs saved`;
            const them = one ? 'it' : 'them';
            const split = pdfs.filter((pdf) => pdf.names.length > 1).length;
            const splitWhat = split === 1 ? "A PDF was too big for ServiceM8 in one file, so it's" : `${split} PDFs were too big for ServiceM8 in one file, so they're`;
            const shrunk = pdfs.flatMap((pdf) => pdf.shrunk);
            // Anything else worth saying, under what was saved: [class, text].
            const notes = [
                split && ['muted', `${splitWhat} saved in parts.`],
                shrunk.length && ['muted', `Too big for ServiceM8 even on their own, so made smaller to fit: ${shrunk.join(', ')}`],
                state.shrunk && ['muted', "This device can't send files straight to ServiceM8, so the photos were made smaller to fit."],
                state.failed.length && ['danger', `Left out (couldn't be read): ${state.failed.join(', ')}`],
                state.notInDiary.length && ['danger', `Couldn't add to the job diary (they're still in the PDFs): ${state.notInDiary.join(', ')}`],
            ].filter(Boolean);
            const list = names.map((name) => `<li>${esc(name)}</li>`).join('');
            const said = notes.map(([kind, text]) => `<p class="${kind}">${esc(text)}</p>`).join('');
            app.innerHTML = `
        <div class="center done">
            <div class="done-tick" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
            <h1>${saved} to the job diary</h1>
            <ul class="done-names muted">${list}</ul>
            <p class="done-reopen">Reopen the job to see ${them} in the job diary.</p>
        </div>
        <div class="foot">
            ${said}
            <button class="btn" id="done">Done</button>
        </div>`;
            app.querySelector('#done').onclick = () => client.closeWindow();
        }

        /** The photos, in their PDFs ("New PDF" to start another), then the ones left out. */
        function renderPick() {
            const hint = photos.length ? '' : 'No photos on this job yet. Add some from this device.';
            const checked = enlargeOn ? ' checked' : '';
            const enlargeToggle = canEnlarge ? `<label class="enlarge"><input type="checkbox" id="enlarge"${checked}> Enlarge on hover</label>` : '';
            const on = (isOn) => (isOn ? ' on' : '');
            // With a mouse (as for "Enlarge on hover") or a finger.
            const how = canEnlarge
                ? 'Click to select (Shift or Ctrl for more, or drag a box), then drag them. Double-click to leave one out or put it back.'
                : 'Tap to select, hold to drag, double-tap to leave one out or put it back.';
            const selectionBar = `<div class="selection-bar">
            <span class="muted" id="sel-how">${how}</span>
            <span id="sel-count"></span>
            <button class="link" id="sel-out">Leave out</button>
            <button class="link" id="sel-back">Put back</button>
            <button class="link" id="sel-clear">Clear</button>
        </div>`;
            app.innerHTML = `
        <div class="bar">
        <span class="view" role="group" aria-label="View">
            <button class="link${on(simple)}" id="view-simple" aria-pressed="${simple}">Simple</button>
            <button class="link${on(!simple)}" id="view-detailed" aria-pressed="${!simple}">Detailed</button>
        </span>
        <span class="muted">${hint}</span>
        <span class="actions">
            ${enlargeToggle}
            <button class="link" id="none">Leave all out</button>
            <button class="link" id="every">Put all back</button>
            <button class="link" id="add-photos">+ Add photos</button>
            <input type="file" id="add" accept="image/*" multiple hidden>
        </span>
        </div>
        ${photos.length ? '<div class="groups"></div>' : ''}
        <div class="foot">
        ${photos.length ? selectionBar : ''}
        <div class="per"${simple ? ' hidden' : ''}>
            <label for="per">Photos per PDF</label>
            <input type="number" id="per" min="1" max="${MAX_PER_PDF}" step="1" inputmode="numeric" value="${perPdf}">
            <span class="muted" id="pdfs"></span><span class="danger" id="over"></span>
            <button id="resplit"></button>
        </div>
        <p class="danger" id="error" hidden></p>
        <button class="btn" id="save"></button>
        </div>`;
            app.querySelector('#view-simple').onclick = () => {
                if (!simple) setView(true);
            };
            app.querySelector('#view-detailed').onclick = () => {
                if (simple) setView(false);
            };
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
                groups = regroup(split(groups.flat()));
                drawGroups();
            };
            app.querySelector('#save').onclick = save;
            if (photos.length) {
                app.querySelector('#sel-out').onclick = () => setSelectedOut(true);
                app.querySelector('#sel-back').onclick = () => setSelectedOut(false);
                app.querySelector('#sel-clear').onclick = () => {
                    selected.clear();
                    update();
                };
            }
            const enlarge = app.querySelector('#enlarge');
            if (enlarge) enlarge.onchange = () => setEnlarge(enlarge.checked);
            const add =app.querySelector('#add');
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
                hidePeek(); // its tile is about to go
                hideSuggest(); // and its name box
                hideHelp();
                const tile = (p) => `<li data-u="${esc(p.uuid)}"><button class="ph" data-i="${photos.indexOf(p)}" aria-label="${esc(p.name)}">
                <span class="ph-msg">Loading…</span><span class="dup" hidden>Duplicate</span>${p.file ? '<span class="dev"></span>' : ''}
            </button></li>`;
                // Beside a PDF's heading, its name. Simple: the template, for every PDF (with Reset, back to the
                // one in ServiceM8's settings). Detailed: each PDF's own (empty: the name from the template).
                // Each box is in a .name-field, with its text coloured in the layer behind it (paintTemplate).
                // Nothing to fill in. Browsers' own autofill ignores autocomplete="off" in a box they take for a person's
                // name (an id or label like "name"), but not a value it doesn't know; and password managers have their
                // own attributes (LastPass, 1Password, Bitwarden, Dashlane). Then "?", for how names work.
                const notLogin = 'autocomplete="photos-pdf-name" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"';
                const help = '<button type="button" class="name-help" aria-label="How names work" aria-expanded="false">?</button>';
                const box = (attrs) =>
                    `<span class="name-field"><span class="name-colours" aria-hidden="true"></span><input type="text" class="pdf-name" maxlength="200" spellcheck="false" ${notLogin} ${attrs}>${help}</span>`;
                // Empty until a name's typed in, with the name from the default (filled in) as its placeholder; Reset empties it.
                const nameBox = (gi) => {
                    if (gi === 'all') {
                        const typed = nameTemplate === boot.nameTemplate ? '' : nameTemplate;
                        return box(`id="template" value="${esc(typed)}" aria-label="What the PDFs are called"`) + '<button class="link" id="template-reset">Reset</button>';
                    }
                    if (gi === undefined) return '';
                    const reset = `<button class="link pdf-reset" data-g="${gi}" hidden>Reset</button>`;
                    return box(`data-g="${gi}" value="${esc(groups[gi].name ?? '')}" aria-label="What PDF ${gi + 1} is called"`) + reset;
                };
                // An empty list mustn't hold even whitespace, or it isn't :empty (its "Drag a photo here").
                const section = (kind, title, list, gi) => `<section class="group ${kind}">
            <div class="group-head"><h2>${title} <span class="count muted"></span></h2>${nameBox(gi)}<span class="pdf-saved muted"></span></div>
            <ul class="ogrid">${list.map(tile).join('')}</ul>
        </section>`;
                const wrap = document.createElement('div');
                wrap.className = 'groups';
                // Simple: the photos in one list, the PDFs split up when saved.
                const pdfs = simple
                    ? [section('pdf', 'Photos', groups.flat().map(byUuid), 'all')]
                    : [...groups.map((g, gi) => section('pdf', `PDF ${gi + 1}`, g.map(byUuid), gi)), section('pdf new', 'New PDF', [])];
                wrap.innerHTML = [...pdfs, section('out', 'Left out', leftOut())].join('');
                old.replaceWith(wrap);
                wrap.addEventListener('input', (e) => {
                    // Simple's: every PDF's name for this save (cleared: the default again).
                    if (e.target.id === 'template') nameTemplate = e.target.value.trim() ? e.target.value : boot.nameTemplate;
                    else if (e.target.matches('.pdf-name')) {
                        // Its own name, unless it's the template (or cleared).
                        const typed = e.target.value.trim();
                        groups[+e.target.dataset.g].name = typed && typed !== nameTemplate.trim() ? typed : undefined;
                    } else return;
                    update();
                    browsing = null; // typing: just the fields after a "{" from now on
                    suggest(e.target, true);
                });
                nameBoxes(wrap);
                wrap.addEventListener('click', (e) => {
                    const help = e.target.closest('.name-help');
                    if (help) return toggleHelp(help);
                    const reset = e.target.closest('#template-reset, .pdf-reset');
                    if (!reset) return;
                    if (reset.id === 'template-reset') nameTemplate = boot.nameTemplate;
                    else groups[+reset.dataset.g].name = undefined;
                    reset.closest('.group-head').querySelector('.pdf-name').value = ''; // the placeholder (the default) again
                    update();
                });
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
                el.classList.toggle('sel', selected.has(el.parentElement.dataset.u));
                const p = photos[+el.dataset.i];
                el.querySelector('.dup').hidden = !p.duplicate;
                el.setAttribute('aria-label', p.duplicate ? `${p.name} (duplicate)` : p.name);
                const dev = el.querySelector('.dev');
                if (dev) {
                    dev.textContent = DIARY_LABEL[p.diary];
                    dev.className = `dev ${p.diary}`;
                }
            });
            for (const id of ['#view-simple', '#view-detailed', '#add-photos', '#none', '#every', '#per', '#resplit']) app.querySelector(id).disabled = busy();
            updateSelectionBar();
            updateNames();
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

        /** How many are selected, with Leave out and Put back for those it applies to (or how to select, when none are). */
        function updateSelectionBar() {
            if (!app.querySelector('.selection-bar')) return; // no photos yet
            const uuids = [...selected];
            const show = (id, on) => {
                const el = app.querySelector(id);
                el.hidden = !on;
                if (el.tagName === 'BUTTON') el.disabled = busy();
            };
            show('#sel-how', !uuids.length);
            show('#sel-count', uuids.length);
            show('#sel-out', uuids.some((u) => !isOut(u)));
            show('#sel-back', uuids.some(isOut));
            show('#sel-clear', uuids.length);
            app.querySelector('#sel-count').textContent = `${uuids.length} selected`;
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

        // Esc clears the selection, Delete (or Backspace) leaves it out, and Ctrl+A selects every photo.
        document.addEventListener('keydown', (e) => {
            if (!app.querySelector('.groups') || busy() || e.target.closest?.('input')) return;
            if (e.key === 'Escape' && selected.size) {
                selected.clear();
                update();
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
                e.preventDefault();
                setSelectedOut(true);
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                for (const u of shownOrder()) selected.add(u);
                update();
            }
        });

        /** How far to scroll while the pointer is held within `margin` px of the top or bottom (above the footer). */
        function edgeStep(y, margin, speed) {
            const bottomEdge = innerHeight - (app.querySelector('.foot')?.offsetHeight ?? 0);
            if (y > bottomEdge - margin) return speed;
            if (y < margin) return -speed;
            return 0;
        }

        /** Counts as photos move about, which PDFs are over the limit, and which photos are left out. */
        function renumber(wrap) {
            for (const section of wrap.querySelectorAll('.group')) {
                const items = Array.from(section.querySelectorAll('.ogrid > li'));
                const inPdf = section.classList.contains('pdf');
                // A left out photo is greyed.
                for (const li of items) li.firstElementChild.classList.toggle('out', !inPdf);
                // Simple's one list is split up when saved, so it's never over the limit.
                const over = !simple && inPdf && items.length > perPdf;
                section.classList.toggle('over', over);
                let count = '';
                if (!simple && inPdf && items.length) count = `${items.length} of ${perPdf}${over ? ', over the limit' : ''}`;
                else if (items.length) count = String(items.length);
                section.querySelector('.count').textContent = count;
            }
        }

        /**
         * Click a photo to select it: Ctrl-click for one more (or one fewer), Shift-click for all those
         * from the last one clicked, or drag a box around them from a space between photos. On touch
         * screens, a tap selects or unselects. Drag a selected photo to move all those selected, in
         * their order (any other photo moves on its own) to where they should go: a new spot in its PDF,
         * another PDF, "New PDF" or "Left out"; the others move out of the way. With a mouse, dragging is
         * enough; on touch screens, press and hold first (moving straight away scrolls). Double-click (or
         * double-tap) a photo to leave it out, or put it back, on its own.
         */
        function arrangeable(wrap) {
            let drag = null;
            let box = null; // a box being dragged out, to select the photos it touches
            let dragged = false; // the click that ends a drag isn't a tap
            let pointer = 'mouse'; // what pressed last: a tap on a touch screen adds to the selection
            let lastClick = null; // the photo clicked last, when, and what was selected before: a second click soon after is a double-click
            const uuidsIn = (ul) => Array.from(ul.children, (li) => li.dataset.u);
            renumber(wrap);

            wrap.addEventListener('click', (e) => {
                const el = e.target.closest('.ph');
                if (!el || dragged || busy()) return;
                const uuid = el.parentElement.dataset.u;
                const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
                // Both clicks of a double-click (or tap) select: the selection goes back to what it was
                // before them, without this photo, and the photo's left out or put back on its own.
                if (plain && lastClick?.uuid === uuid && Date.now() - lastClick.at < 400) {
                    selected.clear();
                    for (const u of lastClick.before) if (u !== uuid) selected.add(u);
                    lastClick = null;
                    return setOut([uuid], !isOut(uuid));
                }
                lastClick = plain ? { uuid, at: Date.now(), before: new Set(selected) } : null;
                select(uuid, e);
            });

            function select(uuid, e) {
                const more = e.ctrlKey || e.metaKey;
                const order = shownOrder();
                if (e.shiftKey && order.includes(anchor)) {
                    const [a, b] = [order.indexOf(anchor), order.indexOf(uuid)].sort((x, y) => x - y);
                    if (!more) selected.clear();
                    for (const u of order.slice(a, b + 1)) selected.add(u);
                } else if (more || pointer !== 'mouse') {
                    if (selected.has(uuid)) selected.delete(uuid);
                    else selected.add(uuid);
                    anchor = uuid;
                } else {
                    // Just this one; clicked again on its own, nothing.
                    const only = selected.size === 1 && selected.has(uuid);
                    selected.clear();
                    if (!only) selected.add(uuid);
                    anchor = uuid;
                }
                update();
            }
            wrap.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menus
            // "Enlarge on hover": until the pointer leaves the photo, or it's pressed (to move it).
            wrap.addEventListener('pointerover', (e) => {
                const el = e.target.closest('.ph');
                if (el && e.pointerType === 'mouse' && !drag && !busy()) peek(el);
            });
            wrap.addEventListener('pointerout', (e) => {
                const el = e.target.closest('.ph');
                if (el && !el.contains(e.relatedTarget)) hidePeek();
            });
            // Once a photo's lifted, a finger moving mustn't scroll the page.
            wrap.addEventListener(
                'touchmove',
                (e) => {
                    if (drag?.lifted) e.preventDefault();
                },
                { passive: false },
            );

            wrap.addEventListener('pointerdown', (e) => {
                // One at a time: a second finger mustn't strand the first one's ghost.
                // A name box (or its Reset) isn't a drag, or a box to select photos.
                if (e.button > 0 || drag || box || busy() || e.target.closest('input, button:not(.ph)')) return;
                pointer = e.pointerType;
                const li = e.target.closest('li');
                if (!li) {
                    lastClick = null; // pressed between photos: the next click isn't a double-click
                    if (e.pointerType === 'mouse') startBox(e);
                    return;
                }
                hidePeek();
                dragged = false;
                drag = { li, id: e.pointerId, mouse: e.pointerType === 'mouse', x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, lifted: false };
                if (!drag.mouse) drag.timer = setTimeout(lift, 300);
            });
            wrap.addEventListener('pointermove', (e) => {
                if (box && e.pointerId === box.id) return moveBox(e);
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
                if (box && e.pointerId === box.id) endBox();
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
                // A selected photo takes the others selected with it; any other goes on its own.
                drag.members = selected.has(drag.li.dataset.u) ? Array.from(wrap.querySelectorAll('.ogrid > li')).filter((li) => selected.has(li.dataset.u)) : [drag.li];
                const r = drag.li.getBoundingClientRect();
                drag.offX = drag.cx - r.left;
                drag.offY = drag.cy - r.top;
                drag.ghost = drag.li.cloneNode(true);
                drag.ghost.className = 'ghost';
                Object.assign(drag.ghost.style, { width: `${r.width}px`, height: `${r.height}px` });
                if (drag.members.length > 1) {
                    drag.ghost.classList.add('stack');
                    const count = document.createElement('span');
                    count.className = 'ghost-count';
                    count.textContent = drag.members.length;
                    drag.ghost.append(count);
                }
                document.body.appendChild(drag.ghost);
                // The others are carried along (out of the lists) until it's dropped.
                for (const li of drag.members) if (li !== drag.li) li.remove();
                renumber(wrap);
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

            /** A box dragged out from a space between photos (with a mouse) selects those it touches; a click there clears the selection. */
            function startBox(e) {
                // Ctrl or Shift: added to what's selected already.
                const add = e.ctrlKey || e.metaKey || e.shiftKey;
                box = { id: e.pointerId, x: e.clientX + scrollX, y: e.clientY + scrollY, cx: e.clientX, cy: e.clientY, add, before: new Set(selected), el: null };
                try {
                    wrap.setPointerCapture(e.pointerId);
                } catch {
                    // Without capture the box just ends if the pointer leaves the photos.
                }
            }
            function moveBox(e) {
                box.cx = e.clientX;
                box.cy = e.clientY;
                if (!box.el) {
                    if (Math.hypot(box.cx + scrollX - box.x, box.cy + scrollY - box.y) < 6) return;
                    box.el = document.createElement('div');
                    box.el.className = 'lasso';
                    document.body.append(box.el);
                    document.body.classList.add('boxing');
                    boxScroll();
                }
                drawBox();
            }
            function drawBox() {
                // Where it started is kept on the page, so it stretches as the page scrolls.
                const x = box.x - scrollX;
                const y = box.y - scrollY;
                const left = Math.min(x, box.cx);
                const top = Math.min(y, box.cy);
                const right = Math.max(x, box.cx);
                const bottom = Math.max(y, box.cy);
                Object.assign(box.el.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
                selected.clear();
                if (box.add) for (const u of box.before) selected.add(u);
                for (const li of wrap.querySelectorAll('.ogrid > li')) {
                    const r = li.getBoundingClientRect();
                    if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) selected.add(li.dataset.u);
                }
                update();
            }
            function boxScroll() {
                if (!box?.el) return;
                const step = edgeStep(box.cy, 40, 12);
                if (step) {
                    const before = scrollY;
                    scrollBy(0, step);
                    if (scrollY !== before) drawBox();
                }
                requestAnimationFrame(boxScroll);
            }
            function endBox() {
                if (box.el) {
                    box.el.remove();
                    document.body.classList.remove('boxing');
                } else if (!box.add) {
                    selected.clear();
                    update();
                }
                box = null;
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
                    // The others go either side of it, in the order they were in.
                    const k = drag.members.indexOf(drag.li);
                    drag.li.before(...drag.members.slice(0, k));
                    drag.li.after(...drag.members.slice(k + 1));
                }
                drag = null;
                if (!lifted) return;
                // Until the drag's click has gone by (wherever it lands, if anywhere).
                dragged = true;
                setTimeout(() => {
                    dragged = false;
                });
                const pdfLists = Array.from(wrap.querySelectorAll('.pdf .ogrid'), uuidsIn);
                if (simple) {
                    groups = regroup(split(pdfLists[0])); // its one list, in even PDFs
                } else {
                    groups = regroup(pdfLists).filter((g) => g.length);
                    // A PDF emptied, or "New PDF" used: redrawn once the drag's click has gone by, to number
                    // the PDFs and for a fresh "New PDF". Otherwise the photo's already where it goes.
                    if (groups.length !== pdfLists.length - 1 || pdfLists.at(-1).length) return setTimeout(drawGroups);
                }
                for (const ul of wrap.querySelectorAll('.ogrid')) ul.style.minHeight = '';
                renumber(wrap);
                update();
            }
        }

        // Thumbnails load as they scroll into view.
        const urls = new Map(); // uuid -> a small copy's object URL ('' if this browser can't show the photo)
        const making = new Map(); // uuid -> Promise of that URL, while it's made
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
        /** A photo's small copy for its tile: '' if this browser can't show the photo (it's still in the PDFs). */
        async function smallCopy(p) {
            const blob = await photoBlob(p);
            try {
                return await thumbnail(blob);
            } catch {
                return '';
            }
        }
        function loadThumb(p) {
            if (!making.has(p.uuid)) making.set(p.uuid, smallCopy(p));
            making.get(p.uuid).then(
                (url) => {
                    urls.set(p.uuid, url);
                    making.delete(p.uuid);
                    // The grid may have been redrawn while it loaded.
                    const now = app.querySelector(`.ph[data-i="${photos.indexOf(p)}"]`);
                    if (now) showThumb(now, p);
                },
                (err) => {
                    making.delete(p.uuid); // tried again when it's next seen, or saved
                    const now = app.querySelector(`.ph[data-i="${photos.indexOf(p)}"]`);
                    const msg = now?.querySelector('.ph-msg');
                    if (msg) msg.textContent = "Couldn't load";
                    console.warn(`Photo ${p.name} couldn't load:`, errText(err)); // for whoever looks
                },
            );
        }
        function showThumb(el, p) {
            // A tile redrawn while its photo loaded is seen (and loaded) twice: show it once.
            if (el.querySelector('img')) return;
            const url = urls.get(p.uuid);
            const msg = el.querySelector('.ph-msg');
            // Photos this browser can't show (e.g. HEIC outside Safari) keep their name instead.
            if (!url) {
                if (msg) msg.textContent = p.name;
                return;
            }
            const img = new Image();
            img.alt = p.name;
            img.draggable = false;
            img.src = url;
            img.onload = () => el.querySelector('.ph-msg')?.remove();
            el.prepend(img);
        }

        // ----- Enlarge on hover -----

        const peekBox = document.createElement('div');
        peekBox.className = 'peek';
        peekBox.hidden = true;
        document.body.append(peekBox);
        let peeking = null; // the photo pointed at (shown bigger once the wait's over)
        let peekUrl = null; // its full size object URL, once it's shown
        let peekTimer = null;
        /** How long to point at a photo before it's shown bigger (ms), and the most it's shown at (px). */
        const PEEK_WAIT = 400;
        const PEEK_MAX = 420;
        // Scrolling moves the tiles out from under it.
        addEventListener('scroll', () => hidePeek(), { passive: true });

        function setEnlarge(on) {
            enlargeOn = on;
            if (!on) hidePeek();
            try {
                localStorage.setItem(ENLARGE_KEY, on ? '1' : '0');
            } catch {
                // Not remembered next time; it still applies now.
            }
        }

        /**
         * Points at the photo on tile `el`: after a moment it's shown bigger beside its tile. Each photo
         * waits its moment, so moving along the photos doesn't flash each one up.
         */
        function peek(el) {
            const p = photos[+el.dataset.i];
            if (!enlargeOn || peeking === p) return;
            hidePeek();
            peeking = p;
            peekTimer = setTimeout(() => showPeek(el, p), PEEK_WAIT);
        }

        /** Beside its tile, on the side with more room: its small copy straight away, then the photo itself. */
        function showPeek(el, p) {
            const small = el.querySelector('img');
            if (peeking !== p || !el.isConnected || !small?.naturalWidth) return; // still loading, or this browser can't show it
            const r = el.getBoundingClientRect();
            const gap = 8;
            const edge = 12;
            const roomRight = innerWidth - r.right - gap - edge;
            const roomLeft = r.left - gap - edge;
            const right = roomRight >= roomLeft;
            const fit = Math.min(
                Math.min(PEEK_MAX, Math.max(roomRight, roomLeft)) / small.naturalWidth,
                Math.min(PEEK_MAX, innerHeight - 2 * edge) / small.naturalHeight,
            );
            const w = Math.round(small.naturalWidth * fit);
            const h = Math.round(small.naturalHeight * fit);
            const top = Math.min(Math.max(r.top + r.height / 2 - h / 2, edge), innerHeight - edge - h);
            const img = new Image();
            img.alt = p.name;
            img.width = w;
            img.height = h;
            img.src = small.src;
            Object.assign(peekBox.style, { left: `${right ? r.right + gap : r.left - gap - w}px`, top: `${top}px` });
            peekBox.replaceChildren(img);
            peekBox.hidden = false;
            photoBlob(p).then(async (blob) => {
                if (!img.isConnected) return; // moved off it, or onto another
                const url = URL.createObjectURL(blob);
                const full = new Image();
                full.src = url;
                try {
                    await full.decode();
                } catch {
                    // Leaves the small copy showing.
                }
                if (!img.isConnected || !full.naturalWidth) return URL.revokeObjectURL(url);
                peekUrl = url;
                img.src = url;
            }, () => { }); // the small copy stays
        }

        function hidePeek() {
            clearTimeout(peekTimer);
            peeking = null;
            peekBox.hidden = true;
            peekBox.replaceChildren();
            if (peekUrl) URL.revokeObjectURL(peekUrl);
            peekUrl = null;
        }

        /** How big a tile's copy is (its short side, px): enough for a sharp tile on a high-resolution screen. */
        const THUMB = 240;
        let thumbing = Promise.resolve(); // one at a time: decoding a photo takes a lot of memory for a moment
        /**
         * A small copy of a photo for its tile. Shown as it is, a 12-megapixel photo is decoded in full
         * for a ~104px square, and a job's worth of those can run a phone out of memory.
         */
        function thumbnail(blob) {
            const made = thumbing.then(async () => {
                const url = URL.createObjectURL(blob);
                const canvas = document.createElement('canvas');
                try {
                    const img = new Image();
                    img.src = url;
                    await img.decode(); // natural* include the EXIF rotation
                    const scale = Math.min(1, THUMB / Math.min(img.naturalWidth, img.naturalHeight));
                    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#fff'; // transparent PNGs
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const small = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
                    if (!small) throw new Error("Couldn't make a thumbnail");
                    return URL.createObjectURL(small);
                } finally {
                    URL.revokeObjectURL(url);
                    canvas.width = canvas.height = 0; // iOS keeps canvas memory until it's resized
                }
            });
            thumbing = made.catch(() => { });
            return made;
        }

        /**
         * PDFs saved by a save that then failed (photo uuids -> what was saved): saving again skips them,
         * and carries on from the next part of one saved in parts part way.
         */
        const savedBefore = new Map();

        /** Makes and saves each PDF in turn, so only one is ever held in memory. */
        async function save() {
            error = null;
            hidePeek();
            const list = groups.map((g) => g.map(byUuid));
            const names = list.map((_, k) => nameOf(k, list.length));
            // Straight to ServiceM8, photos go in as PDF_PHOTO. Through the function, each PDF has to fit its payload limit.
            const maxBytes = direct ? Infinity : RELAY_MAX;
            const pdfs = [];
            const failed = [];
            let gi = 0;
            // One PDF at a time, each starting when the one before is saved.
            async function next() {
                if (gi >= list.length) return;
                const before = savedBefore.get(list[gi].map((p) => p.uuid).join());
                const saved = before?.complete ? before : await savePdf(list, gi, names[gi], maxBytes, before);
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

        /** Makes PDF number `gi` of `list`, called `name`, and adds it to the job diary (in parts, if it's too big for ServiceM8 in one). */
        async function savePdf(list, gi, name, maxBytes, partWay) {
            const photosIn = list[gi];
            const saved = partWay || { names: [], done: 0, pages: [], failed: [], shrunk: [], complete: false };
            savedBefore.set(photosIn.map((p) => p.uuid).join(), saved);
            const progress = (done) => {
                state = { step: 'making', pdf: gi, of: list.length, n: photosIn.length, done };
                update();
            };
            progress(0);
            const pdf = await photosPdf(photosIn, maxBytes, progress);
            Object.assign(saved, { pages: pdf.pages, failed: pdf.failed });
            if (pdf.pages.length) {
                state = { step: 'saving', pdf: gi, of: list.length };
                update();
                // Pages already saved (in parts, by a save that then failed) aren't saved again.
                await uploadInParts(pdf.pages.slice(saved.done), name, saved);
            }
            saved.complete = true;
            return saved;
        }

        /**
         * ServiceM8 turns away files over a size it doesn't say (413). When it does, that size is noted
         * (and remembered on this device), and PDFs are split into parts under it from then on: the
         * photos stay as they are, in the same order.
         */
        const PDF_LIMIT_KEY = 'photos-to-pdf:pdf-limit';
        let pdfLimit = Infinity;
        try {
            pdfLimit = Number(localStorage.getItem(PDF_LIMIT_KEY)) || Infinity;
        } catch {
            // Not remembered: learnt again if ServiceM8 turns a PDF away.
        }
        function learnLimit(bytes) {
            pdfLimit = Math.min(pdfLimit, Math.floor(bytes * 0.9));
            try {
                localStorage.setItem(PDF_LIMIT_KEY, String(pdfLimit));
            } catch {
                // Learnt for now, not next time.
            }
        }
        /** A page's share of a PDF's size: its photo, and a little for the PDF's own structure. */
        const pageBytes = (page) => (page.data instanceof Blob ? page.data.size : page.data.length) + 1024;
        /** Pages in order, in parts each under the limit (a page too big on its own is a part by itself). */
        function bySize(pages) {
            const parts = [];
            let size = 0;
            for (const page of pages) {
                if (!parts.length || size + pageBytes(page) > pdfLimit) {
                    parts.push([]);
                    size = 1024;
                }
                parts.at(-1).push(page);
                size += pageBytes(page);
            }
            return parts;
        }

        /** Uploads the pages as one PDF, or as parts ("… part 2.pdf") if ServiceM8 needs them smaller. */
        async function uploadInParts(pages, name, saved) {
            let rest = pages;
            async function next() {
                if (!rest.length) return;
                const parts = bySize(rest);
                const these = parts[0];
                const split = parts.length > 1 || saved.names.length > 0;
                const blob = writePdf(these);
                try {
                    saved.names.push(await uploadAttachment(split ? `${name} part ${saved.names.length + 1}.pdf` : `${name}.pdf`, blob, 'pdf'));
                } catch (err) {
                    if (!err.tooBig) throw err;
                    learnLimit(blob.size);
                    if (pdfLimit < 256 * 1024) throw new Error("ServiceM8 won't take a PDF that small. Please try again later.");
                    // One photo too big for ServiceM8 by itself: only it is made smaller, just enough.
                    if (these.length === 1) await shrinkPage(these[0], saved);
                    return next(); // the same pages again, split to the new limit
                }
                saved.done += these.length;
                rest = rest.slice(these.length);
                return next();
            }
            await next();
        }

        async function shrinkPage(page, saved) {
            // Full size first, then a little smaller each time, until it's under the limit.
            const steps = [[Infinity, 0.9], [Infinity, 0.8], ...DIARY_STEPS, ...STEPS];
            const small = await toJpeg(await photoBlob(page.photo), Math.floor(pdfLimit * 0.9), steps);
            Object.assign(page, small, { orientation: 1, grey: false });
            if (!saved.shrunk.includes(page.photo.name)) saved.shrunk.push(page.photo.name);
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
            const err = new Error(`ServiceM8 didn't accept ${kind === 'pdf' ? 'the PDF' : 'the photo'} (${res.status}).`);
            err.tooBig = res.status === 413;
            throw err;
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

        // ----- Making a PDF (one photo per page) -----

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

        /**
         * Photos go in a PDF at up to this long edge (px) and JPEG quality: about 280 dpi across an A4
         * page, so details can still be zoomed into, at a fraction of a phone photo's size.
         */
        const PDF_PHOTO = [[2400, 0.8]];
        /** A JPEG this small (and no bigger than PDF_PHOTO's edge) goes in as it is: compressing it again would only lose detail. */
        const SMALL_JPEG = 800 * 1024;
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
         * A photo for a PDF page: compressed a little (PDF_PHOTO), unless it's a JPEG that's small
         * already, which goes in as it is, its own bytes (the PDF turns it the way its EXIF says).
         */
        async function forPdf(blob) {
            const jpeg = await jpegInfo(blob);
            if (jpeg && blob.size <= SMALL_JPEG && Math.max(jpeg.width, jpeg.height) <= PDF_PHOTO[0][0]) return { data: blob, ...jpeg };
            return toJpeg(blob, Infinity, PDF_PHOTO);
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
                    const image = shrink ? await toJpeg(blob, Math.min(perPhoto, (maxBytes - used) / (list.length - i))) : await forPdf(blob);
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
            return { pages, failed };
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

        // ----- Duplicates: a photo exactly the same (byte for byte) as one before it is tagged "Duplicate" -----

        /** Each photo's SHA-256 (as a string) -> the photos with it, so far. */
        const seen = new Map();

        /**
         * Tags the photo, as soon as it's loaded, if it's a copy of another: of those that are the same,
         * the first in the job is the original and the rest are tagged. That doesn't wait for photos still
         * loading: whichever comes first, the later of two the same is a copy (an earlier one loading later
         * only makes the one that was first a copy too). Nothing moves: it's only a tag.
         */
        function checkDuplicate(p) {
            if (!crypto.subtle) return; // not in this window (it isn't https): no tags
            photoBlob(p)
                .then(async (blob) => {
                    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
                    const hash = String.fromCodePoint(...new Uint8Array(digest));
                    const same = seen.get(hash) ?? [];
                    same.push(p);
                    seen.set(hash, same);
                    if (same.length < 2) return;
                    const first = same.reduce((a, b) => (photos.indexOf(a) < photos.indexOf(b) ? a : b));
                    for (const q of same) q.duplicate = q !== first;
                    update();
                })
                .catch(() => { }); // couldn't be read: not checked (its tile says so)
        }

        render();
        // After the tiles in view have asked for their photos, so they load first.
        setTimeout(() => photos.forEach(checkDuplicate), 300);
    }

    void photosToPdf();
}

/** The page's script: photosToPdfPage and the helpers it uses, in a scope of their own, started with the page's data. */
function pageScript() {
    const code = [jpegInfo, jpegHeader, isFrame, frame, exifOrientation, fillTemplate, templateParts, fieldAt, photosToPdfPage].map(String).join('\n\n');
    return `(() => {\n${code}\n\nphotosToPdfPage(JSON.parse(document.getElementById('app').dataset.boot));\n})();`;
}

module.exports = { shell, pageScript, fillTemplate, templateParts };
