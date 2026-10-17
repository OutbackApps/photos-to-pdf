/*
 * The job's fields, as offered in the name boxes.
 */

import { store } from '../store';

/** Friendlier names for the job fields most used in a name, offered first (any of the job's fields can be used). */
export const FIELD_LABELS: Record<string, string> = {
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

/** A field offered: its key, friendly name (if it has one) and value on this job. */
export interface FieldChoice {
    key: string;
    label: string;
    value: string;
}

let choices: FieldChoice[] | null = null;

/** The fields offered: those above first, then the rest of the job's, but not its ids. */
export function fieldChoices(): FieldChoice[] {
    if (choices) return choices;
    const fields = store.job.fields;
    const keys = Object.keys(fields).filter((k) => !/(^|_)uuid$/.test(k) && k !== 'active');
    const first = Object.keys(FIELD_LABELS).filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !FIELD_LABELS[k]).sort((a, b) => a.localeCompare(b));
    choices = [...first, ...rest].map((key) => ({ key, label: FIELD_LABELS[key] ?? '', value: fields[key] ?? '' }));
    return choices;
}

/** A field's friendly name, or its key. */
export const labelOf = (key: string): string => FIELD_LABELS[key] ?? key;
