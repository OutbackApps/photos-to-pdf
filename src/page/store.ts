/*
 * The popup's state: the job and its photos, how they're arranged into PDFs, the view, what's selected,
 * and where saving is up to. One object, so every part of the popup sees the same.
 */

import type { Job, JobPhoto } from '../shared/types';
import { boot } from './env';
import type { Page } from './pdf/images';
import { recall } from './util';

/** A photo: from the job diary, or added from this device (its file, and how adding it to the diary went). */
export interface Photo extends JobPhoto {
    file?: File;
    diary?: 'saving' | 'saved' | 'failed';
    /** Exactly the same file as one before it in the job. */
    duplicate?: boolean;
}

/** A PDF: its photos' uuids, in page order, and its own name, if it's been given one in Detailed. */
export type Group = string[] & { name?: string };

/** One PDF as it's saved: the names it was saved under (several if in parts), and how far it got. */
export interface SavedPdf {
    names: string[];
    /** How many of its pages are saved (a save that stopped part way carries on from there). */
    done: number;
    pages: Page[];
    /** Its photos that couldn't be read. */
    failed: string[];
    /** Its photos made smaller to fit ServiceM8. */
    shrunk: string[];
    complete: boolean;
}

/** Where the popup's up to: arranging the photos, saving (and how far), or saved. */
export type Step =
    | { step: 'pick' }
    | { step: 'diary' }
    | { step: 'making'; pdf: number; of: number; n: number; done: number }
    | { step: 'saving'; pdf: number; of: number }
    | { step: 'saved'; pdfs: SavedPdf[]; failed: string[]; notInDiary: string[]; shrunk: boolean };

/** At most this many photos per PDF; the staff member can choose fewer, remembered on this device. */
export const MAX_PER_PDF = 50;
export const PER_PDF_KEY = 'photos-to-pdf:per-pdf';
export const VIEW_KEY = 'photos-to-pdf:view';

/** A number of photos per PDF typed in: a whole number from 1 to MAX_PER_PDF, or null. */
export function perPdfFrom(value: unknown): number | null {
    const n = Math.floor(Number(value));
    return n >= 1 ? Math.min(n, MAX_PER_PDF) : null;
}

export const store = {
    job: { uuid: boot.jobUUID, fields: {} } as Job,
    photos: [] as Photo[],
    /** Whether this browser may use the ServiceM8 API itself (otherwise everything goes through the function). */
    direct: false,
    /** Simple (one list, split evenly when saved) or Detailed (each PDF arranged): Simple unless Detailed was used last here. */
    simple: recall(VIEW_KEY) !== 'detailed',
    perPdf: perPdfFrom(recall(PER_PDF_KEY)) ?? MAX_PER_PDF,
    step: { step: 'pick' } as Step,
    /** Why the last save stopped, shown above the save button. */
    error: null as string | null,
    /** The PDFs' name: the template from ServiceM8's settings, or what it's changed to for this save. */
    nameTemplate: boot.nameTemplate,
    /** The PDFs, in order; any photo not in one is left out. */
    groups: [] as Group[],
    /** The photos selected (uuids), and the one a Shift-click selects from. */
    selected: new Set<string>(),
    anchor: null as string | null,
};

/** Saving: nothing can be changed until it's done. */
export const busy = (): boolean => ['diary', 'making', 'saving'].includes(store.step.step);

export function byUuid(uuid: string): Photo {
    const photo = store.photos.find((p) => p.uuid === uuid);
    if (!photo) throw new Error(`No photo ${uuid}`);
    return photo;
}
