import { notFound } from 'next/navigation'
import { localeParam } from '@/lib/locale-routing'

export default function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!localeParam(params.locale)) notFound()
  return <>{children}</>
}
