import type { Metadata } from 'next'
import { AdminPanel } from '@/components/admin/admin-panel'
import { missingBusinessFields } from '@/config/business'

// Never indexed and never linked from the storefront — reachable only by a
// visitor who already holds a valid admin session (see middleware.ts).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  const missing = missingBusinessFields()
  return (
    <>
      {/* The Imprint shows only what is configured. Until the seller's name
          and address are set it is incomplete — Swiss law (UWG art. 3(1)(s))
          requires them for online sales — so the console says so on every
          visit. Never shown on the storefront. */}
      {missing.length > 0 && (
        <div role="status" className="border-b border-gold/40 bg-gold/10 px-4 py-3 text-[13px] text-foreground sm:px-6">
          <strong className="font-medium">Импрессум не заполнен.</strong>{' '}
          Укажите в Vercel → Settings → Environment Variables и сделайте redeploy:{' '}
          <span className="font-mono text-[12px]">{missing.join(', ')}</span>. Подробности — config/business.ts.
        </div>
      )}
      <AdminPanel />
    </>
  )
}
