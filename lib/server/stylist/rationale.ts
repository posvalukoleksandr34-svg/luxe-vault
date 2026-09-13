import 'server-only'

import { FinishReason, GoogleGenAI, ThinkingLevel } from '@google/genai'
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

// ------------------------------------------------------------------- model --

/** The stylist's brief to the model. Unchanged across the provider switch. */
const SYSTEM_PROMPT =
  'You are a fashion stylist writing one or two sentences about an outfit that has ALREADY been chosen. ' +
  'Describe only the pieces given. Never mention a garment that is not in the list, never invent prices, ' +
  'sizes or brands, and never use bullet points. Write plainly, no marketing adjectives.'

/**
 * gemini-3.6-flash — NOT gemini-2.0-flash.
 *
 * 2.0 Flash is retired for generation. Its metadata endpoint still answers
 * 200, which makes it look alive, but generateContent returns 404 "This model
 * models/gemini-2.0-flash is no longer available" (measured 2026-09-13 with
 * this project's key). Because the pass below fails soft by design, pinning
 * it would have silently disabled the model on every single request while
 * appearing to work. GEMINI_MODEL overrides this without a code change.
 */
const DEFAULT_MODEL = 'gemini-3.6-flash'

/** Enough for two sentences; the copy is a caption, not an essay. */
const MAX_OUTPUT_TOKENS = 160
/** The whole stylist response waits on this, so it is capped hard. */
const TIMEOUT_MS = 4000

/** One client per key, created on first use — not per request. */
let client: { key: string; ai: GoogleGenAI } | null = null

function gemini(key: string): GoogleGenAI {
  if (!client || client.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) }
  return client.ai
}

/**
 * Optional model pass, via Google Gemini.
 *
 * Enabled only when GEMINI_API_KEY is set. Deliberately fails soft: any error,
 * timeout or unexpected shape falls back to the composed line, because a look
 * with slightly plainer copy is a working feature and a 500 is not.
 *
 * The model receives ONLY the names, categories, colours and fits already
 * chosen. It is never asked what to recommend.
 */
async function embellish(base: string, look: Look): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return base

  const pieces = look.items.map((i) => ({
    name: Object.values(i.product.name ?? {})[0] ?? i.product.category,
    category: i.product.category,
    colour: i.product.colors[0]?.name ?? null,
    fit: resolveTags(i.product).fit,
  }))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await gemini(key).models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: `Pieces: ${JSON.stringify(pieces)}\n\nA baseline description is: "${base}"\n\nRewrite it as one or two sentences.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // 3.x Flash models reason before answering, and those tokens count
        // against maxOutputTokens. Measured with this exact prompt: default
        // thinking spent 149 of the 160 tokens reasoning and stopped mid-
        // sentence ("An onyx oversized hoodie pairs with sand"). MINIMAL spent
        // none and finished in 1.3s. Describing three chosen garments needs no
        // reasoning, only the cap.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: controller.signal,
      },
    })

    // How the model STOPPED, not just whether it said something: a truncated
    // answer is still non-empty text, and half a sentence under a look is
    // worse than the plain composed one.
    if (res.candidates?.[0]?.finishReason !== FinishReason.STOP) return base
    const text = res.text?.trim()
    return text ? text : base
  } catch (error) {
    // Still soft — but said once in the log. A silent fallback is exactly how
    // a retired model would go unnoticed for months.
    console.warn(
      '[stylist] Gemini copy failed, using composed copy:',
      error instanceof Error ? error.message.slice(0, 200) : error,
    )
    return base
  } finally {
    clearTimeout(timeout)
  }
}

export async function describeLooks(looks: Look[], brief: StylistBrief): Promise<Look[]> {
  return Promise.all(
    looks.map(async (look) => ({ ...look, rationale: await embellish(compose(look, brief), look) })),
  )
}
