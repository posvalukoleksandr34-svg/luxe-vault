import 'server-only'

import type { EmailLang } from './copy'
import { L, SANS, esc, paragraphSection, renderEmail, textEmail, type RenderedEmail } from './layout'

/**
 * "How was your purchase?" — the post-delivery review request
 * (lib/server/review-requests/worker.ts).
 *
 * Honest by construction: it asks for an honest review whatever the
 * experience was, offers nothing in return, invents no urgency, and names
 * only what the order really contained. It carries no address, no amount, no
 * tracking and no admin link — only the products' names and a link that
 * works for this one order (lib/server/review-requests/tokens.ts).
 *
 * Prompted mail, so it says why it arrived and has an unsubscribe link (also
 * sent as a List-Unsubscribe header by the worker).
 */

type Copy = {
  subject: string
  preheader: string
  heading: string
  greeting: (name: string) => string
  greetingNoName: string
  thanks: string
  ask: string
  products: string
  andMore: (n: number) => string
  button: string
  fallback: string
  signoff: string
  team: string
  why: string
  unsubscribe: string
}

const COPY: Record<EmailLang, Copy> = {
  en: {
    subject: 'How was your recent purchase?',
    preheader: 'Tell us what you think — it takes a minute.',
    heading: 'How was your purchase?',
    greeting: (n) => `Hi ${n},`,
    greetingNoName: 'Hello,',
    thanks: 'We hope you are enjoying your recent purchase from Luxe Vault.',
    ask: 'When you have a moment, we would like to hear what you think. Your honest feedback, good or bad, helps us improve and helps other customers decide.',
    products: 'Your order',
    andMore: (n) => `and ${n} more`,
    button: 'Leave a review',
    fallback: 'If the button does not work, copy this link into your browser:',
    signoff: 'Thank you for shopping with us.',
    team: 'The Luxe Vault team',
    why: 'You are receiving this because your order was delivered.',
    unsubscribe: 'Do not send me review requests',
  },
  ru: {
    subject: 'Как вам ваша покупка?',
    preheader: 'Расскажите, что думаете, — это займёт минуту.',
    heading: 'Как вам покупка?',
    greeting: (n) => `Здравствуйте, ${n}!`,
    greetingNoName: 'Здравствуйте!',
    thanks: 'Надеемся, вам нравится ваша недавняя покупка в Luxe Vault.',
    ask: 'Если найдётся минута, расскажите, что вы думаете. Честный отзыв — хороший или плохой — помогает нам стать лучше, а другим покупателям сделать выбор.',
    products: 'Ваш заказ',
    andMore: (n) => `и ещё ${n}`,
    button: 'Оставить отзыв',
    fallback: 'Если кнопка не работает, скопируйте ссылку в браузер:',
    signoff: 'Спасибо, что выбрали нас.',
    team: 'Команда Luxe Vault',
    why: 'Вы получили это письмо, потому что ваш заказ доставлен.',
    unsubscribe: 'Не присылать просьбы об отзывах',
  },
  it: {
    subject: 'Com’è andato il tuo acquisto?',
    preheader: 'Raccontaci cosa ne pensi: basta un minuto.',
    heading: 'Com’è andato il tuo acquisto?',
    greeting: (n) => `Ciao ${n},`,
    greetingNoName: 'Ciao,',
    thanks: 'Speriamo che il tuo recente acquisto da Luxe Vault ti stia piacendo.',
    ask: 'Quando hai un momento, ci farebbe piacere sapere cosa ne pensi. Un’opinione sincera, positiva o negativa, ci aiuta a migliorare e aiuta gli altri clienti a scegliere.',
    products: 'Il tuo ordine',
    andMore: (n) => `e altri ${n}`,
    button: 'Lascia una recensione',
    fallback: 'Se il pulsante non funziona, copia questo link nel browser:',
    signoff: 'Grazie per aver acquistato da noi.',
    team: 'Il team Luxe Vault',
    why: 'Ricevi questa email perché il tuo ordine è stato consegnato.',
    unsubscribe: 'Non inviarmi richieste di recensione',
  },
  fr: {
    subject: 'Comment s’est passé votre achat ?',
    preheader: 'Dites-nous ce que vous en pensez — une minute suffit.',
    heading: 'Comment s’est passé votre achat ?',
    greeting: (n) => `Bonjour ${n},`,
    greetingNoName: 'Bonjour,',
    thanks: 'Nous espérons que votre récent achat chez Luxe Vault vous plaît.',
    ask: 'Quand vous aurez un moment, nous aimerions connaître votre avis. Un avis sincère, positif ou négatif, nous aide à nous améliorer et aide les autres clients à choisir.',
    products: 'Votre commande',
    andMore: (n) => `et ${n} autre(s)`,
    button: 'Laisser un avis',
    fallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    signoff: 'Merci de vos achats chez nous.',
    team: 'L’équipe Luxe Vault',
    why: 'Vous recevez cet e-mail parce que votre commande a été livrée.',
    unsubscribe: 'Ne plus m’envoyer de demandes d’avis',
  },
  de: {
    subject: 'Wie gefällt Ihnen Ihr Kauf?',
    preheader: 'Sagen Sie uns Ihre Meinung – es dauert eine Minute.',
    heading: 'Wie gefällt Ihnen Ihr Kauf?',
    greeting: (n) => `Hallo ${n},`,
    greetingNoName: 'Hallo,',
    thanks: 'Wir hoffen, Ihr Einkauf bei Luxe Vault gefällt Ihnen.',
    ask: 'Wenn Sie einen Moment Zeit haben, würden wir gern Ihre Meinung hören. Eine ehrliche Bewertung – gut oder schlecht – hilft uns, besser zu werden, und anderen Kunden bei der Wahl.',
    products: 'Ihre Bestellung',
    andMore: (n) => `und ${n} weitere`,
    button: 'Bewertung schreiben',
    fallback: 'Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
    signoff: 'Danke für Ihren Einkauf bei uns.',
    team: 'Ihr Luxe Vault Team',
    why: 'Sie erhalten diese E-Mail, weil Ihre Bestellung zugestellt wurde.',
    unsubscribe: 'Keine Bewertungsanfragen mehr senden',
  },
}

