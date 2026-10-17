/*
 * The PDF name's template (src/page/names/template.ts), on its own.
 */

import { expect, test } from 'bun:test';
import { DEFAULT_NAME } from '../src/function/page';
import { fillTemplate, templateParts } from '../src/page/names/template';

const job = { generated_job_id: '123', purchase_order_number: 'WA4567', job_address: '1 Main St', status: '' };
const fill = (template: string) => fillTemplate(template, { job });

test('fills in job fields, like ServiceM8 templates', () => {
    expect(fill(DEFAULT_NAME)).toBe('Job #123 Photos - PO WA4567');
    expect(fillTemplate(DEFAULT_NAME, { job: { ...job, purchase_order_number: '' } })).toBe('Job #123 Photos');
    expect(fill('{JOB.Job_Address}  -   {job.generated_job_id}')).toBe('1 Main St - 123');
    // A field it doesn't know stays as written; a section with an empty one goes.
    expect(fill('{job.nope} {client.name} [{job.status}x]')).toBe('{job.nope} {client.name}');
    // A section without empty fields is kept, without its brackets; a lone bracket stays.
    expect(fill('[Photos] [{job.nope}] a [ b')).toBe('Photos {job.nope} a [ b');
    // A field's value isn't filled in again.
    expect(fillTemplate('{job.a}', { job: { a: '{job.b}', b: 'x' } })).toBe('{job.b}');
    expect(fill('')).toBe('');
});

test('says which [ ] sections are left out, and for which empty fields', () => {
    const empty = { generated_job_id: '123', purchase_order_number: '', job_address: '1 Main St' };
    expect(templateParts('Job {job.generated_job_id}[ - PO {job.purchase_order_number}][ at {job.job_address}]', { job: empty })).toEqual([
        { text: 'Job ' },
        { text: '123' },
        { text: ' - PO ', dropped: true, empty: ['purchase_order_number'] },
        { text: ' at 1 Main St' },
    ]);
});
