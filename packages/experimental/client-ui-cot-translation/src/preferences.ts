/** Shared validation for Host configuration and browser preference drafts. */
export type { CotTranslationPreferences, CotTranslationSnapshot } from './types.ts'

/** Language preference accepted by both Host configuration and browser drafts. */
export const LANGUAGE_PREFERENCE_PATTERN = /^(?:auto|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/
