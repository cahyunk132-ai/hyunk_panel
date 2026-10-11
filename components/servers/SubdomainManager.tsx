'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import {
  BASE_DOMAIN,
  buildFullDomain,
  normalizeSubdomain,
  validateSubdomain,
} from '@/lib/subdomains';
import type {
  SubdomainAvailability,
  SubdomainQuota,
  ServerSubdomainRow,
  SubdomainResponse,
} from '@/types';

const QUOTA_FULL_MESSAGE = 'Kuota subdomain penuh. Hapus subdomain lain untuk mendaftarkan yang baru.';

function isQuotaFull(quota: SubdomainQuota | null): boolean {
  return !!quota && !quota.unlimited && quota.limit !== null && quota.used >= quota.limit;
}

/** Info kuota subdomain user: "Subdomain kamu: X / 2" + badge + progress bar. */
function QuotaCard({ quota }: { quota: SubdomainQuota }) {
  const full = isQuotaFull(quota);
  const limit = quota.limit ?? 0;
  const remaining = Math.max(limit - quota.used, 0);
  const percent = quota.unlimited || limit === 0 ? 0 : Math.min((quota.used / limit) * 100, 100);
  const barColor = full ? 'bg-red-500' : quota.used > 0 ? 'bg-amber-400' : 'bg-emerald-500';

  return (
    <Card>
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Kuota subdomain</p>
            <p className="mt-0.5 text-sm text-ink">
              Subdomain kamu:{' '}
              <span className="font-mono font-semibold">
                {quota.used} / {quota.unlimited ? '∞' : limit}
              </span>
            </p>
          </div>
          {quota.unlimited ? (
            <Badge tone="accent">Tanpa batas</Badge>
          ) : full ? (
            <Badge tone="red">Penuh</Badge>
          ) : (
            <Badge tone="green">Sisa {remaining}</Badge>
          )}
        </div>
        {!quota.unlimited && (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-base-700"
            role="progressbar"
            aria-label="Pemakaian kuota subdomain"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={quota.used}
          >
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percent}%` }} />
          </div>
        )}
        <p className="text-[11px] text-ink-faint">
          {quota.unlimited
            ? 'Role kamu tidak dibatasi kuota subdomain.'
            : `Dihitung dari semua server milikmu. Maksimal ${limit} subdomain per user.`}
        </p>
      </div>
    </Card>
  );
}

/** Tombol copy: ikon clipboard → centang selama 2 detik setelah berhasil. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch {
      // Clipboard ditolak browser — jangan sampai memutus render.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Tersalin' : `Salin ${label}`}
      aria-label={`Salin ${label}`}
      className={`shrink-0 rounded-md border p-1.5 transition-colors ${
        copied
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
          : 'border-line bg-base-800 text-ink-muted hover:border-accent/40 hover:text-accent'
      }`}
    >
      {copied ? (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/**
 * Tab Network — Subdomain Manager.
 * Daftarkan subdomain (mis. kenz.wangstore.web.id) yang reverse-proxied Wings
 * ke IP:port server ini.
 */
export function SubdomainManager({
  serverId,
  canManage,
}: {
  serverId: string;
  canManage: boolean;
}) {
  const [subdomain, setSubdomain] = useState<ServerSubdomainRow | null>(null);
  const [defaultPort, setDefaultPort] = useState<number | null>(null);
  const [quota, setQuota] = useState<SubdomainQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Form daftar ──
  const [name, setName] = useState('');
  const [availability, setAvailability] = useState<SubdomainAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Hapus ──
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/subdomain`);
      const data = (await res.json()) as SubdomainResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal memuat subdomain');
      setSubdomain(data.subdomain);
      setDefaultPort(data.default_port);
      setQuota(data.quota ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Gagal memuat subdomain');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  /** Muat ulang kuota saja (setelah daftar/hapus) tanpa spinner halaman. */
  const refreshQuota = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/subdomain`);
      if (!res.ok) return;
      const data = (await res.json()) as SubdomainResponse;
      setQuota(data.quota ?? null);
    } catch {
      // Abaikan — kuota akan tersinkron lagi saat halaman dimuat ulang.
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Validasi realtime: debounce → cek ketersediaan via API.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    if (!trimmed) {
      setAvailability(null);
      setChecking(false);
      return;
    }
    const format = validateSubdomain(trimmed);
    if (!format.ok) {
      setAvailability({ available: false, subdomain: normalizeSubdomain(trimmed), full_domain: null, error: format.error });
      setChecking(false);
      return;
    }
    setChecking(true);
    const seq = ++checkSeq.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/servers/${serverId}/subdomain?check=${encodeURIComponent(normalizeSubdomain(trimmed))}`,
        );
        const data = (await res.json()) as SubdomainAvailability;
        if (seq === checkSeq.current) setAvailability(data);
      } catch {
        if (seq === checkSeq.current) {
          setAvailability({
            available: false,
            subdomain: normalizeSubdomain(trimmed),
            full_domain: null,
            error: 'Gagal mengecek ketersediaan',
          });
        }
      } finally {
        if (seq === checkSeq.current) setChecking(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [name, serverId]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const format = validateSubdomain(trimmed);
    if (!format.ok) {
      setFormError(format.error ?? 'Nama subdomain tidak valid');
      return;
    }
    setRegistering(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/subdomain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: normalizeSubdomain(trimmed) }),
      });
      const data = (await res.json()) as {
        subdomain?: ServerSubdomainRow;
        error?: string;
        message?: string;
        quota?: SubdomainQuota;
      };
      if (!res.ok) {
        // 429 = kuota habis → sinkronkan kuota supaya form diganti pesan "penuh".
        if (res.status === 429 && data.quota) setQuota(data.quota);
        throw new Error(data.error ?? 'Gagal mendaftarkan subdomain');
      }
      setSubdomain(data.subdomain ?? null);
      setName('');
      setAvailability(null);
      void refreshQuota();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal mendaftarkan subdomain');
    } finally {
      setRegistering(false);
    }
  }

  async function remove() {
    if (!subdomain) return;
    if (!window.confirm(`Hapus subdomain "${subdomain.full_domain}"? Domain tidak akan lagi mengarah ke server ini.`)) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/subdomain`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal menghapus subdomain');
      setSubdomain(null);
      setFormError(null);
      void refreshQuota();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus subdomain');
    } finally {
      setDeleting(false);
    }
  }

  const previewName = normalizeSubdomain(name) || 'nama';
  const previewDomain = buildFullDomain(previewName);
  const quotaFull = isQuotaFull(quota);

  return (
    <div className="space-y-4">
      {/* ── Subdomain aktif ── */}
      <Card>
        <CardHeader
          title="Subdomain aktif"
          subtitle="Domain yang mengarah ke server kamu lewat reverse proxy Wings."
        />
        <div className="px-5 py-4">
          {loading ? (
            <PageLoader label="Memuat subdomain…" />
          ) : loadError ? (
            <p className="text-sm text-red-400">{loadError}</p>
          ) : subdomain ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-base font-semibold text-ink">
                  {subdomain.full_domain}
                </span>
                <Badge tone="green">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Aktif
                </Badge>
                <div className="ml-auto flex items-center gap-2">
                  <CopyButton value={subdomain.full_domain} label="alamat subdomain" />
                  {canManage && (
                    <Button variant="danger" size="sm" loading={deleting} onClick={remove}>
                      {deleting ? 'Menghapus…' : 'Hapus'}
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
                <p>
                  Port tujuan:{' '}
                  <span className="font-mono text-ink">{subdomain.port}</span>
                </p>
                <p>
                  Didaftarkan:{' '}
                  <span className="text-ink">
                    {new Date(subdomain.created_at).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </p>
              </div>
              {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              Belum ada subdomain terdaftar untuk server ini.
              {!canManage
                ? ' Pemilik server dapat mendaftarkannya.'
                : quotaFull
                  ? ' Kuota subdomain kamu sudah penuh.'
                  : ' Daftarkan satu lewat form di bawah.'}
            </p>
          )}
        </div>
      </Card>

      {/* ── Info kuota subdomain user ── */}
      {canManage && !loading && !loadError && quota && <QuotaCard quota={quota} />}

      {/* ── Kuota penuh: form disembunyikan ── */}
      {canManage && !loading && !loadError && !subdomain && quotaFull && (
        <Card>
          <CardHeader
            title="Daftar subdomain baru"
            subtitle={`Pilih nama untuk ${BASE_DOMAIN} — hanya huruf kecil, angka, dan strip (3-32 karakter).`}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-start gap-2.5">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p className="text-sm text-red-400">{QUOTA_FULL_MESSAGE}</p>
            </div>
            <Button type="button" disabled title={QUOTA_FULL_MESSAGE}>
              Register
            </Button>
          </div>
        </Card>
      )}

      {/* ── Form daftar subdomain baru ── */}
      {canManage && !loading && !loadError && !subdomain && !quotaFull && (
        <Card>
          <CardHeader
            title="Daftar subdomain baru"
            subtitle={`Pilih nama untuk ${BASE_DOMAIN} — hanya huruf kecil, angka, dan strip (3-32 karakter).`}
          />
          <form onSubmit={register} className="space-y-4 px-5 py-4">
            <div>
              <label htmlFor="subdomain-name" className="mb-1.5 block text-xs font-medium text-ink-muted">
                Nama subdomain
              </label>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-[220px] flex-1">
                  <Input
                    id="subdomain-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="kenz"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={32}
                    disabled={registering}
                  />
                  <div className="mt-1.5 min-h-[16px] text-[11px]">
                    {checking ? (
                      <span className="text-ink-faint">Mengecek ketersediaan…</span>
                    ) : availability && !availability.available ? (
                      <span className="text-red-400">{availability.error}</span>
                    ) : availability?.available ? (
                      <span className="text-emerald-400">Tersedia ✓</span>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="submit"
                  loading={registering}
                  disabled={registering || checking || !name.trim() || (availability !== null && !availability.available)}
                >
                  {registering ? 'Mendaftarkan…' : 'Register'}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-line bg-base-900 px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Preview</p>
              <p className="mt-0.5 font-mono text-sm text-ink">
                {previewName}
                <span className="text-accent">.{BASE_DOMAIN}</span>
              </p>
            </div>

            {formError && <p className="text-xs text-red-400">{formError}</p>}
          </form>
        </Card>
      )}

      {/* ── Info box ── */}
      <div className="flex items-start gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3.5">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <p className="text-xs leading-relaxed text-ink-muted">
          Subdomain akan mengarahkan ke server kamu secara langsung. Pastikan port server sudah terbuka.
          {defaultPort !== null && !subdomain && (
            <span className="text-ink-faint"> Port default server ini: </span>
          )}
          {defaultPort !== null && !subdomain && <span className="font-mono text-ink">{defaultPort}</span>}
          {defaultPort !== null && !subdomain && <span className="text-ink-faint">.</span>}
        </p>
      </div>
    </div>
  );
}
