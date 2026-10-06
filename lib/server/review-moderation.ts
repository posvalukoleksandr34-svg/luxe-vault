import 'server-only'

/**
 * Automatic moderation of product reviews.
 *
 * Every review is already from a verified buyer (migration 0052). This decides
 * only whether it can go live at once or waits for a person:
 *
 *   approve   4–5 stars and nothing below flagged: published immediately.
 *   hold      everything else: stays 'pending' for the admin queue
 *             (Admin → Отзывы о товарах), with the reasons.
 *
 * Held for a person, never rejected automatically: a word list cannot tell an
 * insult from a quotation, or a link from a product code, so the filter only
 * ever decides "publish now" or "a human looks first".
 *
 * Low ratings are held because they are often about delivery rather than the
 * item. The admin should still publish them unless they break the rules: a
 * shop that publishes only the good reviews misleads its customers, and that
 * is unlawful under the EU and Swiss rules on unfair commercial practices.
 */

export type ModerationFlag =
  /** 1–3 stars. */
  | 'low_rating'
  /** An insult or obscenity, in any of the shop's languages (or Russian). */
  | 'profanity'
  /** A web address, email address, phone number or @handle. */
  | 'contact_or_link'
  /** Classic spam vocabulary (casino, pills, "make money"…). */
  | 'spam'
  /** Keyboard mashing, a letter held down, a word repeated, text with no words. */
  | 'gibberish'

export type ModerationResult = {
  decision: 'approve' | 'hold'
  flags: ModerationFlag[]
}

// ---------------------------------------------------------------- words ----
//
// Matched against whole words after normalisation (below), so "cocktail",
// "Dickens" or "computer" are not caught by "cock", "dick" or "pute".
// STEMS match any word that starts with them ("fucking", "Arschlöcher").
// Kept short on purpose: every entry is a word that has no innocent use in a
// review of clothing.

const EXACT_WORDS = [
  // en
  'fuck', 'shit', 'shitty', 'bitch', 'cunt', 'asshole', 'arsehole', 'bastard', 'dick', 'dickhead', 'cock',
  'whore', 'slut', 'wanker', 'twat', 'prick', 'retard', 'retarded', 'nigger', 'nigga', 'faggot', 'fag',
  'bullshit', 'crap', 'piss', 'pissed',
  // it
  'cazzo', 'cazzi', 'merda', 'stronzo', 'stronza', 'stronzi', 'vaffanculo', 'fanculo', 'puttana', 'puttane',
  'troia', 'coglione', 'coglioni', 'minchia', 'porcodio', 'porcamadonna', 'bastardo', 'bastardi', 'frocio',
  'zoccola', 'cagata',
  // fr
  'merde', 'putain', 'connard', 'connasse', 'conne', 'salope', 'encule', 'pute', 'putes', 'nique', 'niquer',
  'batard', 'bordel', 'chier', 'enfoire', 'pd', 'pede',
  // de
  'scheisse', 'scheiss', 'arschloch', 'arsch', 'fotze', 'hurensohn', 'wichser', 'schlampe', 'missgeburt',
  'hure', 'spast', 'kacke', 'verpiss', 'fick', 'ficken',
]

const STEM_WORDS = [
  'fuck', 'motherfuck', 'shithead', 'bitches', 'cunts', 'assholes', 'whores', 'sluts', 'wankers',
  'vaffancul', 'coglion', 'stronz', 'puttan', 'incul', 'sborr',
  'encul', 'connard', 'salop', 'enfoir',
  'scheiss', 'arschloch', 'hurensohn', 'wichs', 'gefick', 'fotzen',
  // ru (Cyrillic)
  'хуй', 'хуе', 'хуё', 'хуя', 'пизд', 'бля', 'ебан', 'ебат', 'ебал', 'ёбан', 'заеб', 'выеб', 'сука', 'суки',
  'мудак', 'мудил', 'пидор', 'пидар', 'говн', 'гандон', 'долбоеб', 'залуп',
]

const SPAM_PHRASES = [
  'casino', 'viagra', 'cialis', 'porn', 'xxx', 'onlyfans', 'escort', 'loan', 'forex',
  'click here', 'clicca qui', 'cliquez ici', 'hier klicken',
  'make money', 'earn money', 'guadagna', 'gagner de l argent', 'geld verdienen',
  'work from home', 'free money', 'buy followers', 'seo service',
]

// ----------------------------------------------------------- normalising ----

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' }

/** Lower case, accents off (é→e, ß→ss), and runs of 3+ of one letter cut to one. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\p{L})\1{2,}/gu, '$1')
}

// The lists go through the same folding as the text, so "хуй" or "ёбан"
// match however the accents and short signs come out.
const EXACT = new Set(EXACT_WORDS.map(fold))
const STEMS = STEM_WORDS.map(fold)

/** Words made only of letters, with digit-for-letter swaps undone inside them ("sh1t"). */
function words(folded: string): string[] {
  return folded
    .split(/[^\p{L}0-9@$]+/u)
    .map((w) => (/\p{L}/u.test(w) ? w.replace(/[0-9@$]/g, (c) => LEET[c] ?? c) : w))
    .filter((w) => /^\p{L}+$/u.test(w))
}

