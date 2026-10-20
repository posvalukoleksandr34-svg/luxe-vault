import { z } from 'zod'

import { CLAIM_TYPES, RESOLUTIONS } from '@/lib/refunds/types'

// No compiled validators: the CSP forbids eval (see lib/returns/schema.ts).
z.config({ jitless: true })

/**
 * What the refund APIs accept, shared by the forms and the routes. These
 * check SHAPE only; whether a request is allowed, and what it is worth, is
 * decided on the server from the order and the policy.
 */

export const photoPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^returns\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'Not a returns object path')

export const orderNumberSchema = z
  .string()
  .trim()
  .min(4)
  .max(40)
  .regex(/^[A-Za-z0-9-]+$/, 'Not an order number')

export const createCaseSchema = z.object({
  orderNumber: orderNumberSchema,
  claimType: z.enum(CLAIM_TYPES),
  resolution: z.enum(RESOLUTIONS),
  lines: z
    .array(z.object({ orderItemId: z.string().uuid(), qty: z.number().int().min(1).max(999) }))
    .min(1)
    .max(50),
  description: z.string().trim().max(2000).default(''),
  photos: z.array(photoPathSchema).max(6).default([]),
  /** The form's own random key: a double submit files one case. */
  submissionKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
})
export type CreateCaseBody = z.infer<typeof createCaseSchema>

export const CUSTOMER_COMMANDS = ['provide_info', 'add_return_tracking', 'withdraw', 'appeal', 'customer_message'] as const

export const customerActionSchema = z.object({
  command: z.enum(CUSTOMER_COMMANDS),
  message: z.string().trim().max(4000).optional(),
  body: z.string().trim().max(4000).optional(),
  reason: z.string().trim().max(2000).optional(),
  trackingNumber: z.string().trim().max(64).optional(),
  carrier: z.string().trim().max(60).optional(),
})

/** Staff commands: the command name and its loose inputs; the workflow checks each. */
export const staffActionSchema = z
  .object({
    command: z.string().regex(/^[a-z_]{3,40}$/),
    version: z.number().int().min(0),
  })
  .passthrough()

export const caseNumberSchema = z.string().regex(/^RC-[A-Z0-9]{6,12}$/)
