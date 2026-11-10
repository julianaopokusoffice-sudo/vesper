// Executes a `device_action` tool call on the device the user is looking at.
//
// Two sources of capability: the Web APIs every modern browser has, and the
// native interface the Android WebView injects (`window.AndroidDevice`) for the
// few things a page cannot do — reading battery state, capturing a photo, and
// reporting real device details.

export interface DeviceBridgeResult {
  ok: boolean;
  output: string;
}

interface AndroidDevice {
  info(): string;
  clipboardGet(): string;
  clipboardSet(text: string): void;
  share(text: string): void;
  openUrl(url: string): boolean;
  vibrate(ms: number): void;
  battery(): string;
  takePhoto(requestId: string): void;
}

declare global {
  interface Window {
    AndroidDevice?: AndroidDevice;
    __vesperDevice?: { resolve: (requestId: string, json: string) => void };
  }
}

const photoPending = new Map<string, (result: DeviceBridgeResult) => void>();

if (typeof window !== 'undefined') {
  window.__vesperDevice = {
    resolve: (requestId, json) => {
      const settle = photoPending.get(requestId);
      if (!settle) return;
      photoPending.delete(requestId);
      try {
        const parsed = JSON.parse(json) as DeviceBridgeResult;
        settle(parsed);
      } catch {
        settle({ ok: false, output: 'The camera returned an unreadable result.' });
      }
    },
  };
}

export async function runDeviceAction(actionId: string, name: string, input: unknown): Promise<DeviceBridgeResult> {
  try {
    return await execute(name, (input as { value?: string })?.value ?? '');
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

async function execute(name: string, value: string): Promise<DeviceBridgeResult> {
  const native = window.AndroidDevice;

  switch (name) {
    case 'clipboard_get': {
      const text = await navigator.clipboard.readText();
      return { ok: true, output: text || '(clipboard is empty)' };
    }
    case 'clipboard_set': {
      await navigator.clipboard.writeText(value);
      return { ok: true, output: 'Copied to the clipboard.' };
    }
    case 'share': {
      if (native) {
        native.share(value);
        return { ok: true, output: 'Opened the share sheet.' };
      }
      if (navigator.share) {
        await navigator.share({ text: value });
        return { ok: true, output: 'Opened the share sheet.' };
      }
      throw new Error('Sharing is not available in this window.');
    }
    case 'open_url': {
      const url = value.trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('open_url needs an http(s) address.');
      if (native) return { ok: native.openUrl(url), output: 'Handed the link to the system browser.' };
      window.open(url, '_blank', 'noopener');
      return { ok: true, output: 'Opened in a new tab.' };
    }
    case 'vibrate': {
      const ms = Math.min(Math.max(Number(value) || 200, 10), 3000);
      if (native) native.vibrate(ms);
      else if (!navigator.vibrate?.(ms)) throw new Error('Vibration is not available here.');
      return { ok: true, output: `Vibrated for ${ms}ms.` };
    }
    case 'battery': {
      if (native) return { ok: true, output: native.battery() };
      const battery = await (navigator as any).getBattery?.();
      if (!battery) throw new Error('Battery status is not available in this browser.');
      return {
        ok: true,
        output: `${Math.round(battery.level * 100)}%${battery.charging ? ', charging' : ''}`,
      };
    }
    case 'device_info': {
      const info = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screen: `${window.screen.width}x${window.screen.height}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        touch: navigator.maxTouchPoints > 0,
        online: navigator.onLine,
        native: native ? JSON.parse(safeInfo(native)) : null,
      };
      return { ok: true, output: JSON.stringify(info, null, 2) };
    }
    case 'take_photo': {
      if (!native) throw new Error('Photo capture needs the Vesper Android app.');
      return new Promise<DeviceBridgeResult>((resolve) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        photoPending.set(requestId, resolve);
        native.takePhoto(requestId);
        setTimeout(() => {
          if (photoPending.delete(requestId)) {
            resolve({ ok: false, output: 'No photo was taken in time.' });
          }
        }, 120_000);
      });
    }
    default:
      throw new Error(`Unknown device action "${name}".`);
  }
}

function safeInfo(native: AndroidDevice): string {
  try {
    return native.info();
  } catch {
    return '{}';
  }
}
