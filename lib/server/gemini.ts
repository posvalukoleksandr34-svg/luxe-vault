import 'server-only'

import { GoogleGenAI } from '@google/genai'

/**
 * One Gemini client per API key, created on first use and shared by every
 * feature that calls the model (smart search, the stylist's rationale,
 * catalogue translation) — not one per request, and not one per module.
 * A rotated key simply gets a new client.
 */
let client: { key: string; ai: GoogleGenAI } | null = null

export function geminiClient(key: string): GoogleGenAI {
  if (!client || client.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) }
  return client.ai
}
