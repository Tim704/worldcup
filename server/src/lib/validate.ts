/**
 * validate.ts — small typed input validators (Contract §6, §10).
 *
 * Every validator either returns a correctly-typed, normalised value or
 * throws `AppError('VALIDATION', …)` (HTTP 400) with a human-readable field
 * message. Route handlers compose these at the top of each handler so that
 * by the time any SQL runs, every input is known-good. This is also where
 * `any` stays quarantined: bodies/queries arrive as `unknown` and leave typed.
 */
import { AppError } from '../error.js';

/** Username policy (Contract §6): 2–20 chars of letters, digits, '_' or space. */
export const USERNAME_RE = /^[A-Za-z0-9_ ]{2,20}$/;

/** Canonical UUID shape (any version) — matched case-insensitively. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Throw the standard VALIDATION error. */
export function invalid(message: string): never {
  throw new AppError('VALIDATION', message);
}

/** Ensure the request body is a plain JSON object (not null/array/scalar). */
export function vBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

/**
 * Required trimmed string with inclusive length bounds (measured AFTER
 * trimming, mirroring the DB's `length(btrim(…))` CHECK constraints).
 */
export function vString(value: unknown, field: string, minLen: number, maxLen: number): string {
  if (typeof value !== 'string') invalid(`${field} must be a string`);
  const trimmed = (value as string).trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    invalid(`${field} must be ${minLen}–${maxLen} characters after trimming`);
  }
  return trimmed;
}

/** Required integer within an inclusive [min, max] range. */
export function vInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    invalid(`${field} must be an integer`);
  }
  const n = value as number;
  if (n < min || n > max) invalid(`${field} must be between ${min} and ${max}`);
  return n;
}

/** Required boolean. */
export function vBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(`${field} must be a boolean`);
  return value as boolean;
}

/** Required UUID string (normalised to lowercase). */
export function vUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    invalid(`${field} must be a UUID`);
  }
  return (value as string).toLowerCase();
}

/** Required member of a fixed string-literal set (enum guard). */
export function vEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalid(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

/**
 * Validated username (Contract §6): trim first, then enforce
 * `^[A-Za-z0-9_ ]{2,20}$`. Returns the trimmed username as typed (original
 * casing preserved — lookups use lower(username)).
 */
export function vUsername(value: unknown): string {
  if (typeof value !== 'string') invalid('username must be a string');
  const trimmed = (value as string).trim();
  if (!USERNAME_RE.test(trimmed)) {
    invalid('username must be 2–20 characters: letters, digits, underscore or space');
  }
  return trimmed;
}
