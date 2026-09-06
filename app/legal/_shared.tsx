/**
 * Bits shared by all three documents.
 *
 * `_shared` — the underscore makes this a private folder-mate that Next's
 * router ignores, so it never becomes a /legal/_shared route.
 */
export const LAST_UPDATED = '6 сентября 2026'

export const OPERATOR = {
  name: 'LUXE VAULT',
  site: 'luxe-vault.store',
  support: 'support@luxe-vault.store',
  telegram: '@luxevault_orders',
}

/**
 * The placeholders a lawyer must fill before launch. Rendered visibly rather
 * than hidden in a comment: a TODO nobody sees is a TODO nobody does, and
 * shipping a policy that silently omits the operator's legal identity is worse
 * than shipping one that says so.
 */
export function DraftNotice() {
  return (
    <div className="not-prose mb-8 border-l-2 border-gold/50 bg-gold/[0.05] py-3 pl-4 pr-3">
      <p className="text-[12px] font-light leading-relaxed text-muted-foreground">
        <strong className="text-gold">Требуется юридическая проверка.</strong>{' '}
        Документ составлен для частной продажи (Privatverkauf) из Швейцарии.
        Перед публикацией согласуйте текст с юристом, практикующим в
        Швейцарии, — в частности, вопрос о признании деятельности
        предпринимательской и о представителе в ЕС по ст. 27 GDPR.
      </p>
    </div>
  )
}

export function Footer() {
  return (
    <p className="mt-12 border-t border-border/40 pt-6 text-[12px] text-muted-foreground/60">
      Последнее обновление: {LAST_UPDATED}. Вопросы:{' '}
      <a href={`mailto:${OPERATOR.support}`}>{OPERATOR.support}</a>
    </p>
  )
}
