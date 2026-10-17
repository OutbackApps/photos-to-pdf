/*
 * The popup's HTML: ServiceM8's SDK and stylesheet, then the popup's own styles and script (built from
 * src/page by scripts/build-page.ts), started with the job and who opened it.
 */

import type { Boot } from '../shared/types';
import { log } from './log';
import { PAGE_CSS, PAGE_SCRIPT } from './page-assets.gen';
import { type AddonEvent, needUuid, str } from './servicem8';

/** The PDF name's template when the account hasn't set one (the same as `default` in addon.jsonc's preferences). */
export const DEFAULT_NAME = 'Job #{job.generated_job_id} Photos[ - PO {job.purchase_order_number}]';

/** Text that's safe in HTML, attribute values included. */
const escapeHtml = (s: string) => s.replaceAll(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The popup, for the job card's button. */
export function page(event: AddonEvent): string {
    const jobUUID = needUuid(event.eventArgs?.jobUUID, 'job');
    // Set in ServiceM8's Settings → Preferences → Add-ons; the popup can change it before saving.
    const nameTemplate = str(event.preferences?.pdf_name) ?? DEFAULT_NAME;
    const boot: Boot = { jobUUID, staffUUID: event.auth.staffUUID ?? null, token: event.auth.accessToken, nameTemplate };
    // Whether ServiceM8 sent the preferences at all: Addon Kit says they have no effect, its docs say they do.
    log('info', 'Opened Photos to PDF', { accountUUID: event.auth.accountUUID, jobUUID, preferences: Boolean(event.preferences), nameTemplate });
    // The page's data goes in an attribute, not the script, so it only needs HTML escaping.
    const app = `<div id="app" data-boot="${escapeHtml(JSON.stringify(boot))}"></div>`;
    // A script can't hold "</script" (it'd end it): written as "<\/script", which is the same to JavaScript.
    return shell(app, `<script>${PAGE_SCRIPT.replaceAll('</script', String.raw`<\/script`)}</script>`);
}

/** The popup when it can't start (e.g. no job): just why. */
export function errorPage(message: string): string {
    return shell(`<h1>Photos to PDF</h1><p class="danger">${escapeHtml(message)}</p>`, '');
}

function shell(body: string, script: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Photos to PDF</title>
<script src="https://platform.servicem8.com/sdk/1.0/sdk.js"></script>
<link rel="stylesheet" href="https://platform.servicem8.com/sdk/1.0/sdk.css">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap">
<style>${PAGE_CSS}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}
