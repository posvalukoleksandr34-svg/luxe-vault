import 'server-only'

import { missingBusinessFields } from '@/config/business'
import {
  judgeWorkflowRuns,
  sortChecks,
  stripeKeyMode,
  type ReadinessCheck,
  type WorkflowRun,
} from '@/lib/launch-readiness'
import { totpMode } from '@/lib/server/admin-totp'
import { burnedAdminCredentials } from '@/lib/server/burned-credentials'
import { listingSupported } from '@/lib/server/catalog-store'
import { isMailConfigured } from '@/lib/server/mailer'
import { isCheckoutReady as isCryptoReady, isConfigured as isCryptoKeySet } from '@/lib/server/nowpayments'
import { salesGate } from '@/lib/server/sales-gate'
import { isStripeWebhookConfigured } from '@/lib/server/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { isTelegramConfigured } from '@/lib/telegram'

/**
 * Everything /admin/launch shows, gathered on each visit. Every probe is its
 * own try: one failing read makes that line 'unknown', never the page.
 * Nothing here prints a secret — only whether one is set, and for Stripe the
 * key's documented mode prefix.
 */

/** The public repository whose Actions runs are the backup record. */
const STATUS_REPO = process.env.BACKUP_STATUS_REPO?.trim() || 'posvalukoleksandr34-svg/luxe-vault'

async function workflowRuns(file: string): Promise<WorkflowRun[] | null> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'luxe-vault-console' }
    const token = process.env.BACKUP_STATUS_GITHUB_TOKEN?.trim()
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(
      `https://api.github.com/repos/${STATUS_REPO}/actions/workflows/${file}/runs?branch=main&per_page=30`,
      // Cached ten minutes: the unauthenticated API allows 60 calls an hour.
      { headers, signal: AbortSignal.timeout(5000), next: { revalidate: 600 } },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { workflow_runs?: WorkflowRun[] }
    return Array.isArray(data.workflow_runs) ? data.workflow_runs : null
  } catch {
    return null
  }
}

function when(ms: number | null): string {
  return ms === null ? 'никогда' : new Date(ms).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' })
}

type Probe = { error: { code?: string; message?: string } | null; count?: number | null }

async function tableExists(run: () => PromiseLike<Probe>): Promise<boolean | null> {
  try {
    const { error } = await run()
    if (!error) return true
    if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || /does not exist|Could not find/i.test(error.message ?? '')) {
      return false
    }
    return null
  } catch {
    return null
  }
}

async function headCount(run: () => PromiseLike<Probe>): Promise<number | null> {
  try {
    const { count, error } = await run()
    return error ? null : (count ?? 0)
  } catch {
    return null
  }
}

