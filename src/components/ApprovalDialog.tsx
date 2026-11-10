import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldAlert, Terminal } from 'lucide-react';
import { useStore } from '@/lib/store';
import { Button, cn } from './ui';

export function ApprovalDialog() {
  const approvals = useStore((s) => s.approvals);
  const approve = useStore((s) => s.approve);
  const request = approvals[0];

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed bottom-6 left-1/2 z-[58] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2"
        >
          <div className="overflow-hidden rounded-xl border border-accent/35 bg-ink-900/97 shadow-panel backdrop-blur-xl">
            <div className="flex items-start gap-2.5 border-b border-line-soft bg-accent/[0.05] px-3.5 py-2.5">
              <ShieldAlert size={15} className="mt-[1px] shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-fg">Approval required</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{request.reason}</p>
              </div>
              {approvals.length > 1 && <span className="font-mono text-[10px] text-faint">+{approvals.length - 1}</span>}
            </div>

            <div className="px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                <Terminal size={10} className="text-faint" />
                <span className="mono text-[10.5px] text-fg-2">{request.name}</span>
                <span className="ml-auto font-mono text-[9.5px] uppercase tracking-wider text-faint">tool call</span>
              </div>
              <pre
                className={cn(
                  'mono mt-1.5 max-h-[120px] overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-ink-1000/60 px-2 py-1.5 text-[10.5px] leading-relaxed text-muted',
                )}
              >
                {JSON.stringify(request.input, null, 2)}
              </pre>
            </div>

            <div className="flex items-center gap-1.5 border-t border-line-soft bg-ink-950/40 px-3.5 py-2.5">
              <span className="font-mono text-[9.5px] text-faint">the model will see the result or the denial</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => approve(request.id, false)}>
                  Deny
                </Button>
                <Button variant="primary" size="sm" onClick={() => approve(request.id, true)}>
                  Allow once
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
