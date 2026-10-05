import crypto from 'node:crypto';

/**
 * Enkripsi token Wings saat disimpan di database.
 * Format: AES-256-GCM, IV acak 12 byte, output "iv.tag.ciphertext" (base64).
 * Key dibaca dari env WINGS_TOKEN_ENCRYPTION_KEY (64 hex chars = 32 bytes).
 * JANGAN PERNAH hardcode key di sini.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
  const hex = process.env.WINGS_TOKEN_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'WINGS_TOKEN_ENCRYPTION_KEY tidak valid. Generate dengan: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Format token terenkripsi tidak valid di database');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