export async function loadLaunchReadiness(): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = []

  // ------------------------------------------------------------- sales --
  const gate = salesGate()
  checks.push({
    id: 'sales-gate',
    area: 'sales',
    title: 'Приём заказов и оплат',
    status: gate.open ? (gate.enforced ? 'ok' : 'warning') : 'blocked',
    detail: gate.open
      ? gate.enforced
        ? 'Магазин принимает новые заказы и платежи (SALES_ENABLED=true, реквизиты продавца заполнены).'
        : 'Сборка не production: шлюз продаж не применяется.'
      : `Новые заказы и платежи отклоняются: ${[
          gate.blockers.includes('not_enabled') ? 'SALES_ENABLED не равен "true"' : '',
          gate.blockers.includes('seller_identity') ? 'не заполнены реквизиты продавца' : '',
        ]
          .filter(Boolean)
          .join('; ')}. Оплаченные заказы, вебхуки, возвраты и сверка работают как обычно.`,
    action: gate.open
      ? undefined
      : 'Откройте продажи только после всех пунктов OWNER_APPROVAL_CHECKLIST.md: Vercel → Settings → Environment Variables → SALES_ENABLED=true, затем redeploy.',
    ref: 'OA-24',
  })

  const missing = missingBusinessFields()
  checks.push({
    id: 'seller-identity',
    area: 'legal',
    title: 'Реквизиты продавца (импрессум)',
    status: missing.length === 0 ? 'ok' : 'blocked',
    detail:
      missing.length === 0
        ? 'Имя и почтовый адрес продавца заданы и показаны на /legal/imprint.'
        : `Не заданы: ${missing.join(', ')}. Швейцарский закон (UWG ст. 3(1)(s)) требует их для онлайн-продаж.`,
    action: missing.length === 0 ? undefined : 'Vercel → Environment Variables (все окружения), реальные данные продавца, затем redeploy.',
    ref: 'OA-23',
  })

  // ---------------------------------------------------------- security --
  const mfa = totpMode()
  checks.push({
    id: 'admin-mfa',
    area: 'security',
    title: 'Второй фактор входа в админку (TOTP)',
    status: mfa === 'ready' ? 'ok' : 'blocked',
    detail:
      mfa === 'ready'
        ? 'ADMIN_TOTP_SECRET задан: вход требует код из приложения-аутентификатора.'
        : mfa === 'invalid'
          ? 'ADMIN_TOTP_SECRET задан, но не является корректным base32-ключом — вход отклоняется.'
          : 'ADMIN_TOTP_SECRET не задан: вход в админку только по паролю.',
    action: mfa === 'ready' ? undefined : 'node scripts/admin-totp-setup.mjs на своём компьютере → Vercel → ADMIN_TOTP_SECRET → redeploy. Запишите процедуру восстановления.',
    ref: 'OA-05',
  })

  const burned = burnedAdminCredentials()
  checks.push({
    id: 'burned-credentials',
    area: 'security',
    title: 'Учётные данные админки из открытой истории git',
    status: burned.length === 0 ? 'ok' : 'blocked',
    detail:
      burned.length === 0
        ? 'ADMIN_PASSWORD и ADMIN_SESSION_SECRET не совпадают с опубликованными значениями (сравнение по SHA-256). Другие секреты эта проверка не видит.'
        : `Совпадает с опубликованным значением: ${burned.join(', ')}.`,
    action: burned.length === 0 ? undefined : 'Задайте новые значения в Vercel и сделайте redeploy (все сессии админки закроются).',
    ref: 'OA-04',
  })

  // ---------------------------------------------------------- payments --
  const stripeMode = stripeKeyMode(process.env.STRIPE_SECRET_KEY)
  const webhook = isStripeWebhookConfigured()
  checks.push({
    id: 'stripe',
    area: 'payments',
    title: 'Оплата картой (Stripe)',
    status: stripeMode === 'missing' || !webhook ? 'blocked' : stripeMode === 'unrecognised' ? 'warning' : 'ok',
    detail: [
      stripeMode === 'missing' ? 'Секретный ключ не задан.' : `Ключ: режим ${stripeMode === 'live' ? 'live (настоящие платежи)' : stripeMode === 'test' ? 'test' : 'не распознан'}.`,
      webhook ? 'Секрет вебхука задан.' : 'Секрет вебхука НЕ задан — оплата картой не предлагается.',
    ].join(' '),
    action:
      stripeMode === 'missing' || !webhook
        ? 'Vercel → STRIPE_SECRET_KEY и STRIPE_WEBHOOK_SECRET; в Stripe проверьте подписку вебхука на все события (OA-08).'
        : 'Подписка вебхука на события проверяется только в Stripe Dashboard (OA-08).',
    ref: 'OA-08',
  })

  checks.push({
    id: 'crypto',
    area: 'payments',
    title: 'Оплата криптовалютой (NOWPayments)',
    status: isCryptoReady() ? 'ok' : isCryptoKeySet() ? 'blocked' : 'warning',
    detail: isCryptoReady()
      ? 'API-ключ и IPN-секрет заданы: криптооплата предлагается.'
      : isCryptoKeySet()
        ? 'API-ключ задан, а IPN-секрет нет: подтверждения платежей отклонялись бы. Криптооплата НЕ предлагается.'
        : 'Не настроена: криптооплата не предлагается покупателям.',
    action: isCryptoReady() ? undefined : 'Если криптооплата нужна: NOWPAYMENTS_API_KEY и NOWPAYMENTS_IPN_SECRET в Vercel и одна тестовая оплата (OA-16).',
    ref: 'OA-16',
  })

  // ---------------------------------------------------------- database --
  const db = createAdminClient()
  const migrations: [string, string, Promise<boolean | null>, 'blocked' | 'warning'][] = [
    ['0061', 'один заказ на попытку оформления', tableExists(() => db.from('order_idempotency').select('*', { head: true }).limit(1)), 'warning'],
    ['0062', 'публикация и права на продажу', listingSupported().then((v) => v).catch(() => null), 'blocked'],
    ['0063', 'история цен', tableExists(() => db.from('product_price_history').select('*', { head: true }).limit(1)), 'warning'],
    ['0064', 'описания разделов', tableExists(() => db.from('collections').select('description').limit(1)), 'warning'],
    ['0065', 'журнал публикации', tableExists(() => db.from('product_listing_events').select('*', { head: true }).limit(1)), 'warning'],
  ]
  for (const [id, label, probe, severity] of migrations) {
    const present = await probe
    checks.push({
      id: `migration-${id}`,
      area: 'database',
      title: `Миграция ${id}: ${label}`,
      status: present === true ? 'ok' : present === false ? severity : 'unknown',
      detail: present === true ? 'Применена.' : present === false ? 'Не применена.' : 'Не удалось проверить.',
      action:
        present === true
          ? undefined
          : `Только с вашего согласия: Supabase → SQL Editor → supabase/migrations/${id}_*.sql, затем scripts/security/verify-production.sql.`,
      ref: 'OA-11',
    })
  }

  // --------------------------------------------------------- catalogue --
  const [published, drafts, withdrawn] = await Promise.all([
    headCount(() => db.from('products').select('id', { count: 'exact', head: true }).eq('listing_status', 'published')),
    headCount(() => db.from('products').select('id', { count: 'exact', head: true }).eq('listing_status', 'draft')),
    headCount(() => db.from('products').select('id', { count: 'exact', head: true }).eq('listing_status', 'withdrawn')),
  ])
  checks.push({
    id: 'catalogue',
    area: 'catalogue',
    title: 'Товары в продаже',
    status: published === null ? 'unknown' : published > 0 ? 'ok' : 'warning',
    detail:
      published === null
        ? 'Не удалось посчитать (нет миграции 0062 или ошибка чтения).'
        : `В продаже: ${published}; черновиков: ${drafts ?? '—'}; снято: ${withdrawn ?? '—'}. Публикуется только товар с записью о правах (собственный дизайн или авторизованная перепродажа).`,
    action: 'Админка → Товары → «Продажа». Публикуйте только то, на что у вас есть документ (OA-20).',
    ref: 'OA-20',
  })

  // ------------------------------------------------------------ orders --
  const ceiling = new Date(Date.now() - 72 * 3_600_000).toISOString()
  const stale = await headCount(() =>
    db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('payment_status', ['pending_payment', 'confirming'])
      .neq('status', 'cancelled')
      .lt('created_at', ceiling),
  )
  checks.push({
    id: 'stuck-payments',
    area: 'payments',
    title: 'Неоплаченные заказы старше 72 часов',
    status: stale === null ? 'unknown' : stale === 0 ? 'ok' : 'blocked',
    detail:
      stale === null
        ? 'Не удалось посчитать.'
        : stale === 0
          ? 'Таких заказов нет.'
          : `${stale} шт. Очистка резервов их не отменяет — значит, у их платежа в Stripe статус «выполнен» или «в обработке», а заказ не отмечен оплаченным.`,
    action: stale ? 'Продажи → Сверка платежей: решение по каждому заказу после проверки в Stripe (OA-03). Ничего не помечается оплаченным автоматически.' : undefined,
    ref: 'OA-03',
  })

  // ----------------------------------------------------------- backups --
  const [backupRuns, restoreRuns] = await Promise.all([workflowRuns('offsite-backup.yml'), workflowRuns('backup-restore-test.yml')])
  for (const [id, title, runs, hours, ref] of [
    ['backup', 'Офсайт-бэкап (ежедневный)', backupRuns, 36, 'OA-06'],
    ['restore-test', 'Проверка восстановления из бэкапа (еженедельная)', restoreRuns, 8 * 24 + 12, 'OA-06'],
  ] as const) {
    if (runs === null) {
      checks.push({
        id,
        area: 'backups',
        title,
        status: 'unknown',
        detail: 'Не удалось прочитать историю запусков в GitHub Actions.',
        action: 'GitHub → Actions → проверьте последние запуски вручную.',
        ref,
      })
      continue
    }
    const v = judgeWorkflowRuns(runs, hours)
    checks.push({
      id,
      area: 'backups',
      title,
      status: v.status,
      detail: `Последний успешный запуск: ${when(v.lastSuccessAt)}. Последний запуск: ${when(v.lastRunAt)} (${v.lastConclusion ?? '—'}). Успешный запуск бэкапа ещё не доказывает восстановимость — для этого нужен успешный тест восстановления.`,
      action: v.status === 'ok' ? undefined : 'docs/security/phase-1-backups.md: бакет, ключи, окружение `backups` в GitHub; затем запуск обоих workflow вручную.',
      ref,
    })
  }

  // -------------------------------------------------------- operations --
  checks.push({
    id: 'cron',
    area: 'operations',
    title: 'Плановые задачи (крон)',
    status: process.env.CRON_SECRET?.trim() ? 'ok' : 'blocked',
    detail: process.env.CRON_SECRET?.trim()
      ? 'CRON_SECRET задан. Расписание GitHub на деле срабатывает раз в 3–6 часов, а не ежечасно.'
      : 'CRON_SECRET не задан: снятие резервов, напоминания и проверки возвратов не выполняются.',
    action: 'Решение о расписании — OA-10.',
    ref: 'OA-10',
  })
  checks.push({
    id: 'alerts',
    area: 'operations',
    title: 'Оповещения (Telegram) и почта',
    status: isTelegramConfigured() && isMailConfigured ? 'ok' : 'blocked',
    detail: `Telegram: ${isTelegramConfigured() ? 'настроен' : 'НЕ настроен'}. Почта (Resend): ${isMailConfigured ? 'настроена' : 'НЕ настроена'}. INTERNAL_API_SECRET в приложении: ${process.env.INTERNAL_API_SECRET?.trim() ? 'задан' : 'не задан'} (тот же секрет нужен в GitHub, иначе о сбоях бэкапа сообщает только GitHub).`,
    action: 'Vercel и GitHub → Secrets: INTERNAL_API_SECRET с одинаковым значением (OA-10).',
    ref: 'OA-10',
  })

  // -------------------------------------- what only the owner can settle --
  const ownerItems: [string, ReadinessCheck['area'], string, string, string][] = [
    [
      'legal-catalogue',
      'legal',
      'Законность ассортимента и тексты о «репликах»',
      'Условия, импрессум, подвал и теги карточек называют товары «репликами», а опубликовать товар можно только как собственный дизайн или авторизованную перепродажу. Одно из двух неверно для каждого опубликованного товара.',
      'OA-01',
    ],
    [
      'business-model',
      'legal',
      'Модель бизнеса в юридических текстах',
      'Условия описывают «частную продажу из личной коллекции, упаковка вручную», а расчёт сроков доставки закладывает 20–35 дней на заказ у поставщика. Это нужно привести к фактической модели с юристом.',
      'OA-25',
    ],
    ['provider-acceptance', 'payments', 'Согласие Stripe / NOWPayments на этот бизнес и товары', 'Приложение не может это проверить.', 'OA-02'],
    ['tax', 'legal', 'НДС и налоги (Швейцария / ЕС)', 'Приложение не может это проверить; цены и счета не показывают НДС.', 'OA-26'],
    ['hosting', 'operations', 'Тариф хостинга допускает коммерческое использование', 'Приложение не может это проверить.', 'OA-17'],
    ['branch-protection', 'security', 'Защита ветки main и обязательный CI', 'Приложение не может это проверить.', 'OA-13'],
  ]
  for (const [id, area, title, detail, ref] of ownerItems) {
    checks.push({ id, area, title, status: 'owner', detail, action: 'См. OWNER_APPROVAL_CHECKLIST.md.', ref })
  }

  return sortChecks(checks)
}
