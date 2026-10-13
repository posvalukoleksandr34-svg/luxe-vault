import 'server-only'

import type { FunctionDeclaration } from '@google/genai'
import { SUPPORT_CATEGORIES, type SupportCategory } from '@/lib/types'
import { SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, cleanText, productIdFrom, type SearchArgs } from './catalog'
import { normalizeOrderNumber } from './orders'

/**
 * The concierge's tools: what the model may ask for, and how every argument
 * it sends is checked before anything runs.
 *
 * All six are READ-ONLY, except offer_human_support, which only shows the
 * customer a pre-filled form they still submit themselves. There is no tool
 * that buys, cancels, refunds, edits an account or touches stock — those stay
 * with the customer's own authorised flows and with the team.
 *
 * The declarations are what the model sees; the validators are what the
 * server believes. A model can send anything (a wrong type, a 50 kB string,
 * a field nobody declared) — validation turns that into a bounded value or a
 * clear error the model can recover from, never into an exception or a query.
 */

export type ToolName =
  | 'search_products'
  | 'get_product'
  | 'compare_products'
  | 'get_order_status'
  | 'list_my_orders'
  | 'offer_human_support'

export const TOOL_NAMES: ToolName[] = [
  'search_products',
  'get_product',
  'compare_products',
  'get_order_status',
  'list_my_orders',
  'offer_human_support',
]

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'search_products',
    description:
      'Search the live catalogue. Returns at most 6 products with name, price in CHF, colours, sizes, stock state and the product page URL. Use for any question about what the shop sells, prices, colours, sizes or availability.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the customer is looking for, in their words (e.g. "cashmere coat", "giacca nera").' },
        category: { type: 'string', description: 'A category or department if the customer named one (e.g. "jackets", "shoes").' },
        color: { type: 'string', description: 'A colour if the customer named one.' },
        size: { type: 'string', description: 'A size if the customer named one (e.g. "M", "42").' },
        max_price_chf: { type: 'number', description: 'Upper budget in CHF.' },
        min_price_chf: { type: 'number', description: 'Lower bound in CHF.' },
        in_stock_only: { type: 'boolean', description: 'Only products that can be bought now.' },
        limit: { type: 'integer', description: 'How many results (1–6, default 4).' },
      },
    },
  },
  {
    name: 'get_product',
    description:
      'One product in detail: description, specifications, sizes and colours with availability when stock is tracked, delivery estimate, size guide, page URL.',
    parametersJsonSchema: {
      type: 'object',
      properties: { product_id: { type: 'string', description: 'The product id from a search result or the page context.' } },
      required: ['product_id'],
    },
  },
  {
    name: 'compare_products',
    description: 'Two or three products side by side, for "which is better / what is the difference".',
    parametersJsonSchema: {
      type: 'object',
      properties: { product_ids: { type: 'array', items: { type: 'string' }, description: '2 or 3 product ids.' } },
      required: ['product_ids'],
    },
  },
  {
    name: 'get_order_status',
    description:
      "One of the customer's own orders by its number: status, payment, items, delivery estimate, tracking, return window.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        order_number: { type: 'string', description: 'The order number as the customer gave it, e.g. LV-7K2M9Q.' },
      },
      required: ['order_number'],
    },
  },
  {
    name: 'list_my_orders',
    description: "The customer's own recent orders (number, date, status, items), newest first.",
  },
  {
    name: 'offer_human_support',
    description:
      'Hand the conversation to the human team: shows the customer a "Write to the team" button opening a request form pre-filled with this summary, which they review and send themselves. Nothing is sent by calling this.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: SUPPORT_CATEGORIES },
        summary: {
          type: 'string',
          description:
            "The customer's request in one to three sentences, written as the customer (first person) in their language, with the order number and the facts already established; they can edit it.",
        },
        order_number: { type: 'string', description: 'The order concerned, if any.' },
      },
      required: ['category', 'summary'],
    },
  },
]

