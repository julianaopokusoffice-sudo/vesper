import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../kernel/paths.ts';
import { store } from '../kernel/store.ts';
import { open as unseal, seal } from '../kernel/secrets.ts';
import type { VoiceInfo, VoiceSettings } from '../../shared/types.ts';

/**
 * Voice is a protocol, not a vendor. Anything that speaks the OpenAI audio
 * shape works: OpenAI itself, Groq, a whisper.cpp server, faster-whisper,
 * Kokoro-FastAPI, Piper's HTTP wrapper. That keeps the promise of the app —
 * your keys, your models, your machine — true for voice too.
 *
 * The key is sealed in `~/.vesper/voice.json`, separate from settings, and is
 * never returned to a renderer.
 */

const KEY_FILE = join(PATHS.home, 'voice.json');
const MAX_SPEECH_TEXT = 4_000;

function readKeyFile(): { apiKey?: string } {
  try {
    if (!existsSync(KEY_FILE)) return {};
    return JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { apiKey?: string };
  } catch {
    return {};
  }
}

export function voiceKey(): string {
  return unseal(readKeyFile().apiKey ?? '');
}

export function saveVoiceKey(raw: string | undefined): void {
  if (raw === undefined) return;
  const value = raw.trim();
  writeFileSync(KEY_FILE, JSON.stringify({ apiKey: value ? seal(value) : '' }, null, 2), { mode: 0o600 });
}

export function voiceInfo(): VoiceInfo {
  const settings = store().settings().voice;
  return {
    settings,
    hasKey: Boolean(voiceKey()),
    configured: Boolean(settings.baseURL && (settings.stt === 'server' || settings.tts === 'server')),
  };
}

export function saveVoiceSettings(patch: Partial<VoiceSettings>, key?: string): VoiceInfo {
  const current = store().settings().voice;
  const next: VoiceSettings = {
    ...current,
    ...patch,
    baseURL: cleanBase(String(patch.baseURL ?? current.baseURL)),
    sttModel: String(patch.sttModel ?? current.sttModel),
    ttsModel: String(patch.ttsModel ?? current.ttsModel),
    ttsVoice: String(patch.ttsVoice ?? current.ttsVoice),
  };
  store().saveSettings({ voice: next });
  saveVoiceKey(key);
  return voiceInfo();
}

/** Local model servers may answer on loopback with plain http; both are fine. */
function cleanBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Voice endpoint must be a URL, e.g. http://127.0.0.1:8081/v1 (got “${trimmed}”)`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Voice endpoint must use http or https.');
  return url.href.replace(/\/+$/, '');
}

function endpoint(path: string): string {
  const settings = store().settings().voice;
  const base = cleanBase(settings.baseURL);
  if (!base) throw new Error('Set a voice endpoint first (Settings → Voice, or the voice panel).');
  return `${base}${path}`;
}

function authHeaders(): Record<string, string> {
  const key = voiceKey();
  return key ? { authorization: `Bearer ${key}` } : {};
}

export async function transcribeAudio(file: File): Promise<string> {
  const settings = store().settings().voice;
  if (file.size === 0) throw new Error('The recording was empty.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That recording is larger than 25 MB.');
  const body = new FormData();
  body.append('file', file, file.name || 'speech.webm');
  body.append('model', settings.sttModel || 'whisper-1');
  body.append('response_format', 'json');

  const res = await fetch(endpoint('/audio/transcriptions'), {
    method: 'POST',
    headers: authHeaders(),
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${trimError(text)}`);
  try {
    const parsed = JSON.parse(text) as { text?: string };
    if (typeof parsed.text === 'string') return parsed.text.trim();
  } catch {
    /* some servers answer plain text */
  }
  return text.trim();
}

export async function synthesizeSpeech(text: string): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const settings = store().settings().voice;
  const input = text.trim().slice(0, MAX_SPEECH_TEXT);
  if (!input) throw new Error('Nothing to speak.');
  const res = await fetch(endpoint('/audio/speech'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      model: settings.ttsModel || 'tts-1',
      input,
      voice: settings.ttsVoice || 'alloy',
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Speech synthesis failed (${res.status}): ${trimError(await res.text().catch(() => ''))}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get('content-type') ?? 'audio/mpeg',
  };
}

export async function testVoice(): Promise<{ ok: boolean; models?: string[]; message: string }> {
  const settings = store().settings().voice;
  const base = cleanBase(settings.baseURL);
  if (!base) return { ok: false, message: 'No voice endpoint yet. Point it at a local server such as http://127.0.0.1:8081/v1.' };
  try {
    const res = await fetch(`${endpoint('/models')}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, message: `The endpoint at ${base} answered HTTP ${res.status}. Check the model names and key.` };
    const body = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
    const models = (body?.data ?? []).map((entry) => entry.id).filter((id): id is string => Boolean(id));
    return {
      ok: true,
      models,
      message: models.length
        ? `Reachable — ${models.length} model${models.length === 1 ? '' : 's'}.`
        : `Reachable. STT model ${settings.sttModel}, TTS model ${settings.ttsModel}.`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connect/i.test(detail);
    return {
      ok: false,
      message: unreachable
        ? `Nothing answered at ${base}. Start your local voice server (whisper.cpp, Kokoro, Piper) or fix the endpoint.`
        : detail,
    };
  }
}

function trimError(text: string): string {
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 240) || 'no detail';
}
