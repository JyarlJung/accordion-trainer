import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative asset paths, so the same build runs from the Electron shell (app://bundle/) and from a
  // web host under any path (e.g. GitHub Pages' /<repo>/).
  base: './',
  // The version shown in the corner of the toolbar.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    // electron-builder renames folders inside its output (release/, release-*/); a watcher holding them open makes that fail on Windows.
    watch: { ignored: ['**/release*/**'] },
  },
});
