/** Speaking answers, without a mandatory cloud TTS bill or audio file. */
import { api } from './api';
import type { VoiceSettings } from '@shared/types';

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>|`]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 1400);
}

let activeAudio: HTMLAudioElement | null = null;

/** Speak with the configured model when available, the system voice otherwise. */
export async function speakText(text: string, settings?: VoiceSettings): Promise<void> {
  const clean = cleanForSpeech(text);
  if (!clean) return;
  if (settings?.tts === 'server') {
    try {
      const blob = await api.speak(clean);
      await playBlob(blob);
      return;
    } catch {
      /* the endpoint may be down; the system voice still works */
    }
  }
  speak(clean);
}

export function speak(text: string): void {
  if (!canSpeak() || !text.trim()) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.03;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

/** Play a blob and resolve when it ends; rejects if autoplay is blocked. */
export function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (activeAudio === audio) activeAudio = null;
    };
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('The audio could not be played.'));
    };
    void audio
      .play()
      .then(() => undefined)
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
}
