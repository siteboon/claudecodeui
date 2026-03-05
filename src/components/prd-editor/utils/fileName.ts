import { INVALID_FILE_NAME_CHARACTERS, PRD_EXTENSION_PATTERN } from '../constants';

export function sanitizeFileName(value: string): string {
  return value.replace(INVALID_FILE_NAME_CHARACTERS, '');
}

export function stripPrdExtension(value: string): string {
  return value.replace(PRD_EXTENSION_PATTERN, '');
}

export function ensurePrdExtension(value: string): string {
  return PRD_EXTENSION_PATTERN.test(value) ? value : `${value}.txt`;
}

export function createDefaultPrdName(date: Date): string {
  const isoDate = date.toISOString().split('T')[0];
  return `prd-${isoDate}`;
}
