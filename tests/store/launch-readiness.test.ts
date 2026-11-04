import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { judgeWorkflowRuns, sortChecks, stripeKeyMode, summarise, type ReadinessCheck } from '@/lib/launch-readiness'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const run = (at: string, conclusion: string | null, status = 'completed') => ({ status, conclusion, created_at: at })

describe('backup workflow judgement', () => {
  it('a run that never succeeded is blocked, whatever ran', () => {
    const v = judgeWorkflowRuns(
      [run('2026-11-04T09:49:43Z', 'failure'), run('2026-11-03T10:02:14Z', 'failure')],
      36,
      NOW,
    )
    assert.equal(v.status, 'blocked')
    assert.equal(v.lastSuccessAt, null)
    assert.equal(v.lastConclusion, 'failure')
    assert.equal(v.lastRunAt, Date.parse('2026-11-04T09:49:43Z'))
  })

  it('a recent success is ok even if a later run is still in progress', () => {
    const v = judgeWorkflowRuns(
      [run('2026-11-04T11:50:00Z', null, 'in_progress'), run('2026-11-03T10:00:00Z', 'success')],
      36,
      NOW,
    )
    assert.equal(v.status, 'ok')
    assert.equal(v.lastSuccessAt, Date.parse('2026-11-03T10:00:00Z'))
  })

  it('an old success is not a backup now', () => {
    const v = judgeWorkflowRuns([run('2026-10-30T10:00:00Z', 'success')], 36, NOW)
    assert.equal(v.status, 'blocked')
  })

  it('no runs at all is blocked', () => {
    assert.equal(judgeWorkflowRuns([], 36, NOW).status, 'blocked')
  })

  it('a newer failure after a fresh success keeps it ok but reports the failure', () => {
    const v = judgeWorkflowRuns([run('2026-11-04T10:00:00Z', 'failure'), run('2026-11-04T01:00:00Z', 'success')], 36, NOW)
    assert.equal(v.status, 'ok')
    assert.equal(v.lastConclusion, 'failure')
  })
})

describe('Stripe key mode', () => {
  it('reads the documented prefixes only', () => {
    assert.equal(stripeKeyMode('sk_live_abc'), 'live')
    assert.equal(stripeKeyMode('rk_live_abc'), 'live')
    assert.equal(stripeKeyMode('sk_test_abc'), 'test')
    assert.equal(stripeKeyMode(''), 'missing')
    assert.equal(stripeKeyMode(undefined), 'missing')
    assert.equal(stripeKeyMode('pk_live_abc'), 'unrecognised')
  })
})

describe('ordering and totals', () => {
  const c = (id: string, status: ReadinessCheck['status']): ReadinessCheck => ({ id, status, area: 'sales', title: id, detail: '' })
  it('lists what blocks first, keeping the original order within a status', () => {
    const sorted = sortChecks([c('a', 'ok'), c('b', 'blocked'), c('c', 'owner'), c('d', 'blocked'), c('e', 'unknown')])
    assert.deepEqual(sorted.map((x) => x.id), ['b', 'd', 'e', 'c', 'a'])
  })
  it('counts each status', () => {
    assert.deepEqual(summarise([c('a', 'ok'), c('b', 'blocked'), c('c', 'blocked')]), {
      ok: 1,
      blocked: 2,
      warning: 0,
      unknown: 0,
      owner: 0,
    })
  })
})
