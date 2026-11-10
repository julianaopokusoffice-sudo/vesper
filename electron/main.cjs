'use strict';

/**
 * Vesper desktop.
 *
 * The packaged app is a thin shell around the same local runtime the CLI and
 * the phone use: it starts the bundled server, loads the console from loopback,
 * and gives the in-app browser a real Chromium view. The installer also ships
 * the CLI; the shell writes a `vesper` shim and puts it on the user's PATH.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isDev = !app.isPackaged || process.env.VESPER_DEV === '1';
const devUrl = process.env.VESPER_DEV_URL || 'http://localhost:3000';
const APP_NAME = 'Vesper';
const CLI_INSTALL_FLAG = '--install-cli';
const CLI_UNINSTALL_FLAG = '--uninstall-cli';
const SMOKE_FLAG = '--smoke';

app.setName(APP_NAME);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') app.setAppUserModelId('dev.vesper.console');

if (process.argv.includes('--install-cli') || process.argv.includes('--uninstall-cli')) {
  app.whenReady().then(async () => {
    const uninstall = process.argv.includes('--uninstall-cli');
    const result = uninstall ? uninstallCli() : installCli();
    console.log(`${uninstall ? 'uninstall' : 'install'} cli: ${result.ok ? 'ok' : 'failed'} — ${result.detail}`);
    app.exit(result.ok ? 0 : 1);
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  let runtime = null;
  let runtimePort = 8787;
  let quitting = false;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.setIcon?.('');
    installPermissionHandlers();
    const url = await bootRuntime();
    createWindow(url);
    setupUpdater();
    if (isDev) {
      // A source checkout reuses ~/.vesper, exactly like the CLI does.
      try {
        fs.mkdirSync(path.join(os.homedir(), '.vesper', 'logs'), { recursive: true });
      } catch {
        /* read-only home */
      }
    } else {
      const cli = installCli();
      console.log(`cli: ${cli.ok ? cli.detail : `not installed — ${cli.detail}`}`);
    }
    if (process.argv.includes(SMOKE_FLAG)) {
      console.log('[smoke] window ready');
      setTimeout(() => app.exit(0), 2500);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(`http://127.0.0.1:${runtimePort}`);
  });

  app.on('before-quit', () => {
    quitting = true;
    if (runtime && !runtime.killed) {
      try {
        runtime.kill();
      } catch {
        /* already gone */
      }
    }
  });

  ipcMain.handle('desktop:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    packaged: app.isPackaged,
    dataHome: path.join(os.homedir(), '.vesper'),
  }));
  ipcMain.handle('desktop:install-cli', () => installCli());
  ipcMain.handle('desktop:cli-status', () => cliStatus());
  ipcMain.handle('desktop:open-external', async (_event, url) => {
    if (!/^(https?:|mailto:)/i.test(String(url))) throw new Error('Only http(s) and mailto URLs can be opened.');
    await shell.openExternal(String(url));
  });
  ipcMain.handle('desktop:reveal-data', async () => {
    await shell.openPath(path.join(os.homedir(), '.vesper'));
  });

  // --- updates ---------------------------------------------------------------
  // The server can check GitHub on every surface; only the packaged desktop
  // shell can replace its own binary. autoDownload stays off so installing is
  // always the user's click.
  let updaterReady = false;

  function sendUpdate(status) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:status', status);
  }

  function setupUpdater() {
    if (!app.isPackaged || updaterReady) return;
    updaterReady = true;
    let autoUpdater;
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (err) {
      console.error('[updates] updater unavailable:', err.message);
      return;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('download-progress', (progress) =>
      sendUpdate({ state: 'downloading', percent: Math.round(progress.percent || 0) }),
    );
    autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info?.version }));
    autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: err?.message || String(err) }));
    setTimeout(() => {
      autoUpdater
        .checkForUpdates()
        .then((result) => {
          const latest = result?.updateInfo?.version;
          if (latest && latest !== app.getVersion()) sendUpdate({ state: 'available', version: latest });
        })
        .catch((err) => console.error('[updates] check failed:', err.message));
    }, 15_000).unref?.();
  }

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { supported: false, currentVersion: app.getVersion() };
    try {
      const { autoUpdater } = require('electron-updater');
      const result = await autoUpdater.checkForUpdates();
      const latest = result?.updateInfo?.version ?? app.getVersion();
      const notes = result?.updateInfo?.releaseNotes;
      return {
        supported: true,
        currentVersion: app.getVersion(),
        latestVersion: latest,
        available: latest !== app.getVersion(),
        notes: typeof notes === 'string' ? notes : undefined,
      };
    } catch (err) {
      return { supported: false, currentVersion: app.getVersion(), error: err?.message || String(err) };
    }
  });

  ipcMain.handle('updates:download', async () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only installed in a packaged build.' };
    try {
      const { autoUpdater } = require('electron-updater');
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('updates:install', () => {
    if (!app.isPackaged) return { ok: false, error: 'Updates are only installed in a packaged build.' };
    try {
      const { autoUpdater } = require('electron-updater');
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // --- runtime ---------------------------------------------------------------

  async function bootRuntime() {
    if (isDev) {
      runtimePort = Number(process.env.VESPER_PORT || 8787);
      return devUrl;
    }

    const health = await waitForVesper(8787, 900);
    if (health) {
      runtimePort = 8787;
      console.log('[runtime] attached to an existing Vesper on 8787');
      return `http://127.0.0.1:${runtimePort}`;
    }

    runtimePort = (await freePort()) || 8787;
    const entry = path.join(process.resourcesPath, 'server', 'server.mjs');
    if (!fs.existsSync(entry)) {
      dialog.showErrorBox('Vesper could not start', `The bundled runtime is missing at ${entry}. Reinstall the app.`);
      app.exit(1);
      return devUrl;
    }

    const logFile = path.join(os.homedir(), '.vesper', 'logs', 'desktop-server.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile, { flags: 'a' });
    log.write(`\n\n=== ${new Date().toISOString()} starting on ${runtimePort} ===\n`);

    runtime = spawn(process.execPath, [entry], {
      cwd: path.dirname(entry),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        VESPER_DESKTOP: '1',
        VESPER_PORT: String(runtimePort),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    runtime.stdout.on('data', (chunk) => log.write(chunk));
    runtime.stderr.on('data', (chunk) => log.write(chunk));
    runtime.on('error', (err) => log.write(`spawn error: ${err.message}\n`));
    runtime.on('exit', (code) => {
      log.write(`runtime exited (${code})\n`);
      if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
        dialog
          .showMessageBox(mainWindow, {
            type: 'error',
            title: 'Vesper runtime stopped',
            message: `The local agent runtime exited (${code}).`,
            detail: `Log: ${logFile}`,
            buttons: ['Open log folder', 'Quit'],
          })
          .then((result) => {
            if (result.response === 0) shell.showItemInFolder(logFile);
            else app.quit();
          });
      }
    });

    const ok = await waitForVesper(runtimePort, 25_000);
    if (!ok) {
      dialog.showErrorBox('Vesper could not start', `The runtime did not answer on 127.0.0.1:${runtimePort}.\n\nLog: ${logFile}`);
      app.exit(1);
    }
    return `http://127.0.0.1:${runtimePort}`;
  }

  // --- window ---------------------------------------------------------------

  function createWindow(url) {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 920,
      minHeight: 620,
      show: false,
      backgroundColor: '#0e0e11',
      title: 'Vesper',
      autoHideMenuBar: process.platform !== 'darwin',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        spellcheck: true,
      },
    });

    mainWindow.once('ready-to-show', () => {
      if (!process.argv.includes(SMOKE_FLAG)) mainWindow.show();
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/i.test(target)) void shell.openExternal(target);
      return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, target) => {
      const allowed = isDev ? target.startsWith(devUrl) : target.startsWith(`http://127.0.0.1:${runtimePort}`);
      if (!allowed) {
        event.preventDefault();
        if (/^https?:/i.test(target)) void shell.openExternal(target);
      }
    });

    // The browser panel's guest pages get no preload, no Node and no free pass.
    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      const source = String(params.src || '');
      if (source && !/^https?:\/\//i.test(source)) event.preventDefault();
    });

    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error(`[window] load failed (${code}): ${description}`);
      if (process.argv.includes(SMOKE_FLAG)) app.exit(1);
    });

    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[window] console loaded');
    });

    mainWindow.loadURL(url);
    setMenu();
  }

  function setMenu() {
    const template = [
      ...(process.platform === 'darwin'
        ? [
            {
              label: APP_NAME,
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { label: 'Install command line tool', click: () => reportCli(installCli()) },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'Open console in browser',
            click: () => void shell.openExternal(`http://127.0.0.1:${runtimePort}`),
          },
          { label: 'Install command line tool', visible: process.platform !== 'darwin', click: () => reportCli(installCli()) },
          { label: 'Reveal data folder', click: () => void shell.openPath(path.join(os.homedir(), '.vesper')) },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          ...(isDev ? [{ role: 'toggleDevTools' }] : []),
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ role: 'front' }] : [{ role: 'close' }])],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function reportCli(result) {
    const options = {
      type: result.ok ? 'info' : 'error',
      title: 'Vesper command line',
      message: result.ok ? '`vesper` is ready' : 'Could not install the command',
      detail: result.detail,
      buttons: ['OK'],
    };
    if (mainWindow) void dialog.showMessageBox(mainWindow, options);
    else dialog.showMessageBox(options);
  }
}

