'use client';

import { useAppearance } from '@/hooks/useAppearance';
import { PALETTES } from '@/lib/appearance/config';
import { AppearanceControls } from './AppearanceControls';

/** Preview mini memakai kelas panel asli (sidebar, card, tombol) supaya real-time. */
function LivePreview() {
  const { resolvedTheme, prefs } = useAppearance();
  const palette = PALETTES[resolvedTheme ?? 'dark'];
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Live preview</p>
      <div className="relative flex h-72 overflow-hidden rounded-xl border border-line shadow-card">
        <aside className="glass-sidebar relative flex w-[34%] shrink-0 flex-col gap-2 border-r border-line-soft bg-base-950/80 p-3">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[10px] font-bold text-on-accent">H</span>
            <span className="text-[11px] font-semibold text-ink">HYUNK</span>
          </div>
          <span className="rounded-md bg-accent-soft px-2 py-1.5 text-[11px] font-semibold text-accent">Dashboard</span>
          <span className="rounded-md px-2 py-1.5 text-[11px] text-ink-muted">Servers</span>
          <span className="rounded-md px-2 py-1.5 text-[11px] text-ink-muted">Nodes</span>
        </aside>
        <div className="relative flex min-w-0 flex-1 flex-col gap-2.5 p-3">
          <div className="glass-card rounded-lg border border-line bg-base-850 p-3 shadow-card">
            <p className="text-[11px] text-ink-faint">Server online</p>
            <p className="mt-1 text-xl font-bold text-ink">12</p>
            <p className="mt-0.5 text-[10px] text-ink-muted">Tema: {palette.label}</p>
          </div>
          <div className="glass-card rounded-lg border border-line bg-base-850 p-3 shadow-card">
            <div className="h-1.5 w-4/5 rounded-full bg-base-600">
              <div className="h-full w-3/5 rounded-full bg-accent" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" tabIndex={-1} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-on-accent">
                Start
              </button>
              <button type="button" tabIndex={-1} className="rounded-md border border-line bg-base-600 px-2.5 py-1 text-[11px] text-ink">
                Restart
              </button>
            </div>
          </div>
          <p className="mt-auto text-[10px] text-ink-faint">
            Glass {prefs.glass.enabled ? `aktif · ${Math.round(prefs.glass.opacity * 100)}%` : 'nonaktif'} · Font{' '}
            {prefs.fontSize.toUpperCase()} · {prefs.compact ? 'Compact' : 'Normal'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 rounded-xl border border-line bg-base-850 p-5 shadow-card glass-card md:p-6">
        <AppearanceControls showReset />
      </div>
      <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
        <div className="rounded-xl border border-line bg-base-850 p-5 shadow-card glass-card">
          <LivePreview />
        </div>
      </aside>
    </div>
  );
}
