'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export function FileEditor({
  serverId,
  file,
  open,
  onClose,
  onSaved,
}: {
  serverId: string;
  file: string; // path absolut file
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDirty(false);
    fetch(`/api/servers/${serverId}/files/contents?file=${encodeURIComponent(file)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Gagal membaca file');
        if (!cancelled) setContent(json.content ?? '');
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Error'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, file, serverId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/files/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, content }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan');
      setDirty(false);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={
      <span className="font-mono text-xs text-ink-muted">{file}</span>
    }>
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : error && !content ? (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-8 text-center text-sm text-red-300">
          {error}
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            className="hyunk-console h-[55vh] w-full resize-none rounded-lg border border-line bg-base-950 p-3 text-ink outline-none focus:border-accent/40"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-faint">
              {dirty ? '● Belum disimpan' : 'Tersimpan'}
              {error && <span className="ml-3 text-red-400">{error}</span>}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Tutup
              </Button>
              <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
                Simpan
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
