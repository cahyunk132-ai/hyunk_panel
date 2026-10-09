import 'server-only';
import crypto from 'node:crypto';
import type { S3StorageConfig } from '@/types';

/**
 * S3-compatible storage provider (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
 *
 * Ditandatangani manual dengan AWS Signature Version 4 via fetch — tanpa AWS
 * SDK, sehingga bisa dipakai di Vercel serverless tanpa dependency berat.
 * Upload memakai `UNSIGNED-PAYLOAD` (valid untuk HTTPS) dan body stream,
 * sehingga file >1GB tidak perlu di-buffer di memory.
 *
 * Selalu path-style: {endpoint}/{bucket}/{key} — didukung semua provider
 * S3-compatible. Default endpoint: https://s3.{region}.amazonaws.com
 *
 * Key tujuan: Hyunk Panel Backups/{server_name}/{filename}
 */

export const S3_ROOT_FOLDER = 'Hyunk Panel Backups';

export interface S3UploadResult {
  fileId: string;
  fileName: string;
  size?: number;
}

/** Payload hash untuk request tanpa body (GET/DELETE). */
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');
/** Payload hash untuk request dengan body stream (PUT) — valid di HTTPS. */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** URI-encode sesuai RFC 3986 (dipakai SigV4 untuk path & query). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Bangun request yang sudah ditandatangani SigV4.
 * Hanya `host` + `x-amz-*` yang di-sign (itu yang diwajibkan AWS); header lain
 * (Content-Type, Content-Length) dikirim apa adanya tanpa di-sign — menghindari
 * signature mismatch bila HTTP client mengubah header tersebut.
 */
function signS3Request(options: {
  method: string;
  config: S3StorageConfig;
  /** Key objek (tanpa bucket); kosong untuk operasi level bucket. */
  key?: string;
  query?: Record<string, string>;
  /** Header tambahan yang DIKIRIM tapi tidak di-sign. */
  headers?: Record<string, string>;
  payloadHash: string;
}): SignedRequest {
  const { config } = options;
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).replace(/\/+$/, '');
  const keyPath = options.key
    ? `/${encodeRfc3986(config.bucket)}/${options.key.split('/').map(encodeRfc3986).join('/')}`
    : `/${encodeRfc3986(config.bucket)}`;

  const url = new URL(endpoint);
  const host = url.host;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  // Hanya ketiga header ini yang masuk canonical request.
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': options.payloadHash,
    'x-amz-date': amzDate,
  };
  const signedNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}\n`)
    .join('');

  const canonicalQuery = Object.keys(options.query ?? {})
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String((options.query ?? {})[k]))}`)
    .join('&');

  const canonicalRequest = [
    options.method,
    keyPath,
    canonicalQuery,
    canonicalHeaders,
    signedNames.join(';'),
    options.payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${config.secret_key}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const { host: _host, ...signedSendHeaders } = headers;
  return {
    url: `${endpoint}${keyPath}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
    headers: {
      ...(options.headers ?? {}),
      ...signedSendHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.access_key}/${credentialScope}, SignedHeaders=${signedNames.join(';')}, Signature=${signature}`,
    },
  };
}

function objectKey(serverName: string, filename: string): string {
  return `${S3_ROOT_FOLDER}/${serverName}/${filename}`;
}

/** Upload stream ke s3://{bucket}/Hyunk Panel Backups/{serverName}/{filename}. */
export async function uploadToS3(
  config: S3StorageConfig,
  serverName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  size?: number,
): Promise<S3UploadResult> {
  const key = objectKey(serverName, filename);
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (size !== undefined && Number.isFinite(size) && size >= 0) {
    headers['Content-Length'] = String(size);
  }
  const signed = signS3Request({
    method: 'PUT',
    config,
    key,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
  });
  // Header `host` tidak dikirim via fetch (sudah di-sign; undici mengisinya dari URL).
  const { host: _host, ...sendHeaders } = signed.headers;
  const res = await fetch(signed.url, {
    method: 'PUT',
    headers: sendHeaders,
    body: stream,
    cache: 'no-store',
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  if (!res.ok) {
    throw new Error(`S3 upload → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
  return { fileId: key, fileName: filename, size };
}

/** Test koneksi: ListObjectsV2 max-keys=1 pada bucket. */
export async function testS3(config: S3StorageConfig): Promise<{ ok: boolean; message: string }> {
  const signed = signS3Request({
    method: 'GET',
    config,
    query: { 'list-type': '2', 'max-keys': '1' },
    payloadHash: EMPTY_SHA256,
  });
  const { host: _host, ...sendHeaders } = signed.headers;
  const res = await fetch(signed.url, { method: 'GET', headers: sendHeaders, cache: 'no-store' });
  if (!res.ok) {
    return { ok: false, message: `S3 API → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
  }
  return { ok: true, message: `Bucket "${config.bucket}" dapat diakses` };
}

/** Hapus objek berdasarkan key. */
export async function deleteS3Object(config: S3StorageConfig, key: string): Promise<void> {
  const signed = signS3Request({ method: 'DELETE', config, key, payloadHash: EMPTY_SHA256 });
  const { host: _host, ...sendHeaders } = signed.headers;
  const res = await fetch(signed.url, { method: 'DELETE', headers: sendHeaders, cache: 'no-store' });
  // 204/404 sama-sama berarti objek sudah tidak ada.
  if (!res.ok && res.status !== 404) {
    throw new Error(`S3 delete → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}

/** URL download path-style (untuk S3 publik / link sementara bisa ditambah). */
export function getS3FileUrl(config: S3StorageConfig, key: string): string {
  const endpoint = (config.endpoint || `https://s3.${config.region}.amazonaws.com`).replace(/\/+$/, '');
  const encodedKey = key.split('/').map(encodeRfc3986).join('/');
  return `${endpoint}/${encodeRfc3986(config.bucket)}/${encodedKey}`;
}
