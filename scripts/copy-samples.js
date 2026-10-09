import fs from 'node:fs';

// After a local build, put the project's sample sets next to the exe so it can be used straight
// away. Only the exe is published; release/samples stays on this machine.
if (fs.existsSync('samples')) {
  fs.cpSync('samples', 'release/samples', { recursive: true });
  console.log('Copied samples/ to release/samples/');
}
