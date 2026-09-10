import 'server-only'

import { resolveTags } from '@/lib/stylist/tagging'
import type { Look, StylistBrief } from '@/lib/stylist/types'

/**
 * The prose under a look.
 *
 * THIS IS THE ONLY PART A LANGUAGE MODEL IS ALLOWED TO TOUCH, and even then it
 * is handed the finished look and asked to describe it. It cannot add, remove
 * or rename a product, because by the time it runs the look is already
 * decided — which is how "recommend only products that exist" is enforced
 * structurally rather than by asking a model nicely.
 *
 * With no model configured (the default) the copy is composed from the look's
 * own attributes. That is not a degraded mode: a sentence assembled from the
 * real fits, colours and categories in front of the customer is specific by
 * construction, where a model with no key is simply absent.
 */

const FIT_WORDS: Record<string, string> = {
  oversized: 'relaxed',
  slim: 'lean',
  regular: 'clean',
}

/** Composes a stylist's line from what the look actually contains. */
function compose(look: Look, brief: StylistBrief): string {
  if (!look.items.length) return ''

  const tags = look.items.map((i) => resolveTags(i.product))
  const colours = look.items
    .map((i) => i.product.colors[0]?.name)
    .filter((c): c is string => Boolean(c))

  const uniqueColours: string[] = []
  for (const c of colours) if (uniqueColours.indexOf(c) === -1) uniqueColours.push(c)

  const silhouette = tags.some((t) => t.fit === 'oversized')
    ? 'relaxed'
    : tags.every((t) => t.fit === 'slim')
      ? 'lean'
      : 'clean'

  const palette =
    uniqueColours.length === 1
      ? `a monochrome ${uniqueColours[0].toLowerCase()} palette`
      : uniqueColours.length === 2
        ? `${uniqueColours[0].toLowerCase()} against ${uniqueColours[1].toLowerCase()}`
        : 'a layered palette'

  const lead = `Built around a ${silhouette} silhouette in ${palette}.`

  // The second sentence names the actual pieces and how they balance, so the
  // copy could not be mistaken for generic fashion advice.
  const anchorItem = look.items[0]
  const anchorFit = FIT_WORDS[resolveTags(anchorItem.product).fit] ?? 'clean'
  const rest = look.items.slice(1).map((i) => i.product.category).join(' and ')
  const balance = rest
    ? ` The ${anchorFit} ${anchorItem.product.category} carries the shape and the ${rest} keep it grounded.`
    : ''

  const occasionNote =
    brief.occasion && brief.occasion !== 'browsing'
      ? ` Reads right for ${brief.occasion.replace('_', ' ')}.`
      : ''

  return `${lead}${balance}${occasionNote}`.trim()
}

/**
 * Optional model pass.
 *
 * Enabled only when STYLIST_LLM_API_KEY is set. Deliberately fails soft: any
 * error, timeout or unexpected shape falls back to the composed line, because
 * a look with slightly plainer copy is a working feature and a 500 is not.
 *
 * The model receives ONLY the names, categories, colours and fits already
 * chosen. It is never asked what to recommend.
 */
async function embellish(base: string, look: Look): Promise<string> {
  const key = process.env.STYLIST_LLM_API_KEY
  if (!key) return base

  const pieces = look.items.map((i) => ({
    name: Object.values(i.product.name ?? {})[0] ?? i.product.category,
    category: i.product.category,
    colour: i.product.colors[0]?.name ?? null,
    fit: resolveTags(i.product).fit,
  }))

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.STYLIST_LLM_MODEL || 'claude-sonnet-5',
        max_tokens: 160,
        system:
          'You are a fashion stylist writing one or two sentences about an outfit that has ALREADY been chosen. ' +
          'Describe only the pieces given. Never mention a garment that is not in the list, never invent prices, ' +
          'sizes or brands, and never use bullet points. Write plainly, no marketing adjectives.',
        messages: [
          {
            role: 'user',
            content: `Pieces: ${JSON.stringify(pieces)}\n\nA baseline description is: "${base}"\n\nRewrite it as one or two sentences.`,
          },
        ],
      }),
    })
    clearTimeout(timeout)
    if (!res.ok) return base
    const data = await res.json()
    const text = data?.content?.[0]?.text
    return typeof text === 'string' && text.trim() ? text.trim() : base
  } catch {
    return base
  }
}

export async function describeLooks(looks: Look[], brief: StylistBrief): Promise<Look[]> {
  return Promise.all(
    looks.map(async (look) => ({ ...look, rationale: await embellish(compose(look, brief), look) })),
  )
}
