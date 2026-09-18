import 'server-only'

import { FinishReason, ThinkingLevel } from '@google/genai'
import { STYLIST_OCCASION_LABELS } from '@/lib/i18n'
import { resolveTags } from '@/lib/stylist/tagging'
import type { Look, StylistBrief } from '@/lib/stylist/types'
import type { Product } from '@/lib/types'
import { geminiClient } from '@/lib/server/gemini'

/**
 * The prose under a look.
 *
 * THIS IS THE ONLY PART A LANGUAGE MODEL IS ALLOWED TO TOUCH, and even then it
 * is handed the finished look and asked to describe it. It cannot add, remove
 * or rename a product, because by the time it runs the look is already
 * decided — which is how "recommend only products that exist" is enforced
 * structurally rather than by asking a model nicely.
 *
 * With no model configured, or when it fails, the copy is composed from the
 * look's own attributes — IN THE PAGE'S LANGUAGE. It used to be English
 * whatever the page, which put English sentences under looks on Russian,
 * Italian, French and German pages every time the model was unavailable.
 */

// ---------------------------------------------------------------- language --

/**
 * The site's languages, and the name the model is told to write in.
 *
 * The directive that USES these lives in app/api/stylist/route.ts, where the
 * endpoint's reader will see it; this module only appends it to the prompt.
 */
export const STYLIST_LANGUAGES = {
  ru: 'Russian',
  en: 'English',
  it: 'Italian',
  fr: 'French',
  de: 'German',
} as const

export type StylistLocale = keyof typeof STYLIST_LANGUAGES

export function isStylistLocale(value: unknown): value is StylistLocale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STYLIST_LANGUAGES, value)
}

/**
 * The customer's notes, made safe to place inside <customer_words> tags: they
 * cannot close the tag early and start a section of their own. Exported so
 * the route decides "did the customer write anything" from exactly the text
 * the model will see.
 */
export function customerWords(notes: string | undefined): string {
  return (notes ?? '').replace(/[<>]/g, ' ').trim()
}

/** A product's name in the reader's language, falling back to any it has. */
function nameIn(product: Product, locale: StylistLocale): string {
  const names = (product.name ?? {}) as Partial<Record<StylistLocale, string>>
  return names[locale] || Object.values(names)[0] || product.category
}

// ------------------------------------------------------------ composed copy --

type Silhouette = 'relaxed' | 'lean' | 'clean'

type ComposeCopy = {
  silhouette: Record<Silhouette, string>
  /** The word before the last item of a list: "A, B and C". */
  and: string
  sentence: (parts: {
    silhouette: string
    colours: string
    anchor: string
    rest: string
    occasion: string
  }) => string
}

/**
 * The fallback description, per language.
 *
 * Built from labelled clauses ("Силуэт — свободный, палитра — Onyx") rather
 * than flowing prose, deliberately: the pieces slotted in are catalogue data —
 * product names and colour names in whatever form the admin typed them — and
 * a template that had to decline or agree them ("в свободном силуэте", "с
 * кожаными кедами") would be grammatically wrong for most real products.
 * These read correctly whatever is put in them.
 */
const COMPOSE: Record<StylistLocale, ComposeCopy> = {
  ru: {
    silhouette: { relaxed: 'свободный', lean: 'приталенный', clean: 'чёткий' },
    and: ' и ',
    sentence: ({ silhouette, colours, anchor, rest, occasion }) =>
      `Силуэт — ${silhouette}${colours ? `, палитра — ${colours}` : ''}. ` +
      `В основе — ${anchor}${rest ? `, в дополнение — ${rest}` : ''}.` +
      (occasion ? ` Повод: ${occasion}.` : ''),
  },
  en: {
    silhouette: { relaxed: 'relaxed', lean: 'lean', clean: 'clean' },
    and: ' and ',
    sentence: ({ silhouette, colours, anchor, rest, occasion }) =>
      `A ${silhouette} silhouette${colours ? ` in ${colours}` : ''}. ` +
      `Built on ${anchor}${rest ? `, finished with ${rest}` : ''}.` +
      (occasion ? ` Right for: ${occasion}.` : ''),
  },
  it: {
    silhouette: { relaxed: 'morbida', lean: 'asciutta', clean: 'pulita' },
    and: ' e ',
    sentence: ({ silhouette, colours, anchor, rest, occasion }) =>
      `Silhouette ${silhouette}${colours ? `, palette: ${colours}` : ''}. ` +
      `Alla base ${anchor}${rest ? `, a completare ${rest}` : ''}.` +
      (occasion ? ` Occasione: ${occasion}.` : ''),
  },
  fr: {
    silhouette: { relaxed: 'ample', lean: 'ajustée', clean: 'nette' },
    and: ' et ',
    sentence: ({ silhouette, colours, anchor, rest, occasion }) =>
      `Silhouette ${silhouette}${colours ? `, palette : ${colours}` : ''}. ` +
      `À la base : ${anchor}${rest ? ` ; pour compléter : ${rest}` : ''}.` +
      (occasion ? ` Occasion : ${occasion}.` : ''),
  },
  de: {
    silhouette: { relaxed: 'locker', lean: 'schmal', clean: 'klar' },
    and: ' und ',
    sentence: ({ silhouette, colours, anchor, rest, occasion }) =>
      `Silhouette: ${silhouette}${colours ? `, Farben: ${colours}` : ''}. ` +
      `Im Mittelpunkt: ${anchor}${rest ? `; dazu: ${rest}` : ''}.` +
      (occasion ? ` Anlass: ${occasion}.` : ''),
  },
}

