export interface VpsPayload {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  /** Plaintext only while inside the HTTPS API request; encrypt before storage. */
  credential?: string;
}

export interface ValidatedVpsPayload {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  credential?: string;
}

const MAX_NAME_LENGTH = 120;
const MAX_HOST_LENGTH = 253;
const MAX_USERNAME_LENGTH = 128;
const MAX_CREDENTIAL_LENGTH = 16_384;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(
  value: unknown,
  label: string,
  maxLength: number,
  required: boolean,
): { value?: string; error?: string } {
  if (value === undefined && !required) return {};
  if (typeof value !== 'string') return { error: `${label} harus berupa teks` };
  const normalized = value.trim();
  if (!normalized && required) return { error: `${label} wajib diisi` };
  if (normalized.length > maxLength) return { error: `${label} terlalu panjang` };
  return { value: normalized };
}

/**
 * Validate fields shared by POST and PATCH. Credential deliberately is not
 * trimmed: leading/trailing characters can be meaningful in a password/key.
 */
export function validateVpsPayload(
  input: unknown,
  options: { partial: boolean },
): { data?: ValidatedVpsPayload; error?: string } {
  if (!isRecord(input)) return { error: 'Body request tidak valid' };
  const { partial } = options;
  const data: ValidatedVpsPayload = {};

  const name = textField(input.name, 'Nama VPS', MAX_NAME_LENGTH, !partial);
  if (name.error) return { error: name.error };
  if (name.value !== undefined) data.name = name.value;

  const host = textField(input.host, 'Host', MAX_HOST_LENGTH, !partial);
  if (host.error) return { error: host.error };
  if (host.value !== undefined) data.host = host.value;

  if (input.port !== undefined || !partial) {
    const port = typeof input.port === 'number' ? input.port : Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: 'Port harus berupa angka antara 1 dan 65535' };
    }
    data.port = port;
  }

  const username = textField(input.username, 'Username', MAX_USERNAME_LENGTH, !partial);
  if (username.error) return { error: username.error };
  if (username.value !== undefined) data.username = username.value;

  if (input.credential !== undefined || !partial) {
    if (typeof input.credential !== 'string') return { error: 'Credential harus berupa teks' };
    if (!input.credential && !partial) return { error: 'Credential wajib diisi' };
    if (input.credential.length > MAX_CREDENTIAL_LENGTH) return { error: 'Credential terlalu panjang' };
    if (input.credential) data.credential = input.credential;
  }

  if (Object.keys(data).length === 0) return { error: 'Tidak ada perubahan yang dikirim' };
  return { data };
}
