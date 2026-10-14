'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function NodeStatusRefreshButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/cron/node-status', {
        method: 'POST',
        cache: 'no-store',
      });
      const json = (await response.json().catch(() => ({}))) as {
        checked?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
      setMessage(`${json.checked ?? 0} node diperiksa`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal memeriksa node');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={refresh} disabled={loading}>
        {loading ? 'Memeriksa…' : 'Refresh semua status'}
      </Button>
      {message && <span className="text-[11px] text-ink-muted">{message}</span>}
    </div>
  );
}
