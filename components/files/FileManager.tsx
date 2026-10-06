'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WingsFileStat } from '@/lib/wings/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { FileEditor } from './FileEditor';
import { formatBytes } from '@/lib/utils/format';

interface FileManagerProps {
  serverId: string;
  canEdit: boolean;
}

function joinPath(dir: string, name: string): string {
  const base = dir.endsWith('/') ? dir.slice(0, -1) : dir;
  return `${base}/${name}`;
}

function parentPath(dir: string): string {
  if (dir === '/' || dir === '') return '/';
  const parts = dir.split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}`;
}

const ARCHIVE_RE = /\.(tar\.gz|tgz|tar|zip|gz)$/i;

export function FileManager({ serverId, canEdit }: FileManagerProps) {
  const [directory, setDirectory] = useState('/');
  const [files, setFiles] = useState<WingsFileStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editorFile, setEditorFile] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [newItem, setNewItem] = useState<{ type: 'file' | 'dir'; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/servers/${serverId}/files?directory=${encodeURIComponent(dir)}`,
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Gagal membaca direktori');
        setFiles(Array.isArray(json.files) ? json.files : []);
        setSelected(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    load(directory);
  }, [directory, load]);

  const sorted = useMemo(() => {
    return [...files].sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [files]);

  const breadcrumbs = useMemo(() => {
    const parts = directory.split('/').filter(Boolean);
    const crumbs = [{ label: 'home', path: '/' }];
    parts.forEach((p, i) => {
      crumbs.push({ label: p, path: `/${parts.slice(0, i + 1).join('/')}` });
    });
    return crumbs;
  }, [directory]);

  async function apiAction(path: string, body: unknown, method = 'POST') {
    const res = await fetch(`/api/servers/${serverId}/files${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Operasi gagal');
    return json;
  }

  async function runAction(fn: () => Promise<unknown>, okMessage?: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await fn();
      if (okMessage) setNotice(okMessage);
      await load(directory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operasi gagal');
    } finally {
      setBusy(false);
    }
  }

  async function download(name: string) {
    try {
      const res = await fetch(
        `/api/servers/${serverId}/files/download?file=${encodeURIComponent(joinPath(directory, name))}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal membuat URL download');
      window.open(json.url as string, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal download');
    }
  }

  async function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal membuat URL upload');
      const form = new FormData();
      Array.from(fileList).forEach((f) => form.append('files', f));
      const up = await fetch(json.url as string, { method: 'POST', body: form });
      if (!up.ok) throw new Error(`Upload gagal (Wings ${up.status})`);
      setNotice(`${fileList.length} file terupload`);
      await load(directory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload gagal');
    } finally {
      setBusy(false);
      if (uploadInput.current) uploadInput.current.value = '';
    }
  }

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const selectedArr = Array.from(selected);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg border border-line bg-base-850 px-3 py-1.5 text-xs">
          {breadcrumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink-faint">/</span>}
              <button
                onClick={() => setDirectory(c.path)}
                className={`whitespace-nowrap font-mono transition-colors ${
                  i === breadcrumbs.length - 1 ? 'text-accent' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>

        {canEdit && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setNewItem({ type: 'file', value: '' })}>
              + File
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setNewItem({ type: 'dir', value: '' })}>
              + Folder
            </Button>
            <Button size="sm" variant="secondary" onClick={() => uploadInput.current?.click()} loading={busy}>
              ⬆ Upload
            </Button>
            <input
              ref={uploadInput}
              type="file"
              multiple
              hidden
              onChange={(e) => upload(e.target.files)}
            />
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => load(directory)}>
          ↻
        </Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Bar seleksi */}
      {selectedArr.length > 0 && (
        <div className="fade-in-up flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-xs">
          <span className="text-accent">{selectedArr.length} dipilih</span>
          <div className="flex-1" />
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  runAction(
                    () => apiAction('/compress', { root: directory, files: selectedArr }),
                    'File dikompres',
                  )
                }
              >
                Kompres
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(selectedArr)}>
                Hapus
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Batal
          </Button>
        </div>
      )}

      {/* Tabel file */}
      <div className="overflow-hidden rounded-xl border border-line bg-base-850">
        {loading ? (
          <PageLoader label="Membaca direktori…" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="hidden w-8 px-3 py-2.5 md:table-cell" />
                <th className="px-3 py-2.5">Nama</th>
                <th className="hidden w-28 px-3 py-2.5 md:table-cell">Ukuran</th>
                <th className="hidden w-44 px-3 py-2.5 md:table-cell">Diubah</th>
                <th className="w-28 px-2 py-2.5 text-right md:w-40 md:px-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {directory !== '/' && (
                <tr
                  className="cursor-pointer border-b border-line-soft text-ink-muted hover:bg-base-800"
                  onClick={() => setDirectory(parentPath(directory))}
                >
                  <td className="hidden px-3 py-2 md:table-cell" />
                  <td className="px-3 py-2 font-mono text-xs">../</td>
                  <td colSpan={3} className="hidden md:table-cell" />
                  <td className="md:hidden" />
                </tr>
              )}
              {sorted.map((f) => {
                const fullPath = joinPath(directory, f.name);
                const isArchive = ARCHIVE_RE.test(f.name);
                return (
                  <tr
                    key={f.name}
                    className="group border-b border-line-soft/60 last:border-0 hover:bg-base-800/70"
                  >
                    <td className="hidden px-3 py-2 md:table-cell">
                      <input
                        type="checkbox"
                        checked={selected.has(f.name)}
                        onChange={() => toggleSelect(f.name)}
                        className="accent-[#3ecfcf]"
                      />
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2"
                      onClick={() => {
                        if (f.directory) setDirectory(fullPath);
                        else setEditorFile(fullPath);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-base">
                          {f.directory ? '📁' : f.symlink ? '🔗' : '📄'}
                        </span>
                        <span
                          className={`min-w-0 truncate font-mono text-xs ${
                            f.directory ? 'font-semibold text-accent' : 'text-ink group-hover:text-accent'
                          }`}
                        >
                          {f.name}
                        </span>
                        {isArchive && !f.directory && <Badge tone="yellow">arsip</Badge>}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-xs text-ink-muted md:table-cell">
                      {f.directory ? '—' : formatBytes(f.size)}
                    </td>
                    <td className="hidden px-3 py-2 text-xs text-ink-muted md:table-cell">
                      {f.modified ? new Date(f.modified).toLocaleString('id-ID') : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1 text-xs opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                        {!f.directory && (
                          <button
                            onClick={() => download(f.name)}
                            className="rounded px-1.5 py-1 text-ink-muted hover:text-accent"
                            title="Download"
                          >
                            ⬇
                          </button>
                        )}
                        {canEdit && (
                          <>
                            <button
                              onClick={() => setRenaming({ name: f.name, value: f.name })}
                              className="rounded px-1.5 py-1 text-ink-muted hover:text-accent"
                              title="Rename"
                            >
                              ✎
                            </button>
                            {isArchive && !f.directory && (
                              <button
                                onClick={() =>
                                  runAction(
                                    () =>
                                      apiAction('/compress', {
                                        root: directory,
                                        file: f.name,
                                        action: 'decompress',
                                      }),
                                    'Arsip diekstrak',
                                  )
                                }
                                className="rounded px-1.5 py-1 text-ink-muted hover:text-accent"
                                title="Ekstrak"
                              >
                                ⇤
                              </button>
                            )}
                            <button
                              onClick={() => setConfirmDelete([f.name])}
                              className="rounded px-1.5 py-1 text-ink-muted hover:text-red-400"
                              title="Hapus"
                            >
                              🗑
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-ink-faint">
                    Direktori kosong
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Editor */}
      {editorFile && (
        <FileEditor
          serverId={serverId}
          file={editorFile}
          open={!!editorFile}
          onClose={() => setEditorFile(null)}
          onSaved={() => load(directory)}
        />
      )}

      {/* Rename */}
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title={`Rename "${renaming?.name}"`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!renaming) return;
            runAction(
              () =>
                apiAction('/rename', { root: directory, from: renaming.name, to: renaming.value }),
              'File direname',
            );
            setRenaming(null);
          }}
          className="space-y-4"
        >
          <Input
            value={renaming?.value ?? ''}
            onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value } : r))}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setRenaming(null)}>
              Batal
            </Button>
            <Button size="sm" type="submit" disabled={!renaming?.value || renaming.value === renaming.name}>
              Rename
            </Button>
          </div>
        </form>
      </Modal>

      {/* New file/folder */}
      <Modal
        open={!!newItem}
        onClose={() => setNewItem(null)}
        title={newItem?.type === 'file' ? 'File baru' : 'Folder baru'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newItem?.value) return;
            const name = newItem.value;
            setNewItem(null);
            if (newItem.type === 'dir') {
              runAction(() => apiAction('', { path: directory, name }), `Folder "${name}" dibuat`);
            } else {
              runAction(
                () => apiAction('/contents', { file: joinPath(directory, name), content: '' }),
                `File "${name}" dibuat`,
              );
            }
          }}
          className="space-y-4"
        >
          <Input
            value={newItem?.value ?? ''}
            onChange={(e) => setNewItem((n) => (n ? { ...n, value: e.target.value } : n))}
            placeholder={newItem?.type === 'file' ? 'config.yml' : 'plugins'}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setNewItem(null)}>
              Batal
            </Button>
            <Button size="sm" type="submit" disabled={!newItem?.value}>
              Buat
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Hapus file?">
        <p className="text-sm text-ink-muted">
          {confirmDelete?.length === 1
            ? `File "${confirmDelete[0]}" akan dihapus permanen dari node.`
            : `${confirmDelete?.length} item akan dihapus permanen dari node.`}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>
            Batal
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const filesToDelete = confirmDelete ?? [];
              setConfirmDelete(null);
              runAction(
                () => apiAction('/delete', { root: directory, files: filesToDelete }),
                'File dihapus',
              );
            }}
          >
            Hapus permanen
          </Button>
        </div>
      </Modal>
    </div>
  );
}