// --- permissions --------------------------------------------------------------

function isAppOrigin(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(String(url)) || String(url).startsWith('file://');
}

function installPermissionHandlers() {
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isAppOrigin(details.requestingUrl) && !isAppOrigin(webContents.getURL())) return callback(false);
    if (permission === 'media') {
      const types = details.mediaTypes || [];
      return callback(types.includes('audio') && !types.includes('video'));
    }
    return callback(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'notifications'].includes(permission));
  });
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!isAppOrigin(requestingOrigin) && !isAppOrigin(webContents.getURL())) return false;
    return ['clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen', 'notifications'].includes(permission);
  });

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, target) => {
      if (!/^https?:/i.test(target)) event.preventDefault();
    });
  });
}

// --- runtime helpers ----------------------------------------------------------

function waitForVesper(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (body?.ok) return resolve(true);
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 350);
    };
    void tick();
  });
}

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(0));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

// --- command line -------------------------------------------------------------

function cliPaths() {
  const cli = app.isPackaged
    ? path.join(process.resourcesPath, 'cli', 'vesper.mjs')
    : path.join(__dirname, '..', 'cli', 'vesper.mjs');
  const binDir =
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Vesper', 'bin')
      : path.join(os.homedir(), '.local', 'bin');
  return { cli, binDir };
}

