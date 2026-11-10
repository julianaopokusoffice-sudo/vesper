import { AudioLines, ArrowUpRight } from 'lucide-react';
import { useStore } from '@/lib/store';
import { cn } from './ui';

export function VoiceCard() {
  const voice = useStore((s) => s.settings.voice);
  const setView = useStore((s) => s.setView);

  return (
    <div className="rounded-xl border border-line-soft bg-ink-950/25 p-3">
      <div className="flex items-center gap-2">
        <AudioLines size={12} className="text-accent" />
        <p className="text-[12px] text-fg-2">Voice mode</p>
        <div className="flex-1" />
        <button onClick={() => setView('voice')} className="flex items-center gap-1 text-[10.5px] text-accent/85 hover:text-accent">
          open <ArrowUpRight size={11} />
        </button>
      </div>
      <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
        Push-to-talk, spoken replies, and a presence you can see. Use the webview's speech, or point it at a local
        OpenAI-compatible voice model.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-wider">
        <span className={cn('rounded border px-1.5 py-0.5', voice.stt === 'server' ? 'border-accent/30 text-accent' : 'border-line text-faint')}>
          stt {voice.stt}
        </span>
        <span className={cn('rounded border px-1.5 py-0.5', voice.tts === 'server' ? 'border-accent/30 text-accent' : 'border-line text-faint')}>
          tts {voice.tts}
        </span>
        <span className="max-w-[220px] truncate rounded border border-line px-1.5 py-0.5 text-faint">{voice.baseURL || 'no endpoint'}</span>
        <span className="rounded border border-line px-1.5 py-0.5 text-faint">{voice.character}</span>
      </div>
    </div>
  );
}
