import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] },
});
child.on('exit', async code => {
  await server.close();
  process.exit(code ?? 0);
});
