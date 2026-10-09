import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { listSampleSets, sampleFile } from './electron/sampleIndex.js';

// Serves the project's samples/ folder at /user-samples/ in dev, the same way the Electron shell
// serves the folder next to the exe, so sample sets are never bundled into the build.
function userSamples(dir: string): Plugin {
  const types: Record<string, string> = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac' };
  return {
    name: 'user-samples',
    configureServer(server) {
      server.middlewares.use('/user-samples', (req, res) => {
        const relative = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\//, '');
        if (relative === 'index.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(listSampleSets(dir)));
          return;
        }
        const file = sampleFile(dir, relative);
        if (!file || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [userSamples(path.resolve('samples'))],
  server: {
    // electron-builder renames folders inside its output (release/, release-*/); a watcher holding them open makes that fail on Windows.
    watch: { ignored: ['**/release*/**'] },
  },
});
