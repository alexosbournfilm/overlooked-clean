// app/utils/moderation.ts

export type ModerationCheckResult = {
  safe: boolean;
  message?: string;
};

const BLOCKED_TERMS = [
  'kill yourself',
  'kys',
  'rape',
  'rapist',
  'nazi',
  'terrorist',
  'child porn',
  'cp',
  'nonce',
  'paedo',
  'pedo',
  'suicide',
  'self harm',
];

export function normalizeModerationText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsObjectionableContent(text?: string | null): boolean {
  if (!text) return false;

  const normalized = normalizeModerationText(text);

  return BLOCKED_TERMS.some((term) => {
    const normalizedTerm = normalizeModerationText(term);
    return normalized.includes(normalizedTerm);
  });
}

export function validateSafeText(text?: string | null): string | null {
  if (!text) return null;

  if (containsObjectionableContent(text)) {
    return 'This content may violate our community rules. Please edit it before posting.';
  }

  return null;
}

export function validateMultipleSafeTexts(
  fields: Array<{
    label: string;
    value?: string | null;
  }>
): ModerationCheckResult {
  for (const field of fields) {
    const error = validateSafeText(field.value);

    if (error) {
      return {
        safe: false,
        message: `${field.label}: ${error}`,
      };
    }
  }

  return {
    safe: true,
  };
}