import { app, BrowserWindow, net, protocol, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const devUrl = process.env.VITE_DEV_SERVER_URL;

// Serve the built app from app:// so fetch() works and the page is a secure context (Web MIDI).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const file = path.join(distDir, decodeURIComponent(new URL(req.url).pathname));
    if (!file.startsWith(distDir)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Grant Web MIDI without prompting. Chromium reports even plain requestMIDIAccess() as 'midiSysex'.
  const isMidi = permission => permission === 'midi' || permission === 'midiSysex';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(isMidi(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => isMidi(permission));

  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#16161b', autoHideMenuBar: true, title: 'Accordion Trainer',
  });
  win.loadURL(devUrl ?? 'app://bundle/index.html');
});

app.on('window-all-closed', () => app.quit());
