import type { SampleSet } from './audio';

// User sample sets live in /samples/<id>/ (git-ignored) with a manifest.json:
//   { "label": "...", "urls": { "A4": "a4.ogg", ... }, "loop": [0.3, 0.9], "release": 0.1 }
// Found at build time, so restart the dev server after adding a set.
type Manifest = Omit<SampleSet, 'id' | 'baseUrl'>;

const manifests = import.meta.glob<Manifest>('/samples/*/manifest.json', { eager: true, import: 'default' });
const files = import.meta.glob<string>('/samples/*/*.{ogg,mp3,wav,flac}', { eager: true, query: '?url', import: 'default' });

export function userSampleSets(): SampleSet[] {
  return Object.entries(manifests).map(([path, m]) => {
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    const id = dir.split('/').at(-2)!;
    // Resolve each file to the URL Vite serves it at.
    const urls = Object.fromEntries(Object.entries(m.urls).map(([note, file]) => [note, files[dir + file] ?? dir + file]));
    return { ...m, id, label: m.label || id, baseUrl: '', urls };
  });
}
