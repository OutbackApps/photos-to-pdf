/*
 * Small helpers used across the popup.
 */

const HTML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text that's safe in HTML, attribute values included. */
export const esc = (s: unknown): string => String(s ?? '').replaceAll(/[&<>"']/g, (c) => HTML[c] ?? c);

/** An error's message, for the staff member. */
export const errText = (err: unknown): string => (err instanceof Error && err.message ? err.message : String(err));

/** A string's characters as bytes (each under 256: atob's output, and the PDF's own text). */
export const latin1 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(s, (c) => c.codePointAt(0) ?? 0);

/** What's remembered on this device (localStorage), or null: not set, or this window has no storage. */
export function recall(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Remembers it on this device, if this window has storage (it still applies now, either way). */
export function remember(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Not remembered next time.
    }
}

/** The element that must be there (under `root`), typed. */
export function el<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`The popup is missing ${selector}`);
    return found;
}

/** An event's target, as the element it is. */
export const targetOf = (e: Event): HTMLElement => e.target as HTMLElement;