function shimPath(binDir, name) {
  return path.join(binDir, process.platform === 'win32' ? name : 'vesper');
}

function installCli() {
  try {
    const { cli, binDir } = cliPaths();
    if (!fs.existsSync(cli)) return { ok: false, detail: `The CLI entrypoint is missing: ${cli}`, path: undefined, onPath: false };
    fs.mkdirSync(binDir, { recursive: true });
    const exe = app.getPath('exe');

    if (process.platform === 'win32') {
      const cmd = shimPath(binDir, 'vesper.cmd');
      fs.writeFileSync(
        cmd,
        `@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${exe}" "${cli}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
        { mode: 0o755 },
      );
      // Git Bash reads a POSIX shim; cmd/PowerShell use the .cmd.
      fs.writeFileSync(
        shimPath(binDir, 'vesper'),
        `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe.replace(/\\/g, '/')}" "${cli.replace(/\\/g, '/')}" "$@"\n`,
        { mode: 0o755 },
      );
      const pathResult = updateWindowsPath('add', binDir);
      return {
        ok: pathResult.ok,
        detail: pathResult.ok
          ? `Installed ${cmd}. Open a new terminal, then run \`vesper --help\`.`
          : `Installed ${cmd}, but could not add ${binDir} to PATH: ${pathResult.detail}`,
        path: cmd,
        onPath: pathResult.ok,
      };
    }

    const shim = shimPath(binDir, 'vesper');
    const appImage = process.env.APPIMAGE;
    fs.writeFileSync(
      shim,
      `#!/bin/sh\n# Generated by Vesper. The app binary may move when an AppImage is replaced.\nAPP="${appImage || exe}"\nELECTRON_RUN_AS_NODE=1 exec "$APP" "${cli}" "$@"\n`,
      { mode: 0o755 },
    );
    fs.chmodSync(shim, 0o755);
    const onPath = (process.env.PATH || '').split(path.delimiter).includes(binDir);
    if (!onPath) ensurePosixPath(binDir);
    return {
      ok: true,
      detail: onPath
        ? `Installed ${shim}. Run \`vesper --help\` in a new terminal.`
        : `Installed ${shim}. Added ${binDir} to your shell profile; open a new terminal and run \`vesper --help\`.`,
      path: shim,
      onPath: true,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err), path: undefined, onPath: false };
  }
}

