// Helpers compartilhados entre os módulos de rotas
import * as crypto from 'crypto';

/** Recursively strips password and inviteToken from any object/array before sending to client */
export function omitSensitive(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(omitSensitive);
  const { password, inviteToken, ...rest } = obj;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, omitSensitive(v)]));
}

export function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw httpError(400, `${field} is too long`);
  return trimmed;
}

export function requiredString(value: unknown, field: string, maxLength: number) {
  const text = optionalString(value, field, maxLength);
  if (!text) throw httpError(400, `${field} is required`);
  return text;
}

export function optionalInt(value: unknown, field: string, min: number, max: number, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw httpError(400, `${field} must be an integer from ${min} to ${max}`);
  }
  return numberValue;
}

export function uniqueStrings(values: unknown, field: string, maxItems = 50) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw httpError(400, `${field} must be an array`);
  const clean = values.map((value) => requiredString(value, field, 128));
  if (clean.length > maxItems) throw httpError(400, `${field} has too many values`);
  return [...new Set(clean)];
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newInvite() {
  return {
    inviteToken: crypto.randomBytes(32).toString('hex'),
    inviteExpires: new Date(Date.now() + INVITE_TTL_MS),
  };
}

export const REPORT_STATUSES_FROM_STUDENT = new Set(['DRAFT', 'SUBMITTED']);
export const PERFORMANCE_LEVELS = new Set(['EXCEEDING', 'MEETING', 'APPROACHING', 'BEGINNING']);
