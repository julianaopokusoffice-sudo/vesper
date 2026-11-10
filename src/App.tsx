import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Rail } from '@/components/Rail';
import { ThreadsPanel } from '@/components/ThreadsPanel';
import { TopBar } from '@/components/TopBar';
import { ChatView } from '@/components/Chat';
import { Inspector } from '@/components/Inspector';
import { AgentsView } from '@/components/AgentsView';
import { SkillsView } from '@/components/SkillsView';
import { PluginsView } from '@/components/PluginsView';
import { SettingsView } from '@/components/SettingsView';
import { MemoryView } from '@/components/MemoryView';
import { LibraryView } from '@/components/LibraryView';
import { WorkspaceView } from '@/components/WorkspaceView';
import { AutomationsView } from '@/components/AutomationsView';
import { ConnectorsView } from '@/components/ConnectorsView';
import { BrowserView } from '@/components/BrowserView';
import { CrewView } from '@/components/CrewView';
import { VoiceView } from '@/components/VoiceView';
import { ArtifactsView } from '@/components/ArtifactsView';
import { StudioView } from '@/components/StudioView';
import { DevicesView } from '@/components/DevicesView';
import { CommandPalette } from '@/components/CommandPalette';
import { ApprovalDialog } from '@/components/ApprovalDialog';
import { ToastHost } from '@/components/ui';
import { Mark } from '@/components/Mark';

let booted = false;

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const init = useStore((s) => s.init);
  const setPalette = useStore((s) => s.setPalette);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const newThread = useStore((s) => s.newThread);
  const wallpaper = useStore((s) => s.settings.wallpaper);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (booted) return;
    booted = true;
    init().catch((err) => setError(err instanceof Error ? err.message : 'Could not reach the local runtime'));
  }, [init]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(!paletteOpen);
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void newThread();
      }
      if (event.key === 'Escape' && paletteOpen) setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPalette, newThread]);

  if (error) return <BootError message={error} />;
  if (!ready) return <Boot />;

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-ink-1000" data-wallpaper={wallpaper}>
      <div className="aurora" />
      <div className="grain pointer-events-none fixed inset-0 z-[1]" />

      {view !== 'voice' && <Rail />}
      {view !== 'voice' && <ThreadsPanel />}

      <main
        className={
          view === 'voice'
            ? 'relative z-10 flex min-w-0 flex-1 flex-col'
            : 'relative z-10 flex min-w-0 flex-1 flex-col pb-[calc(58px+env(safe-area-inset-bottom))] md:pb-0'
        }
      >
        {view === 'chat' ? (
          <>
            <TopBar />
            <ChatView />
          </>
        ) : view === 'agents' ? (
          <AgentsView />
        ) : view === 'skills' ? (
          <SkillsView />
        ) : view === 'plugins' ? (
          <PluginsView />
        ) : view === 'memory' ? (
          <MemoryView />
        ) : view === 'library' ? (
          <LibraryView />
        ) : view === 'workspace' ? (
          <WorkspaceView />
        ) : view === 'automations' ? (
          <AutomationsView />
        ) : view === 'connectors' ? (
          <ConnectorsView />
        ) : view === 'studio' ? (
          <StudioView />
        ) : view === 'artifacts' ? (
          <ArtifactsView />
        ) : view === 'browser' ? (
          <BrowserView />
        ) : view === 'crew' ? (
          <CrewView />
        ) : view === 'voice' ? (
          <VoiceView />
        ) : view === 'link' ? (
          <DevicesView />
        ) : (
          <SettingsView />
        )}
      </main>

      <Inspector />

      <CommandPalette />
      <ApprovalDialog />
      <ToastHost />
    </div>
  );
}

function Boot() {
  return (
    <div className="relative grid h-full w-full place-items-center bg-ink-1000">
      <div className="aurora" />
      <div className="flex flex-col items-center gap-4">
        <Mark size={40} className="animate-pulse drop-shadow-[0_0_28px_oklch(0.805_0.148_78/0.4)]" />
        <div className="text-center">
          <p className="font-serif text-[22px] leading-none text-fg">vesper</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">starting local runtime</p>
        </div>
        <div className="h-[2px] w-40 overflow-hidden rounded-full bg-ink-850">
          <div className="shimmer h-full w-full bg-ink-800" />
        </div>
      </div>
    </div>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div className="grid h-full w-full place-items-center bg-ink-1000 px-6">
      <div className="max-w-md rounded-xl border border-danger/30 bg-danger/[0.06] p-5 text-center">
        <p className="font-serif text-[20px] text-fg">The runtime did not answer</p>
        <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-danger/90">{message}</p>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
          Start it with <span className="mono text-fg-2">npm run dev:server</span> (or <span className="mono text-fg-2">npm run dev</span>{' '}
          for both), then reload.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg border border-line bg-ink-900 px-3 py-1.5 text-[12px] text-fg-2 hover:text-fg"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