export type ReviewRequestEmailInput = {
  lang: EmailLang
  /** The customer's first name as they gave it at checkout; omitted when unknown. */
  firstName?: string | null
  /** Product names from the order (unique, in order). */
  productNames: string[]
  reviewUrl: string
  unsubscribeUrl: string
}

const SHOWN = 3

/** A name fit for a greeting: one line, no markup-looking characters, sane length. */
function greetingName(raw: string | null | undefined): string | null {
  const v = (raw ?? '').replace(/[\r\n<>]/g, ' ').trim().split(/\s+/)[0] ?? ''
  return v.length >= 1 && v.length <= 40 ? v : null
}

export function reviewRequestEmail(input: ReviewRequestEmailInput): RenderedEmail {
  const c = COPY[input.lang] ?? COPY.en
  const name = greetingName(input.firstName)
  const greeting = name ? c.greeting(name) : c.greetingNoName
  const shown = input.productNames.slice(0, SHOWN)
  const more = input.productNames.length - shown.length

  const productList = `
    <tr>
      <td class="lv-pad" style="padding:22px 36px 0 36px;">
        <p style="margin:0 0 6px 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${L.muted};">${esc(c.products)}</p>
        ${shown
          .map((n) => `<p style="margin:0; padding:8px 0; border-bottom:1px solid ${L.border}; font-family:${SANS}; font-size:14px; line-height:20px; color:${L.strong};">${esc(n)}</p>`)
          .join('')}
        ${more > 0 ? `<p style="margin:8px 0 0 0; font-family:${SANS}; font-size:13px; color:${L.muted};">${esc(c.andMore(more))}</p>` : ''}
      </td>
    </tr>`

  const fallback = `
    <tr>
      <td class="lv-pad" style="padding:18px 36px 0 36px;">
        <p style="margin:0; font-family:${SANS}; font-size:12px; line-height:19px; color:${L.muted};">${esc(c.fallback)}<br />
          <a href="${esc(input.reviewUrl)}" style="color:${L.goldText}; word-break:break-all;">${esc(input.reviewUrl)}</a>
        </p>
      </td>
    </tr>`

  const html = renderEmail({
    lang: input.lang,
    subject: c.subject,
    preheader: c.preheader,
    heading: c.heading,
    intro: `${greeting} ${c.thanks}`,
    sections: [paragraphSection(c.ask), productList],
    cta: { label: c.button, href: input.reviewUrl },
    afterCta: [fallback, paragraphSection(`${c.signoff} ${c.team}`, true)],
    footerNote: c.why,
    unsubscribe: { label: c.unsubscribe, href: input.unsubscribeUrl },
  })

  const text = textEmail([
    greeting,
    '',
    c.thanks,
    '',
    c.ask,
    '',
    `${c.products}:`,
    ...shown.map((n) => `- ${n}`),
    more > 0 ? c.andMore(more) : null,
    '',
    `${c.button}: ${input.reviewUrl}`,
    '',
    c.signoff,
    c.team,
    '',
    c.why,
    `${c.unsubscribe}: ${input.unsubscribeUrl}`,
  ])

  return { subject: c.subject, html, text }
}
