'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { toast } from '@/lib/utils/toast';
import type { PublicNode } from '@/types';

export interface NodesMigrateProps {
  nodes: PublicNode[];
}

type MigrationStep = 'idle' | 'validating' | 'moving-servers' | 'updating-dns' | 'done' | 'error';

export function NodesMigrate({ nodes }: NodesMigrateProps) {
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [step, setStep] = useState<MigrationStep>('idle');
  const [serversMoved, setServersMoved] = useState(0);
  const [dnsRecords, setDnsRecords] = useState<Array<{ recordId: string; name: string; newIp: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sourceNode = nodes.find((n) => n.id === sourceNodeId);
  const targetNode = nodes.find((n) => n.id === targetNodeId);

  const canMigrate = sourceNodeId && targetNodeId && sourceNodeId !== targetNodeId && !loading;

  async function handleMigrate() {
    if (!canMigrate) return;

    setLoading(true);
    setError(null);
    setServersMoved(0);
    setDnsRecords([]);
    setStep('validating');

    try {
      const result = await fetch('/api/admin/nodes/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceNodeId, targetNodeId }),
      });

      const data = (await result.json()) as {
        success: boolean;
        serversMoved: number;
        dnsRecordsUpdated: Array<{ recordId: string; name: string; newIp: string }>;
        error?: string;
      };

      if (!result.ok || !data.success) {
        setError(data.error || 'Migrasi gagal');
        setStep('error');
        toast.error(data.error || 'Migrasi gagal');
        return;
      }

      // Step-by-step UI update
      setStep('moving-servers');
      // Small delay for UX feedback
      await new Promise((r) => setTimeout(r, 300));

      setServersMoved(data.serversMoved);
      setDnsRecords(data.dnsRecordsUpdated);
      setStep('updating-dns');
      await new Promise((r) => setTimeout(r, 300));

      setStep('done');
      toast.success(
        data.serversMoved > 0
          ? `Berhasil memindahkan ${data.serversMoved} server ke node ${targetNode?.name}`
          : 'Node sudah tidak memiliki server yang dipindah',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan tidak terduga';
      setError(message);
      setStep('error');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setSourceNodeId('');
    setTargetNodeId('');
    setStep('idle');
    setServersMoved(0);
    setDnsRecords([]);
    setError(null);
  }

  const steps: Array<{ key: MigrationStep; label: string; done: boolean; active: boolean }> = [
    { key: 'validating', label: 'Validasi Node', done: step === 'done' || step === 'moving-servers' || step === 'updating-dns' || step === 'error', active: step === 'validating' },
    { key: 'moving-servers', label: 'Pindah Server di Database', done: step === 'done' || step === 'updating-dns' || step === 'error', active: step === 'moving-servers' },
    { key: 'updating-dns', label: 'Update DNS Cloudflare', done: step === 'done' || step === 'error', active: step === 'updating-dns' },
    { key: 'done', label: 'Selesai', done: step === 'done', active: step === 'done' },
  ];

  return (
    <div className="space-y-6">
      {/* Form pemilihan node */}
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Konfigurasi Migrasi</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Pilih node sumber dan node tujuan untuk memindahkan server.
        </p>

        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-muted">
                Node Sumber <span className="text-accent">*</span>
              </label>
              <Select
                value={sourceNodeId}
                onChange={(e) => setSourceNodeId(e.target.value)}
                className="w-full"
              >
                <option value="">— Pilih node sumber —</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} ({node.fqdn})
                  </option>
                ))}
              </Select>
              {sourceNode && (
                <p className="text-[11px] text-ink-faint">
                  Lokasi: {sourceNode.location} · {sourceNode.is_maintenance ? 'Maintenance' : 'Aktif'}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-muted">
                Node Tujuan <span className="text-accent">*</span>
              </label>
              <Select
                value={targetNodeId}
                onChange={(e) => setTargetNodeId(e.target.value)}
                disabled={!sourceNodeId}
                className="w-full"
              >
                <option value="">— Pilih node tujuan —</option>
                {nodes
                  .filter((n) => n.id !== sourceNodeId)
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name} ({node.fqdn})
                    </option>
                  ))}
              </Select>
              {targetNode && (
                <p className="text-[11px] text-ink-faint">
                  Lokasi: {targetNode.location} · {targetNode.is_maintenance ? 'Maintenance' : 'Aktif'}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleMigrate} disabled={!canMigrate} loading={loading} className="flex-1">
              {step === 'idle' ? 'Mulai Migrasi' : 'Memproses...'}
            </Button>
            {step !== 'idle' && step !== 'done' && step !== 'error' && (
              <Button variant="ghost" onClick={() => { reset(); }} className="text-ink-muted">
                Batal
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Progress steps */}
      {step !== 'idle' && (
        <Card className="p-5">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-muted uppercase tracking-wider">
              {step === 'error' ? 'Kegagalan Migrasi' : step === 'done' ? 'Migrasi Selesai' : 'Progres Migrasi'}
            </h3>

            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div
                  key={s.key}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                    s.done
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                      : s.active
                      ? 'bg-accent/10 border border-accent/30 text-accent'
                      : 'bg-base-800/50 border border-base-800 text-ink-muted'
                  }`}
                >
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      s.done
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : s.active
                        ? 'bg-accent text-on-accent'
                        : 'bg-base-700 text-ink-faint'
                    }`}
                  >
                    {s.done ? '✓' : s.active ? '↓' : idx + 1}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  {s.done && (
                    <span className="ml-auto text-[11px] text-emerald-400/80">Selesai</span>
                  )}
                  {s.active && <span className="ml-auto text-[11px] text-accent">Berjalan...</span>}
                </div>
              ))}
            </div>

            {/* Error message */}
            {step === 'error' && error && (
              <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
                <p className="font-medium">Terjadi kesalahan:</p>
                <p className="mt-1 text-ink-muted">{error}</p>
                <p className="mt-2 text-[11px] text-ink-faint">
                  Server yang sudah dipindah mungkin tidak dapat di-rollback otomatis.
                  Silakan periksa database dan DNS manual.
                </p>
              </div>
            )}

            {/* Hasil migrasi */}
            {step === 'done' && (
              <div className="mt-4 space-y-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4">
                <div className="flex items-center gap-2 text-emerald-300">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span className="font-semibold">Migrasi Berhasil</span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-ink-muted">Server yang dipindah</p>
                    <p className="text-lg font-bold text-emerald-300">{serversMoved} server</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">DNS Record Diupdate</p>
                    <p className="text-lg font-bold text-emerald-300">{dnsRecords.length} record</p>
                  </div>
                </div>

                {dnsRecords.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-ink-muted">DNS Records yang Diupdate:</p>
                    <div className="space-y-1 rounded-lg bg-base-900/50 border border-base-800 p-3">
                      {dnsRecords.map((record) => (
                        <div key={record.recordId} className="flex items-center justify-between text-xs">
                          <span className="font-mono text-ink">{record.name}</span>
                          <span className="text-accent">{record.newIp}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={reset} size="sm">
                    Lakukan Migrasi Lain
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Informasi node */}
      {step === 'idle' && nodes.length === 0 && (
        <Card className="p-5 border-dashed border-line bg-base-850/50">
          <p className="text-sm text-ink-muted text-center">
            Belum ada node terdaftar. Tambahkan node terlebih dahulu sebelum melakukan migrasi.
          </p>
        </Card>
      )}
    </div>
  );
}
