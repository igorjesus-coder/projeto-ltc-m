import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not accept non-finite numbers.');
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }

  throw new TypeError(`Canonical JSON does not accept values of type ${typeof value}.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function prettyCanonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256Bytes(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Canonical(value: unknown): string {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}
