/*
 * The PDF name's template: filled in the way ServiceM8's email templates are. No page state: tested on
 * its own (test/template.test.ts).
 */

/** A part of a filled-in template: its text, and for a [ ] section left out, the empty fields that left it out. */
export interface TemplatePart {
    text: string;
    dropped?: true;
    empty?: string[];
}

/** Field values by object: `{ job: { purchase_order_number: '77', ... } }`. */
export type TemplateValues = Record<string, Record<string, string>>;

/**
 * Fills in a name template: {job.purchase_order_number} is that field of the job (`values.job`). Text
 * in [ ] is left out when a field in it is empty, so "Photos[ - PO {job.purchase_order_number}]" is just
 * "Photos" for a job without one. A field it doesn't know stays as it's written, so a mistake shows.
 */
export function fillTemplate(template: string, values: TemplateValues): string {
    const kept = templateParts(template, values).filter((part) => !part.dropped);
    return kept.map((part) => part.text).join('').replaceAll(/\s+/g, ' ').trim();
}

/**
 * A name template filled in (as fillTemplate), in parts: `{ text }`, and for a [ ] section left out,
 * `{ text, dropped: true, empty }` (the text it would have had, and its fields that are empty), so the
 * popup can say what was left out and why.
 */
export function templateParts(template: string, values: TemplateValues): TemplatePart[] {
    const field = (whole: string, object: string, key: string) => {
        const fields = values[object.toLowerCase()];
        const name = key.toLowerCase();
        if (!fields || !Object.hasOwn(fields, name)) return { text: whole, empty: false, name };
        const text = String(fields[name] ?? '').trim();
        return { text, empty: !text, name };
    };
    const PLACEHOLDER = /\{(\w+)\.(\w+)\}/g;
    const source = String(template ?? '');
    const parts: TemplatePart[] = [];
    let at = 0;
    for (const m of source.matchAll(/\[([^[\]]*)\]|\{(\w+)\.(\w+)\}/g)) {
        if (m.index > at) parts.push({ text: source.slice(at, m.index) });
        at = m.index + m[0].length;
        const [whole, section, object = '', key = ''] = m;
        if (section === undefined) {
            parts.push({ text: field(whole, object, key).text });
            continue;
        }
        const found = Array.from(section.matchAll(PLACEHOLDER), (f) => field(f[0], f[1] ?? '', f[2] ?? ''));
        let k = 0;
        const text = section.replaceAll(PLACEHOLDER, () => found[k++]?.text ?? '');
        const empty = found.filter((f) => f.empty).map((f) => f.name);
        parts.push(empty.length ? { text, dropped: true, empty } : { text });
    }
    if (at < source.length) parts.push({ text: source.slice(at) });
    return parts;
}

/** The whole field ("{job.…}") a name box's caret is in, if it's in one (just after its "{" to just before its "}"). */
export function fieldAt(input: HTMLInputElement): { start: number; end: number; key: string } | null {
    const caret = input.selectionStart ?? 0;
    if (input.selectionEnd !== caret) return null;
    for (const m of input.value.matchAll(/\{(\w+)\.(\w+)\}/g)) {
        if (m.index < caret && caret < m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, key: (m[2] ?? '').toLowerCase() };
    }
    return null;
}
