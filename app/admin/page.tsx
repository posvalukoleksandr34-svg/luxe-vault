import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AdminPanel } from '@/components/admin/admin-panel'
import { missingBusinessFields } from '@/config/business'
import { isAdminRequest } from '@/lib/server/admin-guard'
import { burnedAdminCredentials } from '@/lib/server/burned-credentials'

// Never indexed and never linked from the storefront — reachable only by a
// visitor who already holds a valid admin session (see middleware.ts).
export const metadata: Metadata = {
  title: 'Админ-панель',
  robots: { index: false, follow: false },
}

export default async function AdminPage(props: { searchParams: Promise<{ tab?: string }> }) {
  // Second gate behind middleware.ts (lib/server/admin-guard.ts explains why).
  // The panel's data comes from /api/admin, which checks for itself; this
  // keeps the page — and the configuration gaps it lists — from rendering for
  // anyone else if the middleware is ever bypassed or its matcher narrowed.
  if (!(await isAdminRequest())) redirect('/')
  // On the dashboard only: a standing legal to-do, not a banner over every list.
  const { tab } = await props.searchParams
  const missing = !tab || tab === 'dashboard' ? missingBusinessFields() : []
  const burned = !tab || tab === 'dashboard' ? burnedAdminCredentials() : []
  return (
    <>
      {/* A credential still set to a value that is public in the repository's
          history (lib/server/burned-credentials.ts). Names only, never values. */}
      {burned.length > 0 && (
        <div role="alert" className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-foreground">
          <strong className="font-medium">Небезопасные учётные данные админки.</strong>{' '}
          Значение <span className="font-mono text-[12px]">{burned.join(', ')}</span> совпадает со старым, которое
          есть в открытой истории репозитория. Задайте новое в Vercel → Settings → Environment Variables и сделайте
          redeploy; все сессии админки после этого закроются.
        </div>
      )}
      {/* The Imprint shows only what is configured. Until the seller's name
          and address are set it is incomplete — Swiss law (UWG art. 3(1)(s))
          requires them for online sales — so the console says so on every
          visit. Never shown on the storefront. */}
      {missing.length > 0 && (
        <div role="status" className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] text-foreground">
          <strong className="font-medium">Импрессум не заполнен.</strong>{' '}
          Укажите в Vercel → Settings → Environment Variables и сделайте redeploy:{' '}
          <span className="break-all font-mono text-[12px]">{missing.join(', ')}</span>. Подробности — config/business.ts.
        </div>
      )}
      {/* The section shown is read from the address (?tab=). */}
      <AdminPanel />
    </>
  )
}
