import fs from 'node:fs';
import path from 'node:path';

// User sample sets live in <dir>/<id>/ with a manifest.json:
//   { "label": "...", "urls": { "A4": "a4.ogg", ... }, "loop": [0.3, 0.9], "release": 0.1 }
// Read at run time (by the Electron shell and the dev server) so nothing gets bundled into
// the app, and anyone can drop their own sets next to the exe.
export function listSampleSets(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .flatMap(d => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, d.name, 'manifest.json'), 'utf8'));
        return [{ ...manifest, id: d.name }];
      } catch {
        return []; // no or unreadable manifest: not a sample set
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Resolves a request path inside `dir`, refusing anything that escapes it.
export function sampleFile(dir, relative) {
  const file = path.join(dir, relative);
  return file.startsWith(dir + path.sep) ? file : null;
}
