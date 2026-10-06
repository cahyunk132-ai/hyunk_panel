/**
 * Parser NBT (Named Binary Tag) — pure TypeScript, TANPA library eksternal.
 *
 * Dipakai untuk membaca file `.dat` Minecraft Java Edition (mis. playerdata).
 * Tag yang didukung: TAG_Byte s/d TAG_Long_Array (1–12) — cukup untuk
 * playerdata Minecraft modern (1.16+). File `.dat` biasanya dikompresi gzip;
 * `parseNbt` mendeteksi magic byte gzip (0x1f 0x8b) dan men-decompress sendiri
 * memakai `zlib.gunzipSync` bawaan Node.js.
 *
 * Catatan tipe nilai:
 * - TAG_Long / TAG_Long_Array  → `bigint` (nilai bisa melebihi Number.MAX_SAFE_INTEGER)
 * - TAG_Byte_Array             → `Buffer`
 * - TAG_Int_Array              → `number[]`
 * - TAG_List                   → `NbtValue[]`
 * - TAG_Compound               → object
 *
 * Hanya membaca (read-only) — tidak ada encoder. Tidak semua edge case NBT
 * ditangani: error dilempar sebagai `NbtParseError` bila data rusak/terpotong.
 */

import { gunzipSync } from 'node:zlib';

/** Nilai NBT yang mungkin dikembalikan parser. */
export type NbtValue = number | bigint | string | NbtValue[] | NbtCompound | Buffer;

/**
 * Compound NBT: field name → nilai (ekuivalen `Record<string, NbtValue>`).
 * Index signature ditulis eksplisit karena TypeScript tidak bisa memakai
 * `Record<...>` pada tipe rekursif seperti ini.
 */
export type NbtCompound = { [key: string]: NbtValue };

// ── Tag type id (spesifikasi NBT resmi) ─────────────────────────────────────
const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

/** Batas kedalaman rekursi — jaga-jaga terhadap file korup (hindari stack overflow). */
const MAX_DEPTH = 128;
/** Batas jumlah elemen list/array yang wajar untuk playerdata. */
const MAX_ELEMENTS = 4_000_000;

export class NbtParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NbtParseError';
  }
}

export function isGzipped(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/** Reader sequential big-endian di atas Buffer. */
class NbtReader {
  private buf: Buffer;
  private offset = 0;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private need(bytes: number): void {
    if (this.remaining < bytes) {
      throw new NbtParseError(
        `Data NBT terpotong: butuh ${bytes} byte, tersisa ${this.remaining} byte`,
      );
    }
  }

  private length(count: number, label: string): number {
    if (count < 0) throw new NbtParseError(`Panjang ${label} negatif (${count})`);
    if (count > MAX_ELEMENTS) throw new NbtParseError(`Panjang ${label} tidak wajar (${count})`);
    return count;
  }

  u8(): number {
    this.need(1);
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  i8(): number {
    this.need(1);
    const v = this.buf.readInt8(this.offset);
    this.offset += 1;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  i64(): bigint {
    this.need(8);
    const v = this.buf.readBigInt64BE(this.offset);
    this.offset += 8;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.buf.readFloatBE(this.offset);
    this.offset += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.buf.readDoubleBE(this.offset);
    this.offset += 8;
    return v;
  }

  /** Salinan byte (bukan subarray) supaya hasil tidak bergantung buffer asal. */
  bytes(count: number): Buffer {
    this.need(count);
    const v = Buffer.from(this.buf.subarray(this.offset, this.offset + count));
    this.offset += count;
    return v;
  }

  /** TAG_String: panjang (unsigned short) + UTF-8. */
  str(): string {
    const len = this.u16();
    return this.bytes(len).toString('utf8');
  }

  /** Baca payload sesuai tag type. */
  payload(type: number, depth: number): NbtValue {
    switch (type) {
      case TAG_BYTE:
        return this.i8();
      case TAG_SHORT:
        return this.i16();
      case TAG_INT:
        return this.i32();
      case TAG_LONG:
        return this.i64();
      case TAG_FLOAT:
        return this.f32();
      case TAG_DOUBLE:
        return this.f64();
      case TAG_BYTE_ARRAY:
        return this.bytes(this.length(this.i32(), 'byte array'));
      case TAG_STRING:
        return this.str();
      case TAG_LIST:
        return this.list(depth);
      case TAG_COMPOUND:
        return this.compound(depth);
      case TAG_INT_ARRAY: {
        const count = this.length(this.i32(), 'int array');
        const out: number[] = new Array(count);
        for (let i = 0; i < count; i += 1) out[i] = this.i32();
        return out;
      }
      case TAG_LONG_ARRAY: {
        const count = this.length(this.i32(), 'long array');
        const out: bigint[] = new Array(count);
        for (let i = 0; i < count; i += 1) out[i] = this.i64();
        return out;
      }
      default:
        throw new NbtParseError(`Tag type tidak dikenal: ${type}`);
    }
  }

  /** TAG_List: 1 byte tipe elemen + 4 byte jumlah + payload berulang. */
  private list(depth: number): NbtValue[] {
    if (depth > MAX_DEPTH) throw new NbtParseError('Kedalaman NBT melebihi batas');
    const elementType = this.u8();
    const count = this.length(this.i32(), 'list');
    const out: NbtValue[] = [];
    // List kosong ditulis Minecraft sebagai TAG_End dengan count 0.
    if (elementType === TAG_END) return out;
    for (let i = 0; i < count; i += 1) out.push(this.payload(elementType, depth + 1));
    return out;
  }

  /** TAG_Compound: deretan (type, name, payload) sampai TAG_End. */
  compound(depth: number): NbtCompound {
    if (depth > MAX_DEPTH) throw new NbtParseError('Kedalaman NBT melebihi batas');
    const out: NbtCompound = {};
    for (;;) {
      const type = this.u8();
      if (type === TAG_END) return out;
      const name = this.str();
      out[name] = this.payload(type, depth + 1);
    }
  }
}

/**
 * Parse buffer NBT (sudah/belum gzip) → compound root.
 * File `.dat` Minecraft: byte pertama TAG_Compound (10), lalu nama root
 * (biasanya string kosong), lalu payload — field player ada di root compound.
 */
export function parseNbt(buffer: Buffer): NbtCompound {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new NbtParseError('Buffer NBT kosong');
  }

  let data = buffer;
  if (isGzipped(buffer)) {
    try {
      data = gunzipSync(buffer);
    } catch (err) {
      throw new NbtParseError(
        `Gagal men-decompress gzip: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  const reader = new NbtReader(data);
  const rootType = reader.u8();
  if (rootType !== TAG_COMPOUND) {
    throw new NbtParseError(`Root NBT harus TAG_Compound (10), ditemukan ${rootType}`);
  }
  reader.str(); // nama root — untuk playerdata selalu kosong
  return reader.compound(0);
}