export type ValidArgs =
  | { name: 'search_products'; args: SearchArgs }
  | { name: 'get_product'; args: { productId: string } }
  | { name: 'compare_products'; args: { productIds: string[] } }
  | { name: 'get_order_status'; args: { orderNumber: string } }
  | { name: 'list_my_orders'; args: Record<string, never> }
  | { name: 'offer_human_support'; args: { category: SupportCategory; summary: string; orderNumber?: string } }

export type Invalid = { error: string; hint?: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function optionalText(v: unknown, max: number): string | undefined | Invalid {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') return { error: 'invalid_argument', hint: 'Expected text.' }
  const text = cleanText(v, max)
  return text || undefined
}

function optionalPrice(v: unknown): number | undefined | Invalid {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { error: 'invalid_argument', hint: 'Prices are numbers in CHF.' }
  return n
}

const bad = (x: unknown): x is Invalid => isRecord(x) && typeof x.error === 'string'

/** The tool call, checked. Unknown names, wrong types and out-of-range values
 *  come back as an error object for the model, never as an exception. */
export function validateCall(name: string, raw: unknown): ValidArgs | Invalid {
  const args = isRecord(raw) ? raw : {}
  switch (name) {
    case 'search_products': {
      const query = optionalText(args.query, 100)
      const category = optionalText(args.category, 60)
      const color = optionalText(args.color, 30)
      const size = optionalText(args.size, 12)
      const maxPriceChf = optionalPrice(args.max_price_chf)
      const minPriceChf = optionalPrice(args.min_price_chf)
      for (const v of [query, category, color, size, maxPriceChf, minPriceChf]) if (bad(v)) return v
      if (!query && !category && !color && !size && maxPriceChf === undefined && minPriceChf === undefined) {
        return { error: 'empty_search', hint: 'Give at least a query, category, colour, size or price.' }
      }
      const rawLimit = typeof args.limit === 'number' ? Math.trunc(args.limit) : SEARCH_LIMIT_DEFAULT
      return {
        name,
        args: {
          query: query as string | undefined,
          category: category as string | undefined,
          color: color as string | undefined,
          size: size as string | undefined,
          maxPriceChf: maxPriceChf as number | undefined,
          minPriceChf: minPriceChf as number | undefined,
          inStockOnly: args.in_stock_only === true,
          limit: Math.min(Math.max(rawLimit || SEARCH_LIMIT_DEFAULT, 1), SEARCH_LIMIT_MAX),
        },
      }
    }
    case 'get_product': {
      const id = typeof args.product_id === 'string' ? productIdFrom(args.product_id) : null
      return id ? { name, args: { productId: id } } : { error: 'invalid_product_id' }
    }
    case 'compare_products': {
      const ids = Array.isArray(args.product_ids)
        ? args.product_ids.map((x) => (typeof x === 'string' ? productIdFrom(x) : null)).filter((x): x is string => Boolean(x))
        : []
      const unique = ids.filter((x, i) => ids.indexOf(x) === i).slice(0, 3)
      return unique.length >= 2 ? { name, args: { productIds: unique } } : { error: 'need_two_or_three_products' }
    }
    case 'get_order_status': {
      const number = typeof args.order_number === 'string' ? normalizeOrderNumber(args.order_number) : null
      return number
        ? { name, args: { orderNumber: number } }
        : { error: 'invalid_number', hint: 'Order numbers look like LV-XXXXXX.' }
    }
    case 'list_my_orders':
      return { name, args: {} }
    case 'offer_human_support': {
      const category = SUPPORT_CATEGORIES.indexOf(args.category as SupportCategory) !== -1 ? (args.category as SupportCategory) : 'other'
      const summary = typeof args.summary === 'string' ? cleanText(args.summary, 600) : ''
      const orderNumber = typeof args.order_number === 'string' ? normalizeOrderNumber(args.order_number) ?? undefined : undefined
      return { name, args: { category, summary, ...(orderNumber ? { orderNumber } : {}) } }
    }
    default:
      return { error: 'unknown_tool', hint: `Available tools: ${TOOL_NAMES.join(', ')}.` }
  }
}

export const isInvalid = bad
