import { randomUUID } from 'node:crypto';

interface Pending {
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
  info: { name: string; reason: string; detail: string };
}

const pending = new Map<string, Pending>();

/** Ask the user; resolves false on denial, timeout, or abort. */
export function awaitApproval(info: { name: string; reason: string; detail: string }, signal: AbortSignal, emit: (id: string) => void): Promise<boolean> {
  const id = randomUUID();
  return new Promise<boolean>((resolve) => {
    const finish = (approved: boolean) => {
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      signal.removeEventListener('abort', onAbort);
      resolve(approved);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 120_000);
    pending.set(id, { resolve: finish, timer, info });
    signal.addEventListener('abort', onAbort, { once: true });
    emit(id);
  });
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  entry.resolve(approved);
  return true;
}

export function pendingApprovals() {
  return [...pending.entries()].map(([id, entry]) => ({ id, ...entry.info }));
}
