'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { FULFILMENT, describeBusinessDays } from '@/lib/fulfilment'
import { fill } from '@/lib/support/copy'
import type { FaqEntry } from '@/lib/support/faq'
import { formatPrice, useStore } from '@/lib/store'

/**
 * The live figures an FAQ answer may quote — the same set the help centre
 * fills (components/support/support-center.tsx), from the admin's settings
 * and lib/fulfilment.ts.
 */
export function useFaqVars() {
  const { locale, shipping } = useStore()
  return {
    span: describeBusinessDays(shipping.deliveryTimeframe, locale),
    price: formatPrice(shipping.shippingPrice, true),
    amount: formatPrice(shipping.freeShippingThreshold),
    returnDays: FULFILMENT.returnWindowDays,
    refund: describeBusinessDays(FULFILMENT.refund, locale),
    reply: describeBusinessDays(FULFILMENT.supportReply, locale, { genitive: true }),
  }
}

/** Questions as an accordion: any number open at once, each one its own
 *  button with the answer in a labelled region (Radix). */
export function FaqAccordion({ entries }: { entries: FaqEntry[] }) {
  const { locale } = useStore()
  const vars = useFaqVars()
  return (
    <Accordion type="multiple" className="border-t border-border/60">
      {entries.map((e) => (
        <AccordionItem key={e.id} value={e.id} className="border-border/60">
          <AccordionTrigger className="min-h-[56px] gap-4 py-4 text-left text-[15px] font-normal text-foreground hover:no-underline [&>svg]:text-gold">
            {e.q[locale]}
          </AccordionTrigger>
          <AccordionContent className="max-w-2xl pr-8 text-[14px] font-light leading-relaxed text-foreground/75">
            {fill(e.a[locale], vars)}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
