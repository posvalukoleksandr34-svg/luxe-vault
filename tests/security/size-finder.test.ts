import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_MATCH, finderRecommendation, finderScore, indexOfSize, type FinderInput, type ShapeLevel } from '@/lib/fit-advisor'

const RUN = ['XS', 'S', 'M', 'L', 'XL']
const all = () => true
const base: FinderInput = { heightCm: 172, weightKg: 66, fit: 0, kind: 'tops' }
const score = (patch: Partial<FinderInput>) => finderScore({ ...base, ...patch }).score

describe('size finder', () => {
  it('an average frame lands on M with a clear majority', () => {
    const r = finderRecommendation(base, RUN, all)
    assert.equal(r.rec.size, 'M')
    assert.equal(r.fit.kind, 'exact')
    assert.equal(r.shares[0].size, 'M')
    assert.ok(r.shares[0].percent >= 50, JSON.stringify(r.shares))
  })

  it('when the run covers the shopper, the chances add up to ~100', () => {
    const r = finderRecommendation(base, RUN, all)
    assert.equal(r.shares.length, RUN.length)
    const sum = r.shares.reduce((a, s) => a + s.percent, 0)
    assert.ok(sum >= 98 && sum <= 102, String(sum))
  })

  it('a run that misses the shopper: short bars and "not made in your size", never 92 %', () => {
    const r = finderRecommendation(base, ['XS', 'S'], all)
    assert.deepEqual(r.fit, { kind: 'none', ideal: 'M', reason: 'not_carried' })
    const sum = r.shares.reduce((a, s) => a + s.percent, 0)
    assert.ok(sum < MIN_MATCH, JSON.stringify(r.shares))
  })

  it('the fit slider moves the size, looser upwards', () => {
    assert.ok(score({ fit: 1 }) > score({ fit: 0 }) && score({ fit: 0 }) > score({ fit: -1 }))
    assert.equal(finderRecommendation({ ...base, fit: 1 }, RUN, all).rec.size, 'L')
  })

  it('hips matter more for trousers, the abdomen more for jackets', () => {
    const hipsTops = score({ hips: 1 }) - score({ hips: 0 })
    const hipsBottoms = finderScore({ ...base, kind: 'bottoms', hips: 1 }).score - finderScore({ ...base, kind: 'bottoms' }).score
    assert.ok(hipsBottoms > hipsTops)
    const bellyTops = score({ abdomen: 1 }) - score({ abdomen: 0 })
    const bellyBottoms = finderScore({ ...base, kind: 'bottoms', abdomen: 1 }).score - finderScore({ ...base, kind: 'bottoms' }).score
    assert.ok(bellyTops > bellyBottoms)
  })

  it('no single self-description moves a whole size', () => {
    for (const patch of [{ hips: 1 as const }, { abdomen: 1 as const }, { age: 70 }, { hips: -1 as const }]) {
      assert.ok(Math.abs(score(patch) - score({})) < 0.5, JSON.stringify(patch))
    }
  })

  it('age only nudges, and skipping it is neutral', () => {
    assert.equal(score({ age: undefined }), score({ age: 30 }))
    assert.ok(score({ age: 60 }) > score({ age: 30 }))
  })

  it('outside the table: no size, and every bar short', () => {
    const r = finderRecommendation({ ...base, heightCm: 160, weightKg: 120 }, RUN, all)
    assert.equal(r.outOfRange, true)
    assert.equal(r.rec.confidence, 'low')
    assert.equal(r.fit.kind, 'none')
    assert.equal(r.fit.kind === 'none' && r.fit.reason, 'range')
    assert.ok(r.shares.every((s) => s.percent < MIN_MATCH), JSON.stringify(r.shares))
  })

  it('squarely an M and M sold out: says so, does not push an L that is unlikely to fit', () => {
    const r = finderRecommendation(base, RUN, (s) => s !== 'M')
    assert.deepEqual(r.fit, { kind: 'none', ideal: 'M', reason: 'sold_out' })
    const m = r.shares.find((s) => s.size === 'M')
    assert.ok(m && !m.available && m.percent >= 50, JSON.stringify(r.shares))
  })

  it('between M and L with M sold out: L, which is itself a likely fit', () => {
    const between = { ...base, weightKg: 68 }
    assert.equal(finderRecommendation(between, RUN, all).rec.size, 'M')
    const r = finderRecommendation(between, RUN, (s) => s !== 'M')
    assert.deepEqual(r.fit, { kind: 'sold_out', size: 'L', ideal: 'M' })
  })

  it('an offered size is always made, buyable and likely; bars are ranked and never exceed 100', () => {
    const runs = [RUN, ['S', 'M', 'L'], ['M'], ['XS', 'S'], ['L', 'XL', 'XXL', 'XXXL'], ['2XL', '3XL']]
    const stock = [all, (s: string) => s !== 'M', (s: string) => s === 'XS' || s === 'XL', () => false]
    let offered = 0
    for (const heightCm of [150, 165, 178, 195])
      for (const weightKg of [45, 58, 72, 90, 115])
        for (const hips of [-1, 0, 1] as ShapeLevel[])
          for (const fit of [-1, 0, 1])
            for (const run of runs)
              for (const ok of stock) {
                const input = { ...base, heightCm, weightKg, hips, abdomen: hips, fit }
                const r = finderRecommendation(input, run, ok)
                const label = JSON.stringify({ input, run, fit: r.fit, shares: r.shares })
                for (let i = 1; i < r.shares.length; i++) assert.ok(r.shares[i - 1].percent >= r.shares[i].percent, label)
                assert.ok(r.shares.reduce((a, s) => a + s.percent, 0) <= 101, label)
                if (r.fit.kind === 'none') continue
                offered++
                const size = r.fit.size
                assert.ok(run.includes(size) && ok(size), label)
                assert.ok((r.shares.find((s) => s.size === size)?.percent ?? 0) >= MIN_MATCH, label)
                if (r.fit.kind === 'exact') assert.equal(indexOfSize(size), indexOfSize(r.rec.size), label)
                else assert.notEqual(indexOfSize(size), indexOfSize(r.rec.size), label)
              }
    assert.ok(offered > 500, String(offered))
  })

  it('only sizes the product makes appear in the shares', () => {
    const r = finderRecommendation(base, ['S', 'M'], all)
    assert.deepEqual(r.shares.map((s) => s.size).sort(), ['M', 'S'])
  })
})
