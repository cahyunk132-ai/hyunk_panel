#!/usr/bin/env node
// Regression guard aturan Subdomain Manager.
//
// Aturan baru (1 subdomain per server, tanpa kuota per user):
//   1. Tidak ada sisa logika kuota per user — `SUBDOMAIN_QUOTA_PER_USER`,
//      `hasUnlimitedSubdomainQuota`, `countUserSubdomains`, dan RPC
//      `count_user_subdomains` harus benar-benar hilang dari route & lib.
//   2. Akses = punya akses ke server: `isPanelAdmin(role)` OR
//      `servers.owner_id === user.id` OR baris `server_users`. Dicek ASYNC dan
//      di-`await`; dulu salinan SYNC yang cuma cek `servers.owner_id` bikin
//      buyer (akses via `server_users`) kena 403, dan panggilan tanpa await
//      menghasilkan Promise (selalu truthy) → ceknya terlewat.
//   3. POST /api/servers/{id}/subdomain menolak server yang sudah punya
//      subdomain dengan 409 `SERVER_HAS_SUBDOMAIN_MESSAGE`.
//   4. UI: form register hanya muncul bila server belum punya subdomain, dan
//      SubdomainManager tidak menyebut kuota sama sekali.
//
// Jalankan: npm run verify:subdomain-access

import { readFileSync, existsSync } from 'node:fs';

const ROUTE = 'app/api/servers/[id]/subdomain/route.ts';
const PAGE = 'app/(dashboard)/servers/[id]/network/page.tsx';
const ACCESS = 'lib/subdomains/access.ts';
const COMPONENT = 'components/servers/SubdomainManager.tsx';
const LIB = 'lib/subdomains.ts';
const TYPES = 'types/index.ts';

const problems = [];

function read(file) {
  if (!existsSync(file)) {
    problems.push(`${file} tidak ditemukan`);
    return '';
  }
  return readFileSync(file, 'utf8');
}

function expect(file, pattern, message, source) {
  if (!pattern.test(source ?? read(file))) problems.push(`${file}: ${message}`);
}

const access = read(ACCESS);
const route = read(ROUTE);
const page = read(PAGE);
const component = read(COMPONENT);
const lib = read(LIB);
const types = read(TYPES);

// ─── 1. Logika kuota per user harus hilang ──────────────────────────────────
const QUOTA = /SUBDOMAIN_QUOTA_PER_USER|hasUnlimitedSubdomainQuota|countUserSubdomains|count_user_subdomains|SubdomainQuota/;
for (const [file, source] of [
  [ROUTE, route],
  [LIB, lib],
  [TYPES, types],
  [COMPONENT, component],
]) {
  const hit = source.split('\n').findIndex((line) => QUOTA.test(line));
  if (hit !== -1) {
    problems.push(
      `${file}:${hit + 1} masih ada logika kuota per user (${source.split('\n')[hit].trim()}). ` +
        'Sistem subdomain sekarang 1 per server tanpa kuota.',
    );
  }
}
if (/status:\s*429|,\s*429\s*\)/.test(route)) {
  problems.push(`${ROUTE}: masih ada response 429 (kuota) — semua request cukup 409/403/400.`);
}

