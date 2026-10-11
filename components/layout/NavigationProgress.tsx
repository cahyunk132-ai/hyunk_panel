'use client';

import NProgress from 'nprogress';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

/**
 * Progress bar tipis di atas halaman saat pindah halaman (gaya NProgress).
 *
 * Catatan: App Router Next.js 14 tidak punya event router (routeChangeStart/Complete
 * hanya ada di Pages Router), jadi progress dimulai dari:
 *   - klik tautan internal (<a href>) yang akan memicu navigasi,
 *   - popstate (tombol back/forward), atau
 *   - pemanggilan manual `startNavigationProgress()` sebelum `router.push/replace`,
 * lalu diselesaikan saat `pathname` / query string berubah. Safety timeout
 * memastikan bar tidak pernah macet bila navigasi dibatalkan.
 *
 * Warna memakai CSS variable `--accent` (lihat globals.css) sehingga mengikuti tema aktif.
 */

NProgress.configure({ showSpinner: false, trickleSpeed: 160, minimum: 0.08, speed: 300 });

const SAFETY_TIMEOUT_MS = 12_000;

let pending = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearSafety() {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

/** Mulai progress bar navigasi. Aman dipanggil berkali-kali. */
export function startNavigationProgress(): void {
  if (typeof window === 'undefined') return;
  pending = true;
  NProgress.start();
  clearSafety();
  safetyTimer = setTimeout(finishNavigationProgress, SAFETY_TIMEOUT_MS);
}

/** Selesaikan progress bar (dipanggil saat URL berubah). */
export function finishNavigationProgress(): void {
  clearSafety();
  if (!pending) return;
  pending = false;
  NProgress.done();
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams?.toString() ?? ''}`;

  // Navigasi selesai → URL berubah.
  useEffect(() => {
    finishNavigationProgress();
  }, [routeKey]);

  // Navigasi dimulai → klik tautan internal atau back/forward.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || isModifiedClick(event)) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      if (!anchor.getAttribute('href')) return;

      let next: URL;
      try {
        next = new URL(anchor.href);
      } catch {
        return;
      }
      if (next.origin !== window.location.origin) return;
      // Endpoint API (mis. unduhan) bukan navigasi halaman → jangan memicu progress.
      if (next.pathname.startsWith('/api/')) return;
      // Hash-only / URL yang sama → tidak ada navigasi, jangan mulai progress.
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;

      startNavigationProgress();
    }

    function onPopState() {
      startNavigationProgress();
    }

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return null;
}

export function NavigationProgress() {
  // useSearchParams butuh boundary Suspense di App Router.
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