/** "f.u.c.k", "f u c k", "f-u-c-k": single letters strung together with separators. */
function spelledOut(folded: string): string[] {
  const found: string[] = []
  for (const m of Array.from(folded.matchAll(/(?:^|[^\p{L}])((?:\p{L}[\s.\-_*]+){2,}\p{L})(?![\p{L}])/gu))) {
    found.push(m[1].replace(/[^\p{L}]/gu, ''))
  }
  return found
}

function isProfane(word: string): boolean {
  if (EXACT.has(word)) return true
  for (const stem of STEMS) if (word.startsWith(stem)) return true
  return false
}

// --------------------------------------------------------------- checks ----

// Bare domains only for endings that are not also short words after a missing
// space ("perfetto.it", "parfait.De plus" stay out).
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|ru|io|info|biz|xyz|top|shop|store|site|online|link|click|ly|gg|app|ch)\b(?:\/\S*)?/i
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
const HANDLE_RE = /(?:^|\s)@[a-z0-9_.]{3,}/i
const MESSENGER_RE = /\b(?:t\.me|wa\.me)\//i
/** Dates are not phone numbers: 05.10.2026, 5/10/26. Removed before PHONE_RE. */
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g
/** Eight or more digits, allowing the spaces, dots and dashes phone numbers come with. */
const PHONE_RE = /(?:\+|\b)\d(?:[\s.\-/()]*\d){7,}/

const MASHES = ['qwert', 'werty', 'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'zxcv', 'xcvb', 'yxcv', 'azert', 'qsdf', 'wxcv']
const VOWELS = /[aeiouyаеёиоуыэюя]/u

function looksLikeGibberish(comment: string, folded: string, list: string[]): boolean {
  // A key held down: ten or more of one letter in the ORIGINAL text.
  // ("Perfettooooo" is enthusiasm, not nonsense.)
  if (/(\p{L})\1{9,}/iu.test(comment)) return true

  const letters = folded.replace(/[^\p{L}]/gu, '')
  if (letters.length === 0) {
    // Text with no letters at all: digits, symbols, emoji. A rating with a
    // smiley is fine; a line of punctuation is not a review.
    return comment.replace(/[\s\p{Extended_Pictographic}️‍]/gu, '').length > 3
  }
  // Only Latin and Cyrillic are judged below; other scripts pass.
  const latinOrCyrillic = letters.replace(/[^a-zа-яё]/gu, '').length / letters.length
  if (latinOrCyrillic < 0.5) return false

  if (letters.length >= 10 && new Set(letters).size <= 3) return true

  if (MASHES.some((m) => list.some((w) => w.length >= 5 && w.includes(m)))) return true

  // The same word four times running: "good good good good".
  let run = 1
  for (let i = 1; i < list.length; i++) {
    run = list[i] === list[i - 1] ? run + 1 : 1
    if (run >= 4) return true
  }

  // Words that cannot be pronounced. German has long consonant runs
  // ("Herbstschuhe", "Schnitt"), so one such word is allowed; a text made of
  // them is not.
  const scored = list.filter((w) => w.length >= 4)
  if (scored.length === 0) return letters.length >= 6 && !VOWELS.test(letters)
  const bad = scored.filter((w) => !VOWELS.test(w) || /[^aeiouyаеёиоуыэюя\s]{6,}/u.test(w) || vowelShare(w) < 0.12)
  return bad.length >= 2 && bad.length / scored.length >= 0.4
}

function vowelShare(word: string): number {
  let v = 0
  for (const ch of word) if (VOWELS.test(ch)) v++
  return v / word.length
}

/**
 * The decision for one review. Pure: same input, same answer, no I/O.
 */
export function moderateReview(input: { rating: number; comment?: string | null }): ModerationResult {
  const flags: ModerationFlag[] = []
  const comment = (input.comment ?? '').trim()

  if (!(input.rating >= 4)) flags.push('low_rating')

  if (comment) {
    const folded = fold(comment)
    const list = words(folded)

    if (list.some(isProfane) || spelledOut(folded).some(isProfane)) {
      flags.push('profanity')
    }

    if (URL_RE.test(comment) || EMAIL_RE.test(comment) || HANDLE_RE.test(comment) || MESSENGER_RE.test(comment) || PHONE_RE.test(comment.replace(DATE_RE, ' '))) {
      flags.push('contact_or_link')
    }

    const spaced = ` ${folded.replace(/[^\p{L}0-9]+/gu, ' ')} `
    if (SPAM_PHRASES.some((p) => spaced.includes(` ${p} `))) flags.push('spam')

    if (looksLikeGibberish(comment, folded, list)) flags.push('gibberish')
  }

  return { decision: flags.length === 0 ? 'approve' : 'hold', flags }
}