// ─── 2. Satu sumber kebenaran untuk akses ───────────────────────────────────
if (access) {
  if (!/export async function hasServerAccess\(/.test(access)) {
    problems.push(`${ACCESS}: hasServerAccess harus ada dan async (butuh query server_users).`);
  }
  if (!/from\('server_users'\)/.test(access)) {
    problems.push(`${ACCESS}: harus cek tabel server_users, bukan hanya servers.owner_id.`);
  }
  if (!/isPanelAdmin\(user\.role\)/.test(access)) {
    problems.push(`${ACCESS}: Owner Panel/Admin harus selalu boleh (isPanelAdmin).`);
  }
  if (!/server\.owner_id === user\.id/.test(access)) {
    problems.push(`${ACCESS}: pemilik server (servers.owner_id) harus boleh.`);
  }
  if (!/export async function requireServerAccess\(/.test(access)) {
    problems.push(`${ACCESS}: requireServerAccess (guard 403/500 untuk API) harus ada.`);
  }
  if (!/throw new Error/.test(access)) {
    problems.push(`${ACCESS}: error query harus dilempar (jangan berubah jadi 403 palsu).`);
  }
  if (/canManageSubdomain/.test(access)) {
    problems.push(`${ACCESS}: canManageSubdomain sudah dihapus — pakai hasServerAccess/requireServerAccess.`);
  }
}

if (route) {
  if (/function canManageSubdomain/.test(route)) {
    problems.push(
      `${ROUTE}: jangan definisikan aturan akses lokal — impor dari ${ACCESS} ` +
        'supaya API dan UI tidak beda aturan.',
    );
  }
  for (const [line, text] of route.split('\n').entries()) {
    if (/requireServerAccess\s*\(/.test(text) && !/await/.test(text) && !/^(\s*\/\/|\s*\*|\s*--)/.test(text)) {
      problems.push(`${ROUTE}:${line + 1} ada panggilan tanpa await: ${text.trim()}`);
    }
  }

  const post = route.indexOf('export async function POST');
  const del = route.indexOf('export async function DELETE');
  for (const [method, idx] of [
    ['POST', post],
    ['DELETE', del],
  ]) {
    if (idx === -1) {
      problems.push(`${ROUTE}: handler ${method} tidak ditemukan.`);
      continue;
    }
    const head = route.slice(idx, idx + 900);
    if (!/await requireServerAccess\(/.test(head)) {
      problems.push(`${ROUTE}: handler ${method} harus guard akses (await requireServerAccess).`);
    }
  }

  if (post !== -1 && del !== -1) {
    const postBody = route.slice(post, del);
    if (!/status:\s*409/.test(postBody) || !/SERVER_HAS_SUBDOMAIN_MESSAGE/.test(postBody)) {
      problems.push(
        `${ROUTE}: POST harus menolak server yang sudah punya subdomain dengan 409 SERVER_HAS_SUBDOMAIN_MESSAGE.`,
      );
    }
    const checkAt = postBody.indexOf('SERVER_HAS_SUBDOMAIN_MESSAGE');
    const insertAt = postBody.indexOf('.insert(');
    if (checkAt !== -1 && insertAt !== -1 && checkAt > insertAt) {
      problems.push(`${ROUTE}: cek "sudah punya subdomain" harus SEBELUM insert, bukan sesudahnya.`);
    }
    if (/SUBDOMAIN_QUOTA/.test(postBody)) {
      problems.push(`${ROUTE}: cek kuota di POST harus dihapus.`);
    }
  }
}

// ─── 3. UI memakai aturan akses yang sama ───────────────────────────────────
if (page && !/hasServerAccess(Safe)?\(/.test(page)) {
  problems.push(`${PAGE}: akses harus dari aturan yang sama (${ACCESS} → hasServerAccessSafe).`);
}
if (page && /canManageSubdomain/.test(page)) {
  problems.push(`${PAGE}: canManageSubdomain sudah dihapus — pakai hasServerAccessSafe.`);
}
if (component) {
  if (!/canAccess/.test(component)) {
    problems.push(`${COMPONENT}: prop akses harus bernama canAccess.`);
  }
  if (!/SERVER_HAS_SUBDOMAIN_HINT/.test(component)) {
    problems.push(
      `${COMPONENT}: tampilkan pesan "${'Server ini sudah memiliki subdomain aktif'}" ` +
        '(SERVER_HAS_SUBDOMAIN_HINT) saat server sudah punya subdomain.',
    );
  }
  if (!/canAccess && !loading && !loadError && !subdomain/.test(component)) {
    problems.push(`${COMPONENT}: form register hanya boleh muncul bila server BELUM punya subdomain.`);
  }
}
expect(LIB, /export const SERVER_HAS_SUBDOMAIN_MESSAGE/, 'SERVER_HAS_SUBDOMAIN_MESSAGE harus ada (pesan 409).');

if (problems.length) {
  console.error('✗ verify:subdomain-access\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(
  '✓ verify:subdomain-access — 1 subdomain per server, tanpa kuota, akses server konsisten (async + server_users + await)',
);
