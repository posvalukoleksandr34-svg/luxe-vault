import { z } from 'zod'

import { RETURN_REASONS, RETURN_REQUEST_STATUSES } from '@/lib/types'

/**
 * What a return request may contain, as one definition both sides share.
 *
 * The browser validates to tell the customer what is wrong while they type;
 * the server validates because the browser's answer is a suggestion, not a
 * fact. Sharing the schema is what stops the two drifting into a form that
 * accepts what the route rejects.
 *
 * Zod rather than lib/validation.ts's hand-rolled guards: these shapes are
 * nested and reused across a form, an action and an admin route, which is
 * where writing the checks by hand stops being cheaper than a schema.
 */

/** Long enough to be a description, short enough not to be an essay pasted
 *  into a database column nobody reads. */
const COMMENT_MAX = 2000

/** Matches the bucket's own limit in migration 0039. The server re-checks the
 *  real file; this only rejects a manifest that is obviously wrong. */
export const RETURN_IMAGE_MAX = 6

export const returnReasonSchema = z.enum(RETURN_REASONS)
export const returnRequestStatusSchema = z.enum(RETURN_REQUEST_STATUSES)

/**
 * An uploaded object's path inside the 'returns' bucket.
 *
 * Constrained deliberately: this string is handed to Supabase Storage, so a
 * value containing `..` or a leading slash is a request to read somewhere
 * else. The upload route mints these names, so anything not of that shape did
 * not come from us.
 */
export const returnImagePathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^returns\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'Not a returns object path')

/** What the customer's form sends. */
export const createReturnRequestSchema = z.object({
  /** The LV-XXXXXX number, as shown on the order. */
  orderNumber: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, 'Not an order number'),
  reason: returnReasonSchema,
  comment: z.string().trim().max(COMMENT_MAX).default(''),
  images: z.array(returnImagePathSchema).max(RETURN_IMAGE_MAX).default([]),
})
export type CreateReturnRequestInput = z.infer<typeof createReturnRequestSchema>

/**
 * A manager's decision.
 *
 * A rejection MUST carry a note. The customer is told why, and "rejected, no
 * reason given" is the outcome that generates the support ticket this whole
 * feature exists to avoid — so it is a schema rule, not a UI convention.
 */
export const decideReturnRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    id: z.string().uuid(),
    /** Major units in CHF. Omitted refunds whatever remains unrefunded. */
    amount: z.number().positive().max(1_000_000).optional(),
    adminNotes: z.string().trim().max(COMMENT_MAX).optional(),
  }),
  z.object({
    decision: z.literal('reject'),
    id: z.string().uuid(),
    adminNotes: z.string().trim().min(1, 'A rejection needs a reason').max(COMMENT_MAX),
  }),
])
export type DecideReturnRequestInput = z.infer<typeof decideReturnRequestSchema>

/** The admin list's filter. `all` is explicit rather than an absent value, so
 *  a typo in a query string cannot silently widen the view. */
export const returnsFilterSchema = z.enum(['all', ...RETURN_REQUEST_STATUSES]).default('pending')

/**
 * Turns a ZodError into one line a person can act on.
 *
 * Zod's own message is a JSON tree; handing that to a customer is how an error
 * toast ends up unreadable. The first issue is the one to fix first.
 */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Invalid request'
  const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${where}${issue.message}`
}
