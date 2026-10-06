'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';

/** Port SFTP default Wings — sama dengan yang dikembalikan /api/remote/credentials. */
const SFTP_PORT = 2022;

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
        // Fallback untuk context tanpa Clipboard API (mis. HTTP non-secure).
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
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M15 5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="mt-0.5 truncate font-mono text-sm text-ink">{value}</p>
      </div>
      <CopyButton value={value} label={label} />
    </div>
  );
}

export function SftpDetails({
  serverUuid,
  nodeFqdn,
  username,
  hasFileAccess,
}: {
  serverUuid: string;
  nodeFqdn: string;
  username: string;
  hasFileAccess: boolean;
}) {
  const sftpUsername = `${username}.${serverUuid.slice(0, 8)}`;

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Akses SFTP"
        subtitle="Gunakan FileZilla, WinSCP, atau klien SFTP apapun"
      />

      {!hasFileAccess ? (
        <div className="px-5 py-6 text-sm text-ink-muted">
          Kamu tidak memiliki akses file untuk server ini
        </div>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <div className="overflow-hidden rounded-lg border border-line bg-base-800">
            <InfoRow label="Host" value={nodeFqdn} />
            <InfoRow label="Port" value={String(SFTP_PORT)} />
            <InfoRow label="Username" value={sftpUsername} />
            <InfoRow label="Password" value="password login panel kamu" />
          </div>

          <div className="rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-xs text-accent">
            Koneksi SFTP langsung ke Wings — tidak melalui server panel. Kecepatan upload/download
            bergantung pada koneksi node.
          </div>

          <div>
            <p className="text-xs font-semibold text-ink">Cara connect di FileZilla</p>
            <ol className="mt-2 space-y-1.5 text-xs text-ink-muted">
              <li>
                <span className="mr-1.5 font-semibold text-accent">1.</span>
                Buka FileZilla → File → Site Manager → New Site
              </li>
              <li>
                <span className="mr-1.5 font-semibold text-accent">2.</span>
                Protocol: SFTP, Host &amp; Port seperti di atas, Logon Type: Normal
              </li>
              <li>
                <span className="mr-1.5 font-semibold text-accent">3.</span>
                Masukkan Username &amp; Password lalu klik Connect
              </li>
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}
