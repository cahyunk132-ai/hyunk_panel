'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useAppearance } from '@/hooks/useAppearance';
import {
  ACCENT_PRESETS,
  FONT_SIZE_OPTIONS,
  GLASS_MAX_OPACITY,
  GLASS_MIN_OPACITY,
  PALETTES,
  THEME_CHOICES,
  WALLPAPERS,
  type BackgroundMode,
  type FontSize,
  type Palette,
  type ThemeId,
} from '@/lib/appearance/config';
import { imageFileToDataUrl } from '@/lib/appearance/image';

// ─── Primitif kecil ─────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-line-soft bg-base-900/60 px-3.5 py-3">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-ink">
          {label}
        </p>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-accent' : 'bg-base-600'
        }`}
      >
        <span
          className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  columns = 'grid-cols-3',
}: {
  value: T;
  options: { id: T; label: string; sub?: string }[];
  onChange: (id: T) => void;
  columns?: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              active
                ? 'border-accent/60 bg-accent-soft text-accent'
                : 'border-line text-ink-muted hover:border-accent/30 hover:text-ink'
            }`}
          >
            <span className="block text-sm font-medium">{opt.label}</span>
            {opt.sub && <span className="mt-0.5 block text-[11px] opacity-75">{opt.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Mini preview tema ──────────────────────────────────────────────────────

function MiniPreview({ palette }: { palette: Palette }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: palette.bgPrimary }}
    >
      {/* sidebar */}
      <div
        className="absolute inset-y-0 left-0 flex w-[24%] flex-col gap-1 p-1.5"
        style={{ background: palette.bgSidebar }}
      >
        <span className="h-1 w-full rounded-full" style={{ background: palette.accent }} />
        <span className="h-1 w-3/4 rounded-full opacity-40" style={{ background: palette.textSecondary }} />
        <span className="h-1 w-2/3 rounded-full opacity-40" style={{ background: palette.textSecondary }} />
      </div>
      {/* card */}
      <div
        className="absolute bottom-1.5 right-1.5 top-1.5 flex flex-col gap-1 rounded-md border p-1.5"
        style={{ left: '30%', background: palette.card, borderColor: palette.border }}
      >
        <span className="h-1.5 w-3/5 rounded-full" style={{ background: palette.textPrimary }} />
        <span className="h-1 w-2/5 rounded-full opacity-60" style={{ background: palette.textSecondary }} />
        <span
          className="mt-auto h-2.5 w-1/2 rounded-sm"
          style={{ background: palette.accent }}
        />
      </div>
    </div>
  );
}

function ThemeSwatch({ id }: { id: ThemeId }) {
  if (id === 'system') {
    return (
      <div className="flex h-full w-full">
        <div className="relative h-full w-1/2 overflow-hidden">
          <MiniPreview palette={PALETTES.dark} />
        </div>
        <div className="relative h-full w-1/2 overflow-hidden">
          <MiniPreview palette={PALETTES.light} />
        </div>
      </div>
    );
  }
  return <MiniPreview palette={PALETTES[id]} />;
}

// ─── Komponen utama ─────────────────────────────────────────────────────────

const BACKGROUND_MODES: { id: BackgroundMode; label: string; sub: string }[] = [
  { id: 'solid', label: 'Solid', sub: 'Warna tema' },
  { id: 'gradient', label: 'Gradient', sub: 'Mengalir' },
  { id: 'preset', label: 'Preset', sub: 'Wallpaper' },
  { id: 'custom', label: 'Custom', sub: 'Foto sendiri' },
];

/**
 * Seluruh kontrol appearance. Dipakai di halaman /settings/appearance dan di drawer
 * (tombol palette di topbar). `inDrawer` hanya mengatur kepadatan grid.
 */
