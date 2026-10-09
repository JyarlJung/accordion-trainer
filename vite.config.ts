import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // electron-builder renames folders inside release/; a watcher holding them open makes that fail on Windows.
    watch: { ignored: ['**/release/**'] },
  },
});
