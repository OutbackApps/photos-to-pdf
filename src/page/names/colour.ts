/*
 * A template coloured in: fields the job has, ones it doesn't (they stay as typed), and each [ ] section
 * (left out when a field in it is empty), tinted as a whole so it's plain what goes with the field.
 */

import { store } from '../store';
import { esc } from '../util';

/** A template as HTML, coloured. */
export function colourTemplate(template: string): string {
    const fields = (text: string) =>
        text.replaceAll(/\{(\w+)\.(\w+)\}/g, (whole, object: string, key: string) => {
            const known = object.toLowerCase() === 'job' && Object.hasOwn(store.job.fields, key.toLowerCase());
            return `<span class="${known ? 't-field' : 't-bad'}">${whole}</span>`;
        });
    const bracket = (b: string) => `<span class="t-opt">${b}</span>`;
    return esc(template).replaceAll(/\[([^[\]]*)\]|[^[]+|\[/g, (whole, section?: string) =>
        section === undefined ? fields(whole) : '<span class="t-section">' + bracket('[') + fields(section) + bracket(']') + '</span>',
    );
}

/** A name box's text, coloured, in the layer behind it (the box's own text is see-through). */
export function paintTemplate(input: HTMLInputElement): void {
    const layer = input.previousElementSibling as HTMLElement;
    layer.innerHTML = colourTemplate(input.value);
    layer.scrollLeft = input.scrollLeft; // a long name scrolls in its box
}
