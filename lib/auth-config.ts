/**
 * Shared auth constants.
 *
 * Centralised so the registration and password-recovery flows can never
 * disagree about how long a code is or how long the resend cooldown runs —
 * they previously each had their own copy.
 */

/**
 * Digits in an emailed one-time code.
 *
 * MUST match Supabase → Authentication → Email → "OTP Length". Supabase
 * generates the code; this value only controls the input's maxLength and the
 * client-side completeness check. If the dashboard still says 6 and this says
 * 8, the field will never consider a valid code complete.
 */
export const OTP_CODE_LENGTH = 8

/** Minimum characters for a new password. */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Seconds the resend button stays disabled. Supabase rate-limits OTP emails to
 * roughly one per minute per address, so a shorter cooldown would only produce
 * 429s the customer cannot act on.
 */
export const RESEND_COOLDOWN_SECONDS = 60
