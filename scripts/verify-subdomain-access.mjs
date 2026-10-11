#!/usr/bin/env node
// Regression guard untuk bug akses subdomain buyer.
//
// Bug lama (berulang di beberapa PR): `canManageSubdomain` versi SYNC yang cuma
// membandingkan `servers.owner_id`. Buyer yang aksesnya lewat `server_users`
// akhirnya kena 403 di POST/DELETE /api/servers/{id}/subdomain, dan kalau handler
// memanggilnya tanpa `await` hasilnya Promise (selalu truthy) → ceknya dilewati.
//
// Jalankan: npm run verify:subdomain-access

import { readFileSync, existsSync } from 'node:fs';

const ROUTE = 'app/api/servers/[id]/subdomain/route.ts';
const PAGE = 'app/(dashboard)/servers/[id]/network/page.tsx';
const ACCESS = 'lib/subdomains/access.ts';

const problems = [];

function read(file) {
  if (!existsSync(file)) {
    problems.push(`${file} tidak ditemukan`);
    return '';
  }
  return readFileSync(file, 'utf8');
}

const access = read(ACCESS);
const route = read(ROUTE);
const page = read(PAGE);

if (access) {
  if (!/async function canManageSubdomain/.test(access)) {
    problems.push(`${ACCESS}: canManageSubdomain harus async (butuh query server_users).`);
  }
  if (!/from\('server_users'\)/.test(access)) {
    problems.push(`${ACCESS}: harus cek tabel server_users, bukan hanya servers.owner_id.`);
  }
  if (!/throw new Error/.test(access)) {
    problems.push(`${ACCESS}: error query harus dilempar (jangan berubah jadi 403 palsu).`);
  }
}

if (route) {
  if (/function canManageSubdomain/.test(route)) {
    problems.push(
      `${ROUTE}: jangan definisikan canManageSubdomain lokal — impor dari ${ACCESS} ` +
        'supaya API dan UI tidak beda aturan.',
    );
  }
  for (const [line, text] of route.split('\n').entries()) {
    if (/canManageSubdomain\s*\(/.test(text) && !/await/.test(text) && !/^\s*(\/\/|\*|--)/.test(text)) {
      problems.push(`${ROUTE}:${line + 1} ada panggilan tanpa await: ${text.trim()}`);
    }
    if (/server\.owner_id === user\.id\s*\)/.test(text) && !/server_users/.test(route)) {
      problems.push(`${ROUTE}:${line + 1} cek owner-only tanpa fallback server_users.`);
    }
  }
  for (const method of ['POST', 'DELETE']) {
    const idx = route.indexOf(`export async function ${method}`);
    if (idx === -1) {
      problems.push(`${ROUTE}: handler ${method} tidak ditemukan.`);
      continue;
    }
    const head = route.slice(idx, idx + 900);
    if (!/requireSubdomainAccess|canManageSubdomain/.test(head)) {
      problems.push(`${ROUTE}: handler ${method} harus guard akses (requireSubdomainAccess).`);
    }
  }
}

if (page && !/canManageSubdomain(Safe)?\(/.test(page)) {
  problems.push(`${PAGE}: canManage harus dari aturan yang sama (${ACCESS} → canManageSubdomainSafe).`);
}

if (problems.length) {
  console.error('✗ verify:subdomain-access\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('✓ verify:subdomain-access — aturan akses subdomain konsisten (async + server_users + await)');
