import { randomUUID } from 'node:crypto';

/**
 * The bridge between a tool call and the surface the user is actually looking
 * at — the console in a browser, or the console in the Android WebView.
 *
 * A `device_action` tool emits an SSE event; whichever surface is hosting the
 * run executes it with the Web APIs or the native interface it has, then posts
 * the result back. Nothing here reaches the device by itself, and a run with no
 * bridge attached (headless CLI, a remote peer) times out with a clear message
 * instead of silently doing nothing.
 */

export const DEVICE_ACTIONS = [
  'clipboard_get',
  'clipboard_set',
  'share',
  'open_url',
  'vibrate',
  'battery',
  'device_info',
  'take_photo',
] as const;

export type DeviceAction = (typeof DEVICE_ACTIONS)[number];

interface Pending {
  resolve: (result: { ok: boolean; output: string }) => void;
  timer: NodeJS.Timeout;
  info: { name: string; action: DeviceAction; input: unknown };
}

const pending = new Map<string, Pending>();
const DEFAULT_TIMEOUT_MS = 45_000;

export function awaitDeviceAction(
  info: { action: DeviceAction; input: unknown },
  signal: AbortSignal,
  emit: (id: string) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const id = randomUUID();
  return new Promise<string>((resolve) => {
    const finish = (result: { ok: boolean; output: string }) => {
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      signal.removeEventListener('abort', onAbort);
      resolve(result.output);
    };
    const onAbort = () => finish({ ok: false, output: 'The run was stopped before the device acted.' });
    pending.set(id, {
      resolve: finish,
      timer: setTimeout(
        () =>
          finish({
            ok: false,
            output: `No surface answered the "${info.action}" action within ${Math.round(timeoutMs / 1000)}s. Device actions only run in the console (browser or the Android app), not in a headless run.`,
          }),
        timeoutMs,
      ),
      info: { name: info.action, action: info.action, input: info.input },
    });
    signal.addEventListener('abort', onAbort, { once: true });
    emit(id);
  });
}

export function resolveDeviceAction(id: string, result: { ok: boolean; output: string }): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  entry.resolve({ ok: !!result.ok, output: String(result.output ?? '').slice(0, 40_000) });
  return true;
}

export function pendingDeviceActions() {
  return [...pending.entries()].map(([id, entry]) => ({ id, name: entry.info.name, action: entry.info.action, input: entry.info.input }));
}
