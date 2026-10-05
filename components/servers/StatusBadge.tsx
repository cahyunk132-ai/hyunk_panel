import type { ServerStatus } from '@/types';

export const STATUS_META: Record<
  string,
  { label: string; dot: string; text: string; pulse?: boolean }
> = {
  running: { label: 'Running', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  starting: { label: 'Starting', dot: 'bg-amber-400', text: 'text-amber-400', pulse: true },
  stopping: { label: 'Stopping', dot: 'bg-amber-400', text: 'text-amber-400', pulse: true },
  offline: { label: 'Offline', dot: 'bg-zinc-500', text: 'text-zinc-400' },
  installing: { label: 'Installing', dot: 'bg-accent', text: 'text-accent', pulse: true },
  error: { label: 'Error', dot: 'bg-red-500', text: 'text-red-400' },
};

export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  const shouldPulse = pulse ?? meta.pulse;
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {shouldPulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${meta.dot}`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
    </span>
  );
}

export function StatusBadge({ status }: { status: ServerStatus | string }) {
  const meta = STATUS_META[status] ?? { label: status, dot: 'bg-zinc-500', text: 'text-zinc-400' };
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium">
      <StatusDot status={status} />
      <span className={meta.text}>{meta.label}</span>
    </span>
  );
}
