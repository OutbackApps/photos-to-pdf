/** Structured JSON logs, one object per line, for `bun run tail` (never log the event: it holds the access token). */
export function log(level: 'info' | 'warn' | 'error', message: string, context: Record<string, unknown> = {}): void {
    const line = JSON.stringify({ level, message, ...context });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}
