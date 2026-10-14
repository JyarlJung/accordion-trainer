import { app, BrowserWindow, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const devUrl = process.env.VITE_DEV_SERVER_URL;
const notFound = () => new Response('Not found', { status: 404 });

// Serve the built app from app:// so fetch() works and the page is a secure context (Web MIDI).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const pathname = decodeURIComponent(new URL(req.url).pathname);
    const file = path.join(distDir, pathname);
    if (!file.startsWith(distDir)) return notFound();
    return net.fetch(pathToFileURL(file).toString());
  });
  // Grant Web MIDI without prompting. Chromium reports even plain requestMIDIAccess() as 'midiSysex'.
  const isMidi = permission => permission === 'midi' || permission === 'midiSysex';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(isMidi(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => isMidi(permission));

  // Keep the page running when the window is covered (by the volume mixer, say): throttled, its
  // frame loop stops and playback stalls. It pauses itself when minimised instead.
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#16161b', autoHideMenuBar: true, title: 'Accordion Trainer',
    // Sound may start from the instrument's keys, not only from a click.
    webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  // Links that open a new window (the GitHub link) go to the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(devUrl ?? 'app://bundle/index.html');
  win.on('minimize', () => void win.webContents.executeJavaScript('window.accordionPause?.()').catch(() => {}));

  // Let the page silence any MIDI instrument it drives before the window goes away.
  let closing = false;
  win.on('close', e => {
    if (closing) return;
    closing = true;
    e.preventDefault();
    win.webContents
      .executeJavaScript('window.accordionShutdown?.()')
      .catch(() => {})
      .finally(() => setTimeout(() => win.destroy(), 200));
  });
});

app.on('window-all-closed', () => app.quit());
