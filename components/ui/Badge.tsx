import type { ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'green' | 'yellow' | 'red' | 'gray' | 'violet' | 'orange' | 'blue';

const toneClasses: Record<Tone, string> = {
  default: 'bg-base-600/60 text-ink-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/30',
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  yellow: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  red: 'bg-red-500/10 text-red-400 border-red-500/25',
  gray: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/25',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  orange: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  blue: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
};

export function Badge({ tone = 'default', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
