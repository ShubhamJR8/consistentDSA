export const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export const isObjectIdString = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID_PATTERN.test(value);

export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