function joinList(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`
}

/** Composes a stylist's line from what the look actually contains, in the
 *  page's language. */
function compose(look: Look, brief: StylistBrief, locale: StylistLocale): string {
  if (!look.items.length) return ''
  const copy = COMPOSE[locale]

  const tags = look.items.map((i) => resolveTags(i.product))
  const silhouette: Silhouette = tags.some((t) => t.fit === 'oversized')
    ? 'relaxed'
    : tags.every((t) => t.fit === 'slim')
      ? 'lean'
      : 'clean'

  // Catalogue colour names, as the admin typed them — they are the shop's own
  // names for its colours ("Onyx"), not words to translate.
  const colours: string[] = []
  for (const item of look.items) {
    const c = item.product.colors[0]?.name
    if (c && colours.indexOf(c) === -1) colours.push(c)
  }

  const names = look.items.map((i) => nameIn(i.product, locale))

  let occasion = ''
  if (brief.occasion && brief.occasion !== 'browsing') {
    const labels = STYLIST_OCCASION_LABELS[brief.occasion] as Partial<Record<StylistLocale, string>>
    const label = labels[locale] ?? ''
    // After a colon the label reads mid-sentence; German keeps its capitals.
    occasion = locale === 'de' ? label : label.charAt(0).toLowerCase() + label.slice(1)
  }

  return copy
    .sentence({
      silhouette: copy.silhouette[silhouette],
      colours: joinList(colours, copy.and),
      anchor: names[0],
      rest: joinList(names.slice(1), copy.and),
      occasion,
    })
    .trim()
}

// ------------------------------------------------------------------- model --

/** The stylist's brief to the model. The language directive from the route is
 *  appended per request, never edited into this. */
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

/**
 * A word repeated three or more times running — "худи худи худи" — which is a
 * decoding loop, not prose. Compares whole words with their punctuation
 * stripped, so "very, very" style emphasis (two) and ordinary sentences never
 * trip it. Plain string work rather than a Unicode regex: the project targets
 * ES5, and this has to understand Cyrillic as well as Latin.
 */
function hasRunawayRepeat(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:!?«»"'()—–-]+/g, ''))
    .filter(Boolean)
  let run = 1
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1
    if (run >= 3) return true
  }
  return false
}


/**
 * Optional model pass, via Google Gemini.
 *
 * Enabled only when GEMINI_API_KEY is set. Deliberately fails soft: any error,
 * timeout or unexpected shape falls back to the composed line — which is in
 * the page's language, so falling back never means falling into English.
 *
 * The model receives ONLY the names, categories, colours and fits already
 * chosen. It is never asked what to recommend.
 */
async function embellish(
  base: string,
  look: Look,
  brief: StylistBrief,
  locale: StylistLocale,
  directive: string,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return base

  const pieces = look.items.map((i) => ({
    name: nameIn(i.product, locale),
    category: i.product.category,
    colour: i.product.colors[0]?.name ?? null,
    fit: resolveTags(i.product).fit,
  }))

  const words = customerWords(brief.notes)
  const contents =
    `Pieces: ${JSON.stringify(pieces)}\n\n` +
    `A baseline description is: "${base}"\n\n` +
    (words ? `<customer_words>${words}</customer_words>\n\n` : '') +
    "Rewrite it as one or two sentences, in the user's language as decided above."

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // Up to two samples inside the one time budget. The second exists for one
    // failure mode, measured on this prompt: asked for Russian, the model
    // looped a word — "Объёмное худи худи худи худи худи худи задаёт форму" —
    // and still reported a clean STOP, so every other check here passed it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await geminiClient(key).models.generateContent({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        contents,
        config: {
          systemInstruction: `${SYSTEM_PROMPT} ${directive}`,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // 3.x Flash models reason before answering, and those tokens count
          // against maxOutputTokens. Measured with this exact prompt: default
          // thinking spent 149 of the 160 tokens reasoning and stopped mid-
          // sentence. MINIMAL spent none and finished in 1.3s. Describing
          // three chosen garments needs no reasoning, only the cap.
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          abortSignal: controller.signal,
        },
      })

      // How the model STOPPED, not just whether it said something: a
      // truncated answer is still non-empty text, and half a sentence under a
      // look is worse than the composed one.
      if (res.candidates?.[0]?.finishReason !== FinishReason.STOP) return base
      const text = res.text?.trim()
      if (!text) return base
      if (!hasRunawayRepeat(text)) return text
    }
    console.warn('[stylist] Gemini copy looped twice, using composed copy.')
    return base
  } catch (error) {
    // Still soft — but said once in the log. A silent fallback is exactly how
    // a retired model, or an exhausted quota, goes unnoticed for months.
    console.warn(
      '[stylist] Gemini copy failed, using composed copy:',
      error instanceof Error ? error.message.slice(0, 200) : error,
    )
    return base
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Describes each look.
 *
 * `directive` is the strict language rule from the stylist route; `locale` is
 * the page's language, used for product names and for the composed fallback.
 */
export async function describeLooks(
  looks: Look[],
  brief: StylistBrief,
  locale: StylistLocale,
  directive: string,
): Promise<Look[]> {
  return Promise.all(
    looks.map(async (look) => ({
      ...look,
      rationale: await embellish(compose(look, brief, locale), look, brief, locale, directive),
    })),
  )
}
