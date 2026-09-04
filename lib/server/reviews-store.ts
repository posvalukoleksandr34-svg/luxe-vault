// Server-only persistence for customer reviews — same lightweight JSON-file
// "database" pattern as lib/server/orders-store.ts (see that file for the
// serverless-deployment caveat, which applies here too).
import { promises as fs } from 'fs'
import path from 'path'
import { SEED_REVIEWS } from '@/lib/data'
import type { Review, ReviewStatus } from '@/lib/types'

const DATA_DIR = path.join(process.cwd(), 'data')
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json')

async function ensureFile(): Promise<void> {
  try {
    await fs.access(REVIEWS_FILE)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(REVIEWS_FILE, JSON.stringify(SEED_REVIEWS, null, 2), 'utf-8')
  }
}

export async function readReviews(): Promise<Review[]> {
  await ensureFile()
  try {
    const raw = await fs.readFile(REVIEWS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeReviews(reviews: Review[]): Promise<void> {
  await ensureFile()
  await fs.writeFile(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf-8')
}

export async function addReview(review: Review): Promise<void> {
  const reviews = await readReviews()
  await writeReviews([review, ...reviews])
}

export async function setReviewStatus(id: string, status: ReviewStatus): Promise<Review | null> {
  const reviews = await readReviews()
  let updated: Review | null = null
  const next = reviews.map((r) => {
    if (r.id !== id) return r
    updated = { ...r, status }
    return updated
  })
  if (updated) await writeReviews(next)
  return updated
}

export async function deleteReview(id: string): Promise<boolean> {
  const reviews = await readReviews()
  const next = reviews.filter((r) => r.id !== id)
  const removed = next.length !== reviews.length
  if (removed) await writeReviews(next)
  return removed
}
