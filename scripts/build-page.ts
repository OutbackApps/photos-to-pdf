/*
 * Builds the popup: src/page/main.ts and what it imports, bundled by Bun into one script, and its
 * styles, into src/function/page-assets.gen.ts (not in the repo), which the function serves.
 * `bun run build`; the tests, `bun run typecheck`, `bun run check` and `bun run deploy` build it first.
 */

import path from 'node:path';

const root = path.join(import.meta.dir, '..');
export const OUT = path.join(root, 'src', 'function', 'page-assets.gen.ts');

export async function buildPage(): Promise<void> {
    const result = await Bun.build({
        entrypoints: [path.join(root, 'src', 'page', 'main.ts')],
        target: 'browser',
        format: 'iife',
        minify: true,
    });
    const [script] = result.outputs;
    if (!result.success || !script) throw new AggregateError(result.logs, "The popup's script didn't build");
    const css = await Bun.file(path.join(root, 'src', 'page', 'styles.css')).text();
    const out = [
        "// Built by scripts/build-page.ts from src/page (bun run build): don't edit, and not in the repo.",
        `export const PAGE_SCRIPT = ${JSON.stringify(await script.text())};`,
        `export const PAGE_CSS = ${JSON.stringify(css)};`,
        '',
    ].join('\n');
    // Written only when it's changed, so whatever's watching it isn't told about nothing.
    if ((await Bun.file(OUT).exists()) && (await Bun.file(OUT).text()) === out) return;
    await Bun.write(OUT, out);
}

if (import.meta.main) await buildPage();
