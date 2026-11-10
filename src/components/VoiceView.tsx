import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  CircleStop,
  Loader2,
  Mic,
  Settings2,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import type { VoiceCharacter, VoiceEngine, VoiceSettings, VoiceVisual } from '@shared/types';
import type { OrbState } from 'thinking-orbs';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { cleanForSpeech, playBlob, stopSpeaking } from '@/lib/voice';
import { ActivityOrb } from './ActivityOrb';
import { Markdown } from './Markdown';
import { Presence3D, type PresenceState } from './Presence3D';
import { cn } from './ui';

const CHARACTERS: { id: VoiceCharacter; name: string; note: string }[] = [
  { id: 'aura', name: 'Aura', note: 'warm core' },
  { id: 'prism', name: 'Prism', note: 'faceted intellect' },
  { id: 'sentinel', name: 'Sentinel', note: 'watchful machine' },
  { id: 'wisp', name: 'Wisp', note: 'quiet weather' },
];

const PHASE_LABEL: Record<PresenceState, string> = {
  idle: 'tap to speak',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
};

function recognitionCtor(): any {
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Voice mode is a conversation surface, not a dictation field. The transcript
 * is visible while you speak, the reply is spoken with the configured model
 * (or the system voice), and the same agent and thread as the chat does the
 * work. The 3D presence is the only part that is pure theatre — on purpose.
 */
export function VoiceView() {
  const settings = useStore((s) => s.settings);
  const agents = useStore((s) => s.agents);
  const threads = useStore((s) => s.threads);
  const activeId = useStore((s) => s.activeThreadId);
  const focusedAgentId = useStore((s) => s.focusedAgentId);
  const setThreadAgent = useStore((s) => s.setThreadAgent);
  const setFocusedAgent = useStore((s) => s.setFocusedAgent);
  const setView = useStore((s) => s.setView);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const run = useStore((s) => s.run);
  const lastRun = useStore((s) => s.lastRun);
  const saveVoice = useStore((s) => s.saveVoice);
  const toast = useStore((s) => s.toast);

  const thread = threads.find((entry) => entry.id === activeId);
  const activeAgentId = thread?.agentId ?? focusedAgentId ?? agents[0]?.id;
  const agent = agents.find((entry) => entry.id === activeAgentId) ?? agents[0];

  const [phase, setPhase] = useState<PresenceState>('idle');
  const [caption, setCaption] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  const [character, setCharacter] = useState<VoiceCharacter>(settings.voice.character);
  const [visual, setVisual] = useState<VoiceVisual>(settings.voice.visual);

  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const submitRef = useRef<(text: string) => void>(() => {});
  const beginRef = useRef<() => void>(() => {});
  const autoTimerRef = useRef<number | null>(null);
  const spokenAt = useRef(0);
  const awaitingReply = useRef(false);
  const mountedRef = useRef(true);
  const voiceRef = useRef<VoiceSettings>(settings.voice);

  useEffect(() => {
    voiceRef.current = settings.voice;
  }, [settings.voice]);

  useEffect(() => {
    setCharacter(settings.voice.character);
    setVisual(settings.voice.visual);
  }, [settings.voice.character, settings.voice.visual]);

  useEffect(() => {
    mountedRef.current = true;
    void api
      .voice()
      .then((info) => setHasKey(info.hasKey))
      .catch(() => undefined);
    return () => {
      mountedRef.current = false;
      if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current);
      recognitionRef.current?.abort?.();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopSpeaking();
    };
  }, []);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setCaption(text);
      setReply('');
      setError(null);
      setPhase('thinking');
      setListening(false);
      setRecording(false);
      awaitingReply.current = true;
      try {
        await send(text);
      } catch (err) {
        awaitingReply.current = false;
        setPhase('idle');
        setError(err instanceof Error ? err.message : 'The agent could not start.');
      }
    },
    [send],
  );
  submitRef.current = (text) => void submit(text);

  const finishSpeaking = useCallback(() => {
    if (!mountedRef.current) return;
    setPhase('idle');
    const voice = voiceRef.current;
    if (voice.autoListen && voice.stt === 'browser' && recognitionCtor()) {
      autoTimerRef.current = window.setTimeout(() => beginRef.current(), 550);
    }
  }, []);

  const speakReply = useCallback(
    async (text: string) => {
      const clean = cleanForSpeech(text);
      if (!clean) {
        setPhase('idle');
        return;
      }
      setPhase('speaking');
      const voice = voiceRef.current;
      if (voice.tts === 'server') {
        try {
          const blob = await api.speak(clean);
          await playBlob(blob);
          finishSpeaking();
          return;
        } catch (err) {
          if (mountedRef.current) setError(`Voice model unavailable: ${err instanceof Error ? err.message : 'unknown error'}. Falling back to the system voice.`);
        }
      }
      if (!hasSpeechSynthesis()) {
        finishSpeaking();
        return;
      }
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.rate = 1.03;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      });
      finishSpeaking();
    },
    [finishSpeaking],
  );

  const beginListening = useCallback(async () => {
    if (!mountedRef.current || transcribing) return;
    stopSpeaking();
    if (autoTimerRef.current) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    setError(null);
    const voice = voiceRef.current;

    if (voice.stt === 'server') {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setError('This webview cannot record audio. Use the browser recogniser, or open the console on a device with microphone support.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((type) =>
          MediaRecorder.isTypeSupported(type),
        );
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          if (!mountedRef.current) return;
          setRecording(false);
          setListening(false);
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          chunksRef.current = [];
          if (blob.size < 900) {
            setPhase('idle');
            setError('That recording was too short — tap, speak, then tap again.');
            return;
          }
          setTranscribing(true);
          setPhase('thinking');
          void api
            .transcribe(blob)
            .then((text) => {
              if (!mountedRef.current) return;
              if (!text.trim()) {
                setPhase('idle');
                setError('No speech was recognised. Check the STT model, or try again closer to the mic.');
                return;
              }
              submitRef.current(text);
            })
            .catch((err) => {
              if (!mountedRef.current) return;
              setPhase('idle');
              setError(err instanceof Error ? err.message : 'Transcription failed.');
            })
            .finally(() => {
              if (mountedRef.current) setTranscribing(false);
            });
        };
        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);
        setListening(true);
        setPhase('listening');
        setCaption('');
        return;
      } catch (err) {
        setRecording(false);
        setPhase('idle');
        setError(
          err instanceof Error && /permission|denied/i.test(err.message)
            ? 'Microphone permission is blocked. Allow it in the app or browser settings.'
            : `Could not open the microphone: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
        return;
      }
    }

    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError('This webview has no speech recogniser. Switch STT to a local model in voice settings — whisper.cpp exposes an OpenAI-compatible endpoint.');
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      let finalText = '';
      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalText += result[0]?.transcript ?? '';
          else interim += result[0]?.transcript ?? '';
        }
        setCaption(`${finalText} ${interim}`.trim());
      };
      recognition.onerror = (event: any) => {
        setListening(false);
        setRecording(false);
        recognitionRef.current = null;
        if (event?.error === 'aborted') return;
        setPhase('idle');
        setError(
          event?.error === 'not-allowed' || event?.error === 'service-not-allowed'
            ? 'Microphone access is blocked. Allow the mic for Vesper, or switch STT to a local model in Settings → Voice.'
            : `Speech recognition failed (${event?.error ?? 'unknown'}).`,
        );
      };
      recognition.onend = () => {
        setListening(false);
        setRecording(false);
        recognitionRef.current = null;
        const text = finalText.trim();
        if (text) submitRef.current(text);
        else if (mountedRef.current) setPhase('idle');
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      setRecording(true);
      setPhase('listening');
      setCaption('');
      setReply('');
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Could not start the microphone.');
    }
  }, [transcribing]);
  beginRef.current = () => void beginListening();

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) recognition.stop();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const toggleMic = () => {
    if (listening || recording) {
      stopListening();
      return;
    }
    if (phase === 'speaking' || phase === 'thinking') {
      stopSpeaking();
      stop();
      setPhase('idle');
    }
    void beginListening();
  };

  // The live run is cleared as soon as the stream closes, so the store keeps
  // the finished answer separately. Speak exactly once per completed run.
  useEffect(() => {
    if (!lastRun || lastRun.at === spokenAt.current || !awaitingReply.current) return;
    spokenAt.current = lastRun.at;
    awaitingReply.current = false;
    if (!lastRun.text.trim()) {
      setPhase('idle');
      setError(lastRun.error ?? 'The run finished without an answer.');
      return;
    }
    setReply(lastRun.text);
    void speakReply(lastRun.text);
  }, [lastRun, speakReply]);

  useEffect(() => {
    const status = run?.status;
    if (!status) return;
    if (status === 'submitted' || status === 'streaming') {
      if (phase !== 'listening') setPhase('thinking');
    }
    if (status === 'error') {
      awaitingReply.current = false;
      setPhase('idle');
      setError(run?.lanes.find((lane) => lane.error)?.error ?? 'The run failed.');
    }
  }, [run, phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(target.tagName)) return;
      event.preventDefault();
      toggleMic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const updatePresence = async (patch: Partial<VoiceSettings>) => {
    if (patch.character) setCharacter(patch.character);
    if (patch.visual) setVisual(patch.visual);
    try {
      await saveVoice(patch);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save that look');
    }
  };

  const orbState: OrbState =
    phase === 'listening' ? 'listening' : phase === 'thinking' ? 'working' : phase === 'speaking' ? 'composing' : 'breathing';

  return (
    <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden bg-ink-1000">
      <div className="aurora" />
      <div className="grain pointer-events-none fixed inset-0 z-[1]" />

      <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 px-3 sm:px-5">
        <button
          onClick={() => setView('chat')}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-fg"
          aria-label="Back to chat"
        >
          <ArrowLeft size={16} />
        </button>
        <AudioLines size={14} className="text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">voice</span>
        <div className="flex-1" />
        <select
          value={activeAgentId ?? ''}
          onChange={(event) => {
            setFocusedAgent(event.target.value);
            if (activeId) void setThreadAgent(event.target.value);
          }}
          className="max-w-[38vw] truncate rounded-md border border-line bg-ink-950/70 px-2 py-1 text-[11.5px] text-fg-2 focus:border-line-strong focus:outline-none"
          aria-label="Agent"
        >
          {agents.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} · {entry.role}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSheet(true)}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.05] hover:text-fg"
          aria-label="Voice settings"
        >
          <Settings2 size={15} />
        </button>
      </header>

      <div className="relative z-10 min-h-[240px] flex-1">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(52% 46% at 50% 48%, ${agent?.accent ?? '#f0b429'}14, transparent 70%)`,
          }}
        />
        <AnimatePresence mode="wait">
          {visual === 'character' ? (
            <motion.div
              key="character"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="absolute inset-0"
            >
              <Presence3D character={character} state={phase} accent={agent?.accent} />
            </motion.div>
          ) : (
            <motion.div
              key="orb"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center"
            >
              <div className="scale-[2.6] drop-shadow-[0_0_50px_oklch(0.805_0.148_78/0.25)]">
                <ActivityOrb state={orbState} size={64} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full border border-line-soft bg-ink-950/55 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint backdrop-blur">
            {agent?.name ?? 'vesper'} · {agent?.role ?? 'agent'}
          </span>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-6">
          <div className="flex items-center gap-2 rounded-full border border-line-soft bg-ink-950/60 px-3 py-1.5 backdrop-blur">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                phase === 'listening' ? 'bg-accent pulse-dot' : phase === 'thinking' ? 'bg-violet pulse-dot' : phase === 'speaking' ? 'bg-ok pulse-dot' : 'bg-faint/60',
              )}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fg-2">{PHASE_LABEL[phase]}</span>
          </div>
        </div>
      </div>

      <div className="relative z-20 shrink-0 px-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          {(caption || reply || error) && (
            <div className="mb-3 max-h-[24vh] overflow-y-auto rounded-2xl border border-line-soft bg-ink-950/70 p-3.5 backdrop-blur-xl">
              {error && (
                <p className="mb-2 flex items-start gap-2 text-[11.5px] leading-snug text-danger">
                  <X size={13} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
              {caption && (
                <p className={cn('text-[13px] leading-relaxed', reply ? 'text-faint' : 'text-fg')}>
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-wider text-faint">you</span>
                  {caption}
                </p>
              )}
              {reply && (
                <div className="mt-2 border-t border-line-soft pt-2">
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-wider text-accent/80">{agent?.name ?? 'agent'}</span>
                  <Markdown className="text-[12.5px] leading-relaxed">{reply}</Markdown>
                </div>
              )}
            </div>
          )}

          <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
            {CHARACTERS.map((entry) => (
              <button
                key={entry.id}
                onClick={() => void updatePresence({ character: entry.id, visual: 'character' })}
                title={entry.note}
                className={cn(
                  'rounded-full border px-2 py-1 font-mono text-[8.5px] uppercase tracking-wider transition-colors',
                  character === entry.id && visual === 'character'
                    ? 'border-accent/40 bg-accent/[0.08] text-accent'
                    : 'border-line-soft text-faint hover:border-line hover:text-fg-2',
                )}
              >
                {entry.name}
              </button>
            ))}
            <button
              onClick={() => void updatePresence({ visual: visual === 'orb' ? 'character' : 'orb' })}
              className={cn(
                'rounded-full border px-2 py-1 font-mono text-[8.5px] uppercase tracking-wider transition-colors',
                visual === 'orb' ? 'border-accent/40 bg-accent/[0.08] text-accent' : 'border-line-soft text-faint hover:border-line hover:text-fg-2',
              )}
            >
              orb
            </button>
          </div>

          <div className="flex items-center justify-center gap-3 pb-1">
            {phase === 'thinking' && (
              <button
                onClick={() => {
                  stop();
                  setPhase('idle');
                }}
                className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:border-danger/50 hover:text-danger"
                aria-label="Stop the agent"
              >
                <CircleStop size={14} />
              </button>
            )}

            <button
              onClick={toggleMic}
              disabled={transcribing}
              className={cn(
                'group relative grid h-[68px] w-[68px] place-items-center rounded-full border transition-all duration-200',
                listening || recording
                  ? 'border-accent/60 bg-accent/[0.14] text-accent shadow-[0_0_40px_oklch(0.805_0.148_78/0.25)]'
                  : 'border-line-strong bg-ink-900/80 text-fg-2 hover:border-accent/40 hover:text-accent',
                transcribing && 'opacity-60',
              )}
              aria-label={listening ? 'Stop listening' : 'Speak'}
            >
              {(listening || recording) && (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full border border-accent/30" />
                  <span className="absolute -inset-2 rounded-full border border-accent/10" />
                </>
              )}
              {transcribing ? <Loader2 size={22} className="animate-spin" /> : listening || recording ? <Mic size={24} /> : <Volume2 size={23} />}
            </button>

            {phase === 'speaking' && (
              <button
                onClick={() => {
                  stopSpeaking();
                  setPhase('idle');
                }}
                className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:border-line-strong hover:text-fg"
                aria-label="Stop speaking"
              >
                <X size={14} />
              </button>
            )}

            {(run?.status === 'submitted' || run?.status === 'streaming') && phase !== 'thinking' && (
              <button
                onClick={() => {
                  stop();
                  setPhase('idle');
                }}
                className="grid h-9 w-9 place-items-center rounded-full border border-line text-muted hover:border-danger/50 hover:text-danger"
                aria-label="Stop"
              >
                <CircleStop size={14} />
              </button>
            )}
          </div>

          <p className="mx-auto mt-2 max-w-[52ch] text-center text-[10.5px] leading-relaxed text-faint/80">
            {settings.voice.stt === 'browser'
              ? 'Browser speech recognition. Audio is handled by the webview, not by a Vesper server.'
              : `Local speech model · ${settings.voice.baseURL || 'no endpoint set'}`}
            {' · '}
            <button onClick={() => setSheet(true)} className="text-accent/80 hover:text-accent">
              change voice
            </button>
          </p>
        </div>
      </div>

      <AnimatePresence>
        {sheet && (
          <VoiceSettingsSheet
            settings={settings.voice}
            hasKey={hasKey}
            onClose={() => setSheet(false)}
            onSaved={(info) => {
              setHasKey(info.hasKey);
              toast('success', 'Voice settings saved');
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function VoiceSettingsSheet({
  settings,
  hasKey,
  onClose,
  onSaved,
}: {
  settings: VoiceSettings;
  hasKey: boolean;
  onClose: () => void;
  onSaved: (info: { hasKey: boolean }) => void;
}) {
  const saveVoice = useStore((s) => s.saveVoice);
  const toast = useStore((s) => s.toast);
  const [form, setForm] = useState<VoiceSettings>(settings);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const patch = (next: Partial<VoiceSettings>) => setForm((current) => ({ ...current, ...next }));

  const save = async () => {
    setSaving(true);
    try {
      const info = await saveVoice(form, keyTouched ? keyDraft : undefined);
      setKeyDraft('');
      setKeyTouched(false);
      onSaved(info);
      onClose();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save voice settings');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await saveVoice(form, keyTouched ? keyDraft : undefined);
      setKeyTouched(false);
      const result = await api.testVoice();
      setTestResult(`${result.ok ? '✓' : '×'} ${result.message}${result.models?.length ? ` Models: ${result.models.slice(0, 6).join(', ')}` : ''}`);
    } catch (err) {
      setTestResult(`× ${err instanceof Error ? err.message : 'Could not reach the endpoint'}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-ink-950 p-4 shadow-panel sm:rounded-2xl sm:p-5"
      >
        <div className="flex items-center gap-2">
          <AudioLines size={14} className="text-accent" />
          <h2 className="text-[14px] font-medium text-fg">Voice</h2>
          <div className="flex-1" />
          <button onClick={onClose} aria-label="Close" className="text-faint hover:text-fg">
            <X size={15} />
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          Use the webview's own speech, or point the app at any OpenAI-compatible voice stack. Local servers usually need
          no key.
        </p>

        <div className="mt-4 space-y-3">
          <EngineRow
            label="Speech to text"
            hint="Browser uses the webview recogniser; Server records audio and sends it to your endpoint."
            value={form.stt}
            onChange={(stt) => patch({ stt })}
            browserAvailable={!!recognitionCtor()}
          />
          <EngineRow
            label="Speech output"
            hint="Browser uses the system voice; Server plays the model's audio."
            value={form.tts}
            onChange={(tts) => patch({ tts })}
            browserAvailable={hasSpeechSynthesis()}
          />

          <div className="rounded-xl border border-line-soft bg-ink-1000/40 p-3">
            <Field label="OpenAI-compatible endpoint" hint="e.g. http://127.0.0.1:8081/v1 (whisper.cpp, Kokoro, OpenAI, Groq)">
              <input
                value={form.baseURL}
                onChange={(event) => patch({ baseURL: event.target.value })}
                placeholder="http://127.0.0.1:8081/v1"
                spellCheck={false}
                className="w-full rounded-md border border-line bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-fg focus:border-line-strong focus:outline-none"
              />
            </Field>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="STT model">
                <input
                  value={form.sttModel}
                  onChange={(event) => patch({ sttModel: event.target.value })}
                  placeholder="whisper-1"
                  className="w-full rounded-md border border-line bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-fg focus:border-line-strong focus:outline-none"
                />
              </Field>
              <Field label="TTS model / voice">
                <div className="flex gap-1.5">
                  <input
                    value={form.ttsModel}
                    onChange={(event) => patch({ ttsModel: event.target.value })}
                    placeholder="tts-1"
                    className="w-full min-w-0 rounded-md border border-line bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-fg focus:border-line-strong focus:outline-none"
                  />
                  <input
                    value={form.ttsVoice}
                    onChange={(event) => patch({ ttsVoice: event.target.value })}
                    placeholder="alloy"
                    className="w-[72px] shrink-0 rounded-md border border-line bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-fg focus:border-line-strong focus:outline-none"
                  />
                </div>
              </Field>
            </div>
            <Field label={`API key ${hasKey ? '· a key is already sealed' : '· optional for local servers'}`}>
              <input
                type="password"
                value={keyDraft}
                onChange={(event) => {
                  setKeyDraft(event.target.value);
                  setKeyTouched(true);
                }}
                placeholder={hasKey ? '••••••••  (leave blank to keep)' : 'sk-…'}
                autoComplete="off"
                className="w-full rounded-md border border-line bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-faint/60 focus:border-line-strong focus:outline-none"
              />
            </Field>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void test()}
                disabled={testing}
                className="rounded-md border border-line px-2.5 py-1 text-[10.5px] text-fg-2 hover:border-line-strong disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test endpoint'}
              </button>
              <button
                onClick={() => patch({ autoListen: !form.autoListen })}
                className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[10.5px] text-fg-2 hover:border-line-strong"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', form.autoListen ? 'bg-ok' : 'bg-faint/50')} />
                auto-listen {form.autoListen ? 'on' : 'off'}
              </button>
            </div>
            {testResult && <p className="mt-2 break-words font-mono text-[9.5px] leading-relaxed text-muted">{testResult}</p>}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-2.5 py-1.5 text-[11.5px] text-faint hover:text-fg-2">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md border border-accent/35 bg-accent/[0.09] px-3 py-1.5 text-[11.5px] text-accent hover:bg-accent/[0.14] disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EngineRow({
  label,
  hint,
  value,
  onChange,
  browserAvailable,
}: {
  label: string;
  hint: string;
  value: VoiceEngine;
  onChange: (value: VoiceEngine) => void;
  browserAvailable: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-line-soft bg-ink-1000/40 p-3">
      <div className="min-w-0">
        <p className="text-[11.5px] text-fg-2">{label}</p>
        <p className="mt-0.5 text-[10px] leading-snug text-faint">{hint}</p>
      </div>
      <div className="flex shrink-0 rounded-md border border-line p-0.5">
        {(['browser', 'server'] as const).map((engine) => (
          <button
            key={engine}
            onClick={() => onChange(engine)}
            disabled={engine === 'browser' && !browserAvailable && value !== 'browser'}
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
              value === engine ? 'bg-ink-850 text-fg' : 'text-faint hover:text-fg-2',
            )}
          >
            {engine}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mt-2 block first:mt-0">
      <span className="block text-[10px] uppercase tracking-wider text-faint">{label}</span>
      {hint && <span className="mt-0.5 block text-[9.5px] leading-snug text-faint/70">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
