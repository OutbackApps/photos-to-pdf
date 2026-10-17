/*
 * Where the popup runs: its page element, what the function started it with, and ServiceM8's SDK.
 */

import type { Boot } from '../shared/types';

/** ServiceM8's SDK in this window (sdk.js, loaded before the popup's script). */
export interface ServiceM8Client {
    resizeWindow(width: number, height: number): void;
    closeWindow(): void;
    invoke(eventName: string, args: object): Promise<unknown>;
}

declare global {
    // sdk.js puts it on the window.
    var SMClient: { init(): ServiceM8Client };
}

/** The popup's page: everything's drawn in here. */
export const app = document.getElementById('app') as HTMLElement;

/** What the function started it with (#app's data-boot). */
export const boot: Boot = JSON.parse(app.dataset.boot ?? '{}');

export const client = globalThis.SMClient.init();
