import type { SampleSet } from './audio';

// User sample sets, read at run time from /user-samples/ (the "samples" folder next to the
// exe, or the project's samples/ folder in dev). Returns [] if there are none.
export async function userSampleSets(): Promise<SampleSet[]> {
  try {
    const res = await fetch('/user-samples/index.json');
    if (!res.ok) return [];
    const list = (await res.json()) as (Omit<SampleSet, 'baseUrl'> & { label?: string })[];
    return list.map(m => ({ ...m, label: m.label || m.id, baseUrl: `/user-samples/${encodeURIComponent(m.id)}/` }));
  } catch {
    return [];
  }
}
