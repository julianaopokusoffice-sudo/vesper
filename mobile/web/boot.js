// Boot screen for the Android shell. Everything native goes through the
// VesperNative Capacitor plugin; in a plain browser this page degrades to a note.

const $ = (id) => document.getElementById(id);

const els = {
  build: $('build'),
  runtimeSub: $('runtime-sub'),
  runtimePill: $('runtime-pill'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  progress: $('progress'),
  install: $('install'),
  start: $('start'),
  stop: $('stop'),
  consoleCard: $('console-card'),
  consoleSub: $('console-sub'),
  consolePill: $('console-pill'),
  consoleUrl: $('console-url'),
  open: $('open'),
  peer: $('peer'),
  openPeer: $('open-peer'),
  logsToggle: $('logs-toggle'),
  log: $('log'),
};

const native = globalThis.Capacitor?.Plugins?.VesperNative ?? null;
let state = { phase: 'checking', installed: false, running: false, nodeUrl: 'http://127.0.0.1:8787' };
let autoOpen = false;
let logTimer = null;

const PILL_LABEL = {
  checking: 'checking',
  idle: 'no runtime',
  installing: 'installing',
  ready: 'ready',
  starting: 'starting',
  running: 'running',
  stopped: 'stopped',
  error: 'error',
};

function setBusy(busy) {
  els.meter.dataset.busy = busy ? 'true' : 'false';
}

function render(next) {
  const wasStarting = state.phase === 'starting';
  state = { ...state, ...next };

  els.runtimePill.textContent = PILL_LABEL[state.phase] ?? state.phase;
  els.runtimePill.dataset.state = state.phase;

  const busy = state.phase === 'installing' || state.phase === 'starting' || state.phase === 'checking';
  setBusy(busy);
  if (!busy) {
    const pct = Number(state.progress) || 0;
    els.meterFill.style.width = `${state.phase === 'ready' || state.phase === 'running' ? 100 : pct}%`;
  }

  els.progress.textContent = state.detail || 'Ready.';

  els.install.disabled = busy;
  els.install.textContent = state.installed ? 'Reinstall runtime' : 'Prepare Linux';
  els.start.disabled = busy || !state.installed || state.phase === 'running';
  els.stop.hidden = state.phase !== 'running';
  els.stop.disabled = false;

  const url = state.nodeUrl || 'http://127.0.0.1:8787';
  els.consoleCard.hidden = !state.installed && state.phase !== 'running';
  els.consolePill.dataset.state = state.phase === 'running' ? 'online' : 'idle';
  els.consolePill.textContent = state.phase === 'running' ? 'live' : 'offline';
  els.consoleUrl.textContent = url;
  els.open.disabled = state.phase !== 'running';
  els.consoleSub.textContent =
    state.phase === 'running'
      ? 'Served by this phone. Threads, tools, memory, and pairing all live here.'
      : 'Start the runtime to open the console.';

  if (wasStarting && state.phase === 'running' && autoOpen) {
    autoOpen = false;
    openConsole(url);
  }
  if (state.phase === 'error') autoOpen = false;
}

function statusFromNative(s) {
  return {
    phase: s.phase || 'idle',
    detail: s.detail || '',
    progress: Number(s.progress) || 0,
    installed: !!s.installed,
    nodeUrl: s.nodeUrl || 'http://127.0.0.1:8787',
  };
}

async function refresh() {
  if (!native) return;
  try {
    render(statusFromNative(await native.status()));
    if (els.log.hidden === false) await loadLogs();
  } catch (err) {
    render({ phase: 'error', detail: String(err?.message ?? err) });
  }
}

async function loadLogs() {
  if (!native) return;
  try {
    const { lines = [] } = await native.logs({ lines: 200 });
    els.log.textContent = lines.join('\n') || 'No output yet.';
    els.log.scrollTop = els.log.scrollHeight;
  } catch (err) {
    els.log.textContent = String(err?.message ?? err);
  }
}

function openConsole(url) {
  if (!native) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  native.openConsole({ url });
}

function peerUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.port) parsed.port = '8787';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function wire() {
  els.install.addEventListener('click', async () => {
    if (!native) return;
    render({ phase: 'installing', detail: 'Starting the installer…', progress: 0 });
    try {
      await native.install();
    } catch (err) {
      render({ phase: 'error', detail: String(err?.message ?? err) });
    }
  });

  els.start.addEventListener('click', async () => {
    if (!native) return;
    autoOpen = true;
    render({ phase: 'starting', detail: 'Booting the node…' });
    try {
      await native.start();
    } catch (err) {
      autoOpen = false;
      render({ phase: 'error', detail: String(err?.message ?? err) });
    }
  });

  els.stop.addEventListener('click', async () => {
    if (!native) return;
    try {
      await native.stop();
    } catch (err) {
      render({ phase: 'error', detail: String(err?.message ?? err) });
    }
  });

  els.open.addEventListener('click', () => openConsole(state.nodeUrl));

  els.openPeer.addEventListener('click', () => {
    const url = peerUrl(els.peer.value);
    if (!url) {
      render({ ...state, detail: 'Enter an address like 192.168.1.20:8787' });
      els.peer.focus();
      return;
    }
    try {
      localStorage.setItem('vesper.lastPeer', url);
    } catch {
      /* storage may be disabled */
    }
    openConsole(url);
  });

  els.peer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      els.openPeer.click();
    }
  });

  els.logsToggle.addEventListener('click', async () => {
    const open = els.log.hidden;
    els.log.hidden = !open;
    els.logsToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      await loadLogs();
      logTimer = setInterval(loadLogs, 2000);
    } else if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
  });
}

async function main() {
  wire();
  els.meterFill.style.width = '0%';
  try {
    const saved = localStorage.getItem('vesper.lastPeer');
    if (saved) els.peer.value = saved;
  } catch {
    /* storage may be disabled */
  }

  if (!native) {
    els.build.textContent = 'browser preview';
    render({
      phase: 'idle',
      installed: false,
      detail: 'This boot screen runs inside the Android app. On a computer, start Vesper with `npm run dev`.',
    });
    els.install.disabled = true;
    els.start.disabled = true;
    return;
  }

  try {
    const info = await native.deviceInfo();
    els.build.textContent = `${info.arch || 'arm64'} · android ${info.sdk || '?'}`;
  } catch {
    /* cosmetic only */
  }

  native.addListener('runtime', (s) => render(statusFromNative(s)));
  await refresh();
  setInterval(refresh, 4000);
  window.addEventListener('resize', refresh);
}

main();
