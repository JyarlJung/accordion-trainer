import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the same build runs from the Electron shell (app://bundle/) and from a
  // web host under any path (e.g. GitHub Pages' /<repo>/).
  base: './',
  server: {
    // electron-builder renames folders inside its output (release/, release-*/); a watcher holding them open makes that fail on Windows.
    watch: { ignored: ['**/release*/**'] },
  },
});