export function AppearanceControls({
  inDrawer = false,
  showReset = false,
}: {
  inDrawer?: boolean;
  showReset?: boolean;
}) {
  const { theme, resolvedTheme, setTheme, prefs, setPrefs, customImage, setCustomImage, resetToDefault } =
    useAppearance();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const activePalette = PALETTES[resolvedTheme ?? 'dark'];
  const accentValue = prefs.accent ?? activePalette.accent;
  const glassPercent = Math.round(prefs.glass.opacity * 100);

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const dataUrl = await imageFileToDataUrl(file);
      if (!setCustomImage(dataUrl)) {
        setUploadError('Penyimpanan browser penuh. Hapus gambar lain lalu coba lagi.');
        return;
      }
      setPrefs({ background: { ...prefs.background, mode: 'custom' } });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeCustomImage() {
    setCustomImage(null);
    if (prefs.background.mode === 'custom') {
      setPrefs({ background: { ...prefs.background, mode: 'solid' } });
    }
  }

  function selectWallpaper(id: (typeof WALLPAPERS)[number]['id']) {
    setPrefs({ background: { mode: 'preset', wallpaper: id } });
  }

  return (
    <div className={inDrawer ? 'space-y-6' : 'space-y-8'}>
      {/* 1. Tema warna */}
      <Section
        title="Tema Warna"
        hint="Preview langsung berubah saat dipilih. System mengikuti tema OS."
      >
        <div className={`grid gap-3 ${inDrawer ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3 2xl:grid-cols-5'}`}>
          {THEME_CHOICES.map((choice) => {
            const selected = theme === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setTheme(choice.id)}
                className={`group rounded-xl border bg-base-900/40 p-2 text-left transition-all ${
                  selected
                    ? 'border-accent ring-2 ring-accent/35'
                    : 'border-line hover:-translate-y-0.5 hover:border-accent/40'
                }`}
              >
                <div className="h-16 overflow-hidden rounded-lg border border-line-soft">
                  <ThemeSwatch id={choice.id} />
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span aria-hidden className="text-base leading-none">
                    {choice.emoji}
                  </span>
                  <span className="truncate text-xs font-semibold text-ink">{choice.label}</span>
                </div>
                <p className="mt-0.5 truncate text-[10px] text-ink-faint">{choice.description}</p>
              </button>
            );
          })}
        </div>
      </Section>

      {/* 2. Latar belakang */}
      <Section title="Latar Belakang" hint="Solid mengikuti warna tema aktif.">
        <Segmented<BackgroundMode>
          value={prefs.background.mode}
          options={BACKGROUND_MODES}
          columns="grid-cols-2 sm:grid-cols-4"
          onChange={(mode) => setPrefs({ background: { ...prefs.background, mode } })}
        />

        {prefs.background.mode === 'solid' && (
          <p className="rounded-lg border border-line-soft bg-base-900/50 px-3 py-2.5 text-xs text-ink-muted">
            Warna solid dari tema aktif ({activePalette.label}).
          </p>
        )}

        {prefs.background.mode === 'gradient' && (
          <p className="rounded-lg border border-line-soft bg-base-900/50 px-3 py-2.5 text-xs text-ink-muted">
            Gradient animasi yang mengalir dengan warna tema dan aksen. Otomatis nonaktif bila sistem meminta
            reduced motion.
          </p>
        )}

        {prefs.background.mode === 'preset' && (
          <div className={`grid gap-2.5 ${inDrawer ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {WALLPAPERS.map((wallpaper) => {
              const selected = prefs.background.wallpaper === wallpaper.id;
              return (
                <button
                  key={wallpaper.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectWallpaper(wallpaper.id)}
                  className={`group relative aspect-video overflow-hidden rounded-lg border transition-all ${
                    selected ? 'border-accent ring-2 ring-accent/35' : 'border-line hover:border-accent/40'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={wallpaper.src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-left text-[11px] font-medium text-white">
                    {wallpaper.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {prefs.background.mode === 'custom' && (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            {customImage ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={customImage}
                  alt="Gambar latar custom"
                  className="aspect-video w-full rounded-lg border border-line object-cover sm:w-40"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="rounded-lg border border-line bg-base-600 px-3 py-2 text-xs text-ink hover:border-accent/40 disabled:opacity-50"
                  >
                    {uploading ? 'Memproses…' : 'Ganti gambar'}
                  </button>
                  <button
                    type="button"
                    onClick={removeCustomImage}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 hover:bg-red-500/20"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-4 py-8 text-center transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50"
              >
                <span className="text-sm font-medium text-ink">
                  {uploading ? 'Memproses gambar…' : 'Pilih gambar dari perangkat'}
                </span>
                <span className="text-xs text-ink-faint">
                  JPG/PNG/WebP. Otomatis dikompres agar muat di penyimpanan browser.
                </span>
              </button>
            )}
            {uploadError && (
              <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {uploadError}
              </p>
            )}
            <p className="text-[11px] text-ink-faint">
              Gambar disimpan lokal di browser ini sebagai base64 (tidak diunggah ke server).
            </p>
          </div>
        )}
      </Section>

      {/* 3. Glass */}
      <Section title="Efek Sidebar & Card" hint="Glassmorphism: permukaan transparan dengan blur.">
        <Toggle
          label="Glassmorphism"
          description="Sidebar & card transparan dengan backdrop blur"
          checked={prefs.glass.enabled}
          onChange={(enabled) => setPrefs({ glass: { ...prefs.glass, enabled } })}
        />
        <div
          className={`space-y-2 rounded-lg border border-line-soft bg-base-900/60 px-3.5 py-3 transition-opacity ${
            prefs.glass.enabled ? '' : 'opacity-50'
          }`}
        >
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="glass-opacity" className="font-medium text-ink">
              Opacity glass
            </label>
            <span className="font-mono text-ink-muted">{glassPercent}%</span>
          </div>
          <input
            id="glass-opacity"
            type="range"
            min={Math.round(GLASS_MIN_OPACITY * 100)}
            max={Math.round(GLASS_MAX_OPACITY * 100)}
            step={5}
            value={glassPercent}
            disabled={!prefs.glass.enabled}
            onChange={(e) =>
              setPrefs({ glass: { ...prefs.glass, opacity: Number(e.target.value) / 100 } })
            }
            className="w-full accent-[rgb(var(--accent))] disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[10px] text-ink-faint">
            <span>30% (lebih transparan)</span>
            <span>90% (lebih solid)</span>
          </div>
        </div>
      </Section>

      {/* 4. Accent */}
      <Section title="Warna Aksen" hint="Dipakai untuk tombol, link, dan highlight.">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((preset) => {
            const selected = prefs.accent?.toLowerCase() === preset.hex.toLowerCase();
            return (
              <button
                key={preset.hex}
                type="button"
                title={preset.label}
                aria-label={`Aksen ${preset.label}`}
                aria-pressed={selected}
                onClick={() => setPrefs({ accent: preset.hex })}
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                  selected ? 'border-ink ring-2 ring-accent/50' : 'border-line-soft'
                }`}
                style={{ background: preset.hex }}
              />
            );
          })}
          <button
            type="button"
            onClick={() => setPrefs({ accent: null })}
            aria-pressed={prefs.accent === null}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              prefs.accent === null
                ? 'border-accent/60 bg-accent-soft text-accent'
                : 'border-line text-ink-muted hover:text-ink'
            }`}
          >
            Ikuti tema
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-base-900/60 px-3 py-2 text-xs text-ink-muted hover:text-ink">
            <input
              type="color"
              aria-label="Pilih warna aksen bebas"
              value={accentValue}
              onChange={(e) => setPrefs({ accent: e.target.value })}
              className="h-6 w-8 cursor-pointer appearance-none rounded border-0 bg-transparent p-0"
            />
            Warna bebas
          </label>
          <span className="font-mono text-xs text-ink-faint">{accentValue.toLowerCase()}</span>
        </div>
      </Section>

      {/* 5. Font size */}
      <Section title="Ukuran Font" hint="Diterapkan ke seluruh panel lewat font-size di root.">
        <Segmented<FontSize>
          value={prefs.fontSize}
          options={FONT_SIZE_OPTIONS.map((opt) => ({ id: opt.id, label: opt.label, sub: `${opt.px}px` }))}
          onChange={(fontSize) => setPrefs({ fontSize })}
        />
      </Section>

      {/* 6. Compact */}
      <Section title="Layout">
        <Toggle
          label="Compact mode"
          description="Padding & spacing lebih rapat untuk layar yang lebih banyak informasi"
          checked={prefs.compact}
          onChange={(compact) => setPrefs({ compact })}
        />
      </Section>

      {showReset && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-faint">
            Mengembalikan tema, latar, glass, aksen, font, dan compact ke default (termasuk gambar custom).
          </p>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Reset semua pengaturan appearance ke default?')) resetToDefault();
            }}
            className="shrink-0 rounded-lg border border-line bg-base-600 px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
          >
            Reset to Default
          </button>
        </div>
      )}
    </div>
  );
}