function uninstallCli() {
  try {
    const { binDir } = cliPaths();
    for (const file of ['vesper.cmd', 'vesper.ps1', 'vesper']) {
      const target = process.platform === 'win32' ? path.join(binDir, file) : path.join(binDir, 'vesper');
      try {
        fs.rmSync(target, { force: true });
      } catch {
        /* already gone */
      }
      if (process.platform !== 'win32') break;
    }
    if (process.platform === 'win32') updateWindowsPath('remove', binDir);
    else removePosixPath(binDir);
    return { ok: true, detail: `Removed the vesper command from ${binDir}.` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function cliStatus() {
  try {
    const { binDir } = cliPaths();
    const installed = fs.existsSync(process.platform === 'win32' ? path.join(binDir, 'vesper.cmd') : path.join(binDir, 'vesper'));
    const onPath =
      process.platform === 'win32'
        ? registryPathContains(binDir)
        : (process.env.PATH || '').split(path.delimiter).includes(binDir);
    return { installed, onPath, path: path.join(binDir, process.platform === 'win32' ? 'vesper.cmd' : 'vesper') };
  } catch {
    return { installed: false, onPath: false };
  }
}

function registryPathContains(binDir) {
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    });
    return String(result.stdout || '')
      .split(';')
      .map((entry) => entry.trim().replace(/\\+$/, '').toLowerCase())
      .includes(binDir.replace(/\\+$/, '').toLowerCase());
  } catch {
    return false;
  }
}

function updateWindowsPath(action, dir) {
  const script = path.join(os.tmpdir(), `vesper-path-${process.pid}.ps1`);
  const body = `
param([string]$Action, [string]$Dir)
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if (-not $key) { Write-Output 'no HKCU Environment key'; exit 1 }
$current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
try { $kind = $key.GetValueKind('Path') } catch { }
$parts = @($current -split ';' | Where-Object { $_ -ne '' })
$clean = $Dir.TrimEnd('\\')
$has = @($parts | Where-Object { $_.TrimEnd('\\') -ieq $clean }).Count -gt 0
if ($Action -eq 'add') {
  if (-not $has) { $parts += $clean }
} else {
  $parts = @($parts | Where-Object { $_.TrimEnd('\\') -ine $clean })
}
$next = $parts -join ';'
if ($next -ne $current) { $key.SetValue('Path', $next, $kind) }
$key.Close()
try {
  Add-Type -Namespace VesperWin32 -Name Env -MemberDefinition '[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
  $result = [UIntPtr]::Zero
  [VesperWin32.Env]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result) | Out-Null
} catch { }
Write-Output 'ok'
`;
  try {
    fs.writeFileSync(script, body, 'utf8');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-Dir', dir],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
    );
    return { ok: result.status === 0, detail: (result.stderr || result.stdout || `exit ${result.status}`).trim() };
  } finally {
    try {
      fs.rmSync(script, { force: true });
    } catch {
      /* temp cleanup */
    }
  }
}

function ensurePosixPath(binDir) {
  const marker = '# vesper-cli-path';
  for (const file of [path.join(os.homedir(), '.profile'), path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')]) {
    try {
      if (!fs.existsSync(file)) continue;
      const current = fs.readFileSync(file, 'utf8');
      if (current.includes(marker)) continue;
      fs.appendFileSync(file, `\n${marker}\nexport PATH="${binDir}:$PATH"\n`);
    } catch {
      /* dotfile may be read-only */
    }
  }
}

function removePosixPath(binDir) {
  const marker = '# vesper-cli-path';
  for (const file of [path.join(os.homedir(), '.profile'), path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')]) {
    try {
      if (!fs.existsSync(file)) continue;
      const current = fs.readFileSync(file, 'utf8');
      if (!current.includes(marker)) continue;
      const next = current
        .split('\n')
        .filter((line) => !line.includes(marker) && line.trim() !== `export PATH="${binDir}:$PATH"`)
        .join('\n');
      fs.writeFileSync(file, next);
    } catch {
      /* best effort */
    }
  }
}
