'use client';

import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { formatBytes } from '@/lib/utils/format';
import { toast } from '@/lib/utils/toast';

interface VpsFileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  permissions: string;
  modified_at: string;
}

type NewItem = { type: 'file' | 'folder'; name: string };

function joinPath(directory: string, name: string): string {
  const base = directory === '/' ? '' : directory.replace(/\/+$/, '');
  return `${base}/${name}`.replace(/\/+/g, '/');
}

function parentPath(directory: string): string {
  if (directory === '/') return '/';
  const parts = directory.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}

function languageForPath(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return 'dockerfile';
  const extension = name.includes('.') ? name.split('.').pop() : '';
  const languages: Record<string, string> = {
    bash: 'shell',
    conf: 'ini',
    css: 'css',
    htm: 'html',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mjs: 'javascript',
    nginx: 'ini',
    py: 'python',
    sh: 'shell',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'typescript',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    zsh: 'shell',
  };
  return languages[extension ?? ''] ?? 'plaintext';
}

function fileIcon(entry: VpsFileEntry): string {
  if (entry.type === 'directory') return '📁';
  if (entry.type === 'symlink') return '🔗';
  return '📄';
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  }
  return fallback;
}

export function VpsFileManager({ vpsId, canEdit }: { vpsId: string; canEdit: boolean }) {
  const [directory, setDirectory] = useState('/');
  const [entries, setEntries] = useState<VpsFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<NewItem | null>(null);
  const [renaming, setRenaming] = useState<{ entry: VpsFileEntry; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VpsFileEntry | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/vps/${encodeURIComponent(vpsId)}/files?path=${encodeURIComponent(path)}`,
          { cache: 'no-store' },
        );
        const body = (await response.json().catch(() => ({}))) as { files?: VpsFileEntry[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? 'Gagal membaca direktori');
        setEntries(Array.isArray(body.files) ? body.files : []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Gagal membaca direktori');
      } finally {
        setLoading(false);
      }
    },
    [vpsId],
  );

  useEffect(() => {
    void loadDirectory(directory);
  }, [directory, loadDirectory]);

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      }),
    [entries],
  );

  const breadcrumbs = useMemo(() => {
    const parts = directory.split('/').filter(Boolean);
    return [
      { label: '/', path: '/' },
      ...parts.map((part, index) => ({
        label: part,
        path: `/${parts.slice(0, index + 1).join('/')}`,
      })),
    ];
  }, [directory]);

  async function parseAction(response: Response, fallback: string): Promise<unknown> {
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(getErrorMessage(body, fallback));
    return body;
  }

  async function openFile(path: string) {
    setEditorPath(path);
    setEditorContent('');
    setEditorError(null);
    setEditorDirty(false);
    setEditorLoading(true);
    try {
      const response = await fetch(
        `/api/vps/${encodeURIComponent(vpsId)}/files/read?path=${encodeURIComponent(path)}`,
        { cache: 'no-store' },
      );
      const body = (await parseAction(response, 'Gagal membaca file')) as { content?: string };
      setEditorContent(body.content ?? '');
    } catch (readError) {
      setEditorError(readError instanceof Error ? readError.message : 'Gagal membaca file');
    } finally {
      setEditorLoading(false);
    }
  }

  function closeEditor() {
    if (editorDirty && !window.confirm('Perubahan yang belum disimpan akan hilang. Tutup editor?')) return;
    setEditorPath(null);
    setEditorError(null);
    setEditorDirty(false);
  }

  async function saveEditor() {
    if (!editorPath) return;
    setEditorSaving(true);
    setEditorError(null);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editorPath, content: editorContent }),
      });
      await parseAction(response, 'Gagal menyimpan file');
      setEditorDirty(false);
      toast.success('File berhasil disimpan.');
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : 'Gagal menyimpan file');
    } finally {
      setEditorSaving(false);
    }
  }

  async function createItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newItem?.name.trim()) return;
    const item = newItem;
    const path = joinPath(directory, item.name.trim());
    setActionLoading(true);
    try {
      const endpoint = item.type === 'file' ? 'write' : 'mkdir';
      const body = item.type === 'file' ? { path, content: '' } : { path };
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/files/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await parseAction(response, item.type === 'file' ? 'Gagal membuat file' : 'Gagal membuat folder');
      setNewItem(null);
      toast.success(item.type === 'file' ? 'File berhasil dibuat.' : 'Folder berhasil dibuat.');
      await loadDirectory(directory);
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : 'Gagal membuat item');
    } finally {
      setActionLoading(false);
    }
  }

  async function renameItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming?.name.trim()) return;
    const item = renaming;
    const from = joinPath(directory, item.entry.name);
    const to = joinPath(directory, item.name.trim());
    if (from === to) {
      setRenaming(null);
      return;
    }
    setActionLoading(true);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      await parseAction(response, 'Gagal mengganti nama');
      setRenaming(null);
      toast.success('File berhasil di-rename.');
      await loadDirectory(directory);
    } catch (renameError) {
      toast.error(renameError instanceof Error ? renameError.message : 'Gagal mengganti nama');
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteItem() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setActionLoading(true);
    try {
      const response = await fetch(
        `/api/vps/${encodeURIComponent(vpsId)}/files?path=${encodeURIComponent(joinPath(directory, target.name))}`,
        { method: 'DELETE' },
      );
      await parseAction(response, 'Gagal menghapus item');
      setDeleteTarget(null);
      toast.success('Item berhasil dihapus.');
      await loadDirectory(directory);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Gagal menghapus item');
    } finally {
      setActionLoading(false);
    }
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setActionLoading(true);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append('file', file);
        form.append('path', joinPath(directory, file.name));
        const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/files/upload`, {
          method: 'POST',
          body: form,
        });
        await parseAction(response, `Gagal mengupload ${file.name}`);
      }
      toast.success(`${fileList.length} file berhasil diupload.`);
      await loadDirectory(directory);
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Gagal mengupload file');
    } finally {
      setActionLoading(false);
      if (uploadInput.current) uploadInput.current.value = '';
    }
  }

  function downloadFile(path: string) {
    window.open(
      `/api/vps/${encodeURIComponent(vpsId)}/files/download?path=${encodeURIComponent(path)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg border border-line bg-base-850 px-3 py-1.5 text-xs">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex shrink-0 items-center gap-1">
              {index > 0 && <span className="text-ink-faint">/</span>}
              <button
                type="button"
                onClick={() => setDirectory(crumb.path)}
                className={`font-mono transition-colors ${index === breadcrumbs.length - 1 ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        {canEdit && (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setNewItem({ type: 'file', name: '' })}>
              + File
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setNewItem({ type: 'folder', name: '' })}>
              + Folder
            </Button>
            <Button type="button" size="sm" variant="secondary" loading={actionLoading} onClick={() => uploadInput.current?.click()}>
              Upload
            </Button>
            <input
              ref={uploadInput}
              type="file"
              hidden
              multiple
              onChange={(event) => void uploadFiles(event.target.files)}
            />
          </>
        )}
        <Button type="button" size="sm" variant="ghost" loading={loading} onClick={() => void loadDirectory(directory)} aria-label="Refresh file list">
          {!loading && '↻'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </div>
      )}
      {!canEdit && (
        <div className="rounded-lg border border-line-soft bg-base-850 px-3 py-2 text-xs text-ink-muted">
          VPS ini dibagikan kepada Anda dalam mode read-only.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-base-850">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-3">Nama</th>
              <th className="hidden px-3 py-3 md:table-cell">Ukuran</th>
              <th className="hidden px-3 py-3 lg:table-cell">Permission</th>
              <th className="hidden px-3 py-3 md:table-cell">Diubah</th>
              <th className="w-36 px-3 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-ink-muted">
                  <span className="inline-flex items-center gap-2"><Spinner size="sm" /> Membaca direktori…</span>
                </td>
              </tr>
            )}
            {!loading && directory !== '/' && (
              <tr className="border-b border-line-soft/60 hover:bg-base-800/60">
                <td colSpan={5} className="px-4 py-2">
                  <button type="button" onClick={() => setDirectory(parentPath(directory))} className="font-mono text-xs text-accent hover:underline">
                    ↰ ..
                  </button>
                </td>
              </tr>
            )}
            {!loading && sortedEntries.map((entry) => {
              const path = joinPath(directory, entry.name);
              const isDirectory = entry.type === 'directory';
              return (
                <tr key={`${entry.type}:${entry.name}`} className="group border-b border-line-soft/60 last:border-0 hover:bg-base-800/60">
                  <td className="min-w-0 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => (isDirectory ? setDirectory(path) : void openFile(path))}
                      className={`flex max-w-full items-center gap-2 text-left ${isDirectory ? 'text-accent' : 'text-ink hover:text-accent'}`}
                    >
                      <span aria-hidden="true">{fileIcon(entry)}</span>
                      <span className="truncate font-mono text-xs">{entry.name}</span>
                      {entry.type === 'symlink' && <Badge tone="violet">link</Badge>}
                    </button>
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono text-xs text-ink-muted md:table-cell">
                    {isDirectory ? '—' : formatBytes(entry.size)}
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono text-xs text-ink-muted lg:table-cell">
                    {entry.permissions}
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-ink-muted md:table-cell">
                    {entry.modified_at ? new Date(entry.modified_at).toLocaleString('id-ID') : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {!isDirectory && (
                        <button type="button" onClick={() => downloadFile(path)} className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-accent" title="Download">
                          ⬇
                        </button>
                      )}
                      {canEdit && (
                        <>
                          {!isDirectory && (
                            <button type="button" onClick={() => void openFile(path)} className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-accent" title="Edit">
                              ✎
                            </button>
                          )}
                          <button type="button" onClick={() => setRenaming({ entry, name: entry.name })} className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-accent" title="Rename">
                            ↔
                          </button>
                          <button type="button" onClick={() => setDeleteTarget(entry)} className="rounded px-1.5 py-1 text-xs text-ink-muted hover:text-red-400" title="Hapus">
                            🗑
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && !error && sortedEntries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-ink-faint">Folder kosong</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(editorPath)} onClose={closeEditor} wide title={<span className="font-mono text-xs text-ink-muted">{editorPath}</span>}>
        {editorLoading ? (
          <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>
        ) : editorError ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-8 text-center text-sm text-red-300">{editorError}</div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-line">
              <Editor
                height="58vh"
                language={languageForPath(editorPath ?? '')}
                theme="vs-dark"
                value={editorContent}
                onChange={(value) => {
                  setEditorContent(value ?? '');
                  setEditorDirty(true);
                }}
                options={{
                  automaticLayout: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                  readOnly: !canEdit,
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-faint">{editorDirty ? '● Belum disimpan' : 'Tersimpan'}{editorError && <span className="ml-2 text-red-400">{editorError}</span>}</span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={closeEditor}>Cancel</Button>
                {canEdit && <Button type="button" size="sm" loading={editorSaving} disabled={!editorDirty} onClick={() => void saveEditor()}>Save</Button>}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(newItem)} onClose={() => setNewItem(null)} title={newItem?.type === 'file' ? '+ File' : '+ Folder'}>
        <form className="space-y-4" onSubmit={(event) => void createItem(event)}>
          <Field label={newItem?.type === 'file' ? 'Nama file' : 'Nama folder'} required>
            <Input
              autoFocus
              value={newItem?.name ?? ''}
              onChange={(event) => setNewItem((current) => current ? { ...current, name: event.target.value } : current)}
              placeholder={newItem?.type === 'file' ? 'config.yml' : 'new-folder'}
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setNewItem(null)} disabled={actionLoading}>Cancel</Button>
            <Button type="submit" size="sm" loading={actionLoading}>Create</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title={`Rename ${renaming?.entry.name ?? ''}`}>
        <form className="space-y-4" onSubmit={(event) => void renameItem(event)}>
          <Field label="Nama baru" required>
            <Input
              autoFocus
              value={renaming?.name ?? ''}
              onChange={(event) => setRenaming((current) => current ? { ...current, name: event.target.value } : current)}
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(null)} disabled={actionLoading}>Cancel</Button>
            <Button type="submit" size="sm" loading={actionLoading}>Rename</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Hapus item?">
        <p className="text-sm text-ink-muted">
          <span className="font-mono text-ink">{deleteTarget?.name}</span> akan dihapus permanen dari VPS.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setDeleteTarget(null)} disabled={actionLoading}>Cancel</Button>
          <Button type="button" size="sm" variant="danger" loading={actionLoading} onClick={() => void deleteItem()}>Hapus</Button>
        </div>
      </Modal>
    </div>
  );
}
