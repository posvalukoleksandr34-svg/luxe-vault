import type { LegalDocSet } from './types'

const SUPPORT = 'support@luxe-vault.store'

/**
 * The Cookie Policy — every cookie and browser-storage entry the site sets,
 * from the code:
 *   sb-*-auth-token        lib/supabase (@supabase/ssr, 400-day default)
 *   lv_ref                 app/r/[code]/route.ts (REFERRAL_COOKIE_DAYS = 30)
 *   __Host-lv_admin_session lib/server/admin-auth.ts (8 h, console only)
 *   __stripe_mid/_sid      Stripe.js, on the payment form
 *   __cf_bm                Cloudflare bot management (when enabled)
 *   _ga, _ga_*             lib/analytics-vendors.ts, analytics consent only
 *   _fbp, _fbc             lib/analytics-vendors.ts, marketing consent only
 *   localStorage keys      grep "localStorage" lib components
 * Add a cookie or a storage key, add it here.
 */
export const COOKIES: LegalDocSet = {
  ru: {
    title: 'Политика cookie',
    description: 'Какие cookie и записи в хранилище браузера использует Luxe Vault, зачем и как долго.',
    effective: 'Действует с 6 октября 2026 года',
    sections: [
      {
        h: '1. Коротко',
        blocks: [
          { p: 'Необходимые cookie нужны для входа, оплаты и защиты сайта и работают всегда. Аналитические и маркетинговые загружаются **только после вашего согласия**; до него, после отказа и на страницах с ключами доступа в адресе они не загружаются. Изменить выбор можно в любой момент — «Настройки cookie» внизу любой страницы. Выбор хранится 12 месяцев.' },
        ],
      },
      {
        h: '2. Необходимые cookie (всегда включены)',
        blocks: [
          { ul: [
            '**sb-…-auth-token** (Luxe Vault / Supabase) — сохраняет вход в аккаунт. До выхода из аккаунта, не дольше 400 дней.',
            '**lv_ref** (Luxe Vault) — ставится, только если вы открыли реферальную ссылку: хранит код, чтобы при оформлении применить скидку для приглашённого. 30 дней.',
            '**__stripe_mid**, **__stripe_sid** (Stripe) — защита от мошенничества при оплате картой; появляются, когда загружается форма оплаты. 1 год и 30 минут.',
            '**__cf_bm** (Cloudflare) — может ставиться для отсева ботов. 30 минут. Проверка Cloudflare Turnstile в формах работает во встроенном окне Cloudflare.',
            '**__Host-lv_admin_session** (Luxe Vault) — только для входа продавца в панель управления. 8 часов.',
          ] },
        ],
      },
      {
        h: '3. Аналитика (только с согласием)',
        blocks: [
          { ul: [
            '**_ga**, **_ga_…** (Google Analytics 4) — статистика посещений. До 2 лет. Рекламные функции Google включаются, только если вы дали и маркетинговое согласие.',
          ] },
        ],
      },
      {
        h: '4. Маркетинг (только с согласием)',
        blocks: [
          { ul: [
            '**_fbp**, **_fbc** (Meta Pixel) — оценка эффективности рекламы. До 3 месяцев.',
          ] },
          { p: 'При отзыве согласия эти cookie удаляются, а скрипты перестают отправлять данные.' },
        ],
      },
      {
        h: '5. Хранилище браузера (localStorage)',
        blocks: [
          { p: 'Эти записи хранятся только на вашем устройстве и сами по себе никуда не отправляются. Их можно удалить, очистив данные сайта в браузере.' },
          { ul: [
            '**lv.cookie-consent.v1** — ваш выбор по cookie (12 месяцев).',
            '**lv.cart.v1** — корзина (30 дней после последнего изменения).',
            '**lv.wishlist.v1** — избранное без входа в аккаунт.',
            '**luxe-vault-orders** — номера и ключи доступа к заказам, оформленным на этом устройстве без аккаунта.',
            '**lv.checkout.profile.v1** — данные для оформления заказа; только если вы включили «Сохранить данные». Номер карты не сохраняется никогда.',
            '**lv.recently-viewed.v1**, **lv.recent-searches.v1** — недавно просмотренные товары и поиски.',
            '**lv.fit.v1**, **lv.finder.v1** — мерки и ответы из помощника по размеру (рост, вес, возраст — если указан). «Начать заново» удаляет ответы.',
            '**luxe-vault-locale**, **lv.currency.v1**, **lv.motion**, **soundEnabled** — язык, валюта, анимация и звук.',
            '**lv.analytics.purchases** — номера заказов, уже переданных в аналитику (только с согласием), чтобы не учитывать покупку дважды.',
            '**lv.welcome-checked**, **lv.appCode.announced** — показ промокода приложения.',
            '**luxe-vault-category-images** — изображения разделов, чтобы страница открывалась быстрее.',
          ] },
          { p: 'Сайт также использует service worker, который кэширует файлы сайта для быстрой и офлайн-загрузки. Персональных данных он не кэширует.' },
        ],
      },
      {
        h: '6. Вопросы',
        blocks: [
          { p: `Как мы обрабатываем данные в целом — в [Политике конфиденциальности](/legal/privacy). Вопросы — [${SUPPORT}](mailto:${SUPPORT}).` },
        ],
      },
    ],
  },

  en: {
    title: 'Cookie Policy',
    description: 'Which cookies and browser-storage entries Luxe Vault uses, why, and for how long.',
    effective: 'In force since 6 October 2026',
    sections: [
      {
        h: '1. In short',
        blocks: [
          { p: 'Strictly necessary cookies make sign-in, payment and site security work and are always on. Analytics and marketing load **only after you consent** — never before, never after you refuse, and never on pages whose address carries an access key. Change your choice at any time with "Cookie settings" at the foot of every page. Your choice is kept for 12 months.' },
        ],
      },
      {
        h: '2. Strictly necessary (always on)',
        blocks: [
          { ul: [
            '**sb-…-auth-token** (Luxe Vault / Supabase) — keeps you signed in. Until you sign out, at most 400 days.',
            '**lv_ref** (Luxe Vault) — set only when you open a referral link: holds the code so the friend\'s discount can be applied at checkout. 30 days.',
            '**__stripe_mid**, **__stripe_sid** (Stripe) — fraud prevention for card payments; set when the payment form loads. 1 year and 30 minutes.',
            '**__cf_bm** (Cloudflare) — may be set to filter out bots. 30 minutes. The Cloudflare Turnstile check on forms runs in Cloudflare\'s own embedded frame.',
            '**__Host-lv_admin_session** (Luxe Vault) — the seller\'s console sign-in only. 8 hours.',
          ] },
        ],
      },
      {
        h: '3. Analytics (only with consent)',
        blocks: [
          { ul: [
            '**_ga**, **_ga_…** (Google Analytics 4) — visit statistics. Up to 2 years. Google\'s advertising features are switched on only if you have also given marketing consent.',
          ] },
        ],
      },
      {
        h: '4. Marketing (only with consent)',
        blocks: [
          { ul: [
            '**_fbp**, **_fbc** (Meta Pixel) — measuring advertising. Up to 3 months.',
          ] },
          { p: 'Withdrawing consent deletes these cookies and stops the scripts sending anything.' },
        ],
      },
      {
        h: '5. Browser storage (localStorage)',
        blocks: [
          { p: 'These entries stay on your device and are not sent anywhere by themselves. Clearing the site\'s data in your browser removes them.' },
          { ul: [
            '**lv.cookie-consent.v1** — your cookie choice (12 months).',
            '**lv.cart.v1** — your cart (30 days after the last change).',
            '**lv.wishlist.v1** — your wishlist when not signed in.',
            '**luxe-vault-orders** — numbers and access keys of orders placed on this device without an account.',
            '**lv.checkout.profile.v1** — your checkout details, only if you switched on "Save my details". A card number is never saved.',
            '**lv.recently-viewed.v1**, **lv.recent-searches.v1** — recently viewed products and searches.',
            '**lv.fit.v1**, **lv.finder.v1** — measurements and answers entered in the size advisor and size finder (height, weight, and age if given). "Start over" deletes the answers.',
            '**luxe-vault-locale**, **lv.currency.v1**, **lv.motion**, **soundEnabled** — language, currency, animation and sound.',
            '**lv.analytics.purchases** — order numbers already reported to analytics (only with consent), so a purchase is not counted twice.',
            '**lv.welcome-checked**, **lv.appCode.announced** — whether the app\'s promo code has been shown.',
            '**luxe-vault-category-images** — department images, so pages open faster.',
          ] },
          { p: 'The site also uses a service worker that caches the site\'s own files for fast and offline loading. It does not cache personal data.' },
        ],
      },
      {
        h: '6. Questions',
        blocks: [
          { p: `How we handle data in general is in the [Privacy Policy](/legal/privacy). Questions: [${SUPPORT}](mailto:${SUPPORT}).` },
        ],
      },
    ],
  },

  it: {
    title: 'Cookie Policy',
    description: 'Quali cookie e dati nella memoria del browser usa Luxe Vault, perché e per quanto tempo.',
    effective: 'In vigore dal 6 ottobre 2026',
    sections: [
      {
        h: '1. In breve',
        blocks: [
          { p: 'I cookie strettamente necessari fanno funzionare accesso, pagamento e sicurezza e sono sempre attivi. Analisi e marketing si caricano **solo dopo il tuo consenso** — mai prima, mai dopo un rifiuto e mai sulle pagine il cui indirizzo contiene una chiave di accesso. Puoi cambiare scelta in qualsiasi momento con «Impostazioni cookie» in fondo a ogni pagina. La scelta vale 12 mesi.' },
        ],
      },
      {
        h: '2. Strettamente necessari (sempre attivi)',
        blocks: [
          { ul: [
            '**sb-…-auth-token** (Luxe Vault / Supabase) — mantiene l\'accesso all\'account. Fino all\'uscita, al massimo 400 giorni.',
            '**lv_ref** (Luxe Vault) — impostato solo se apri un link referral: conserva il codice per applicare lo sconto dell\'invitato al checkout. 30 giorni.',
            '**__stripe_mid**, **__stripe_sid** (Stripe) — prevenzione delle frodi nei pagamenti con carta; impostati quando si carica il modulo di pagamento. 1 anno e 30 minuti.',
            '**__cf_bm** (Cloudflare) — può essere impostato per filtrare i bot. 30 minuti. La verifica Cloudflare Turnstile nei moduli funziona nel riquadro incorporato di Cloudflare.',
            '**__Host-lv_admin_session** (Luxe Vault) — solo per l\'accesso del venditore alla console. 8 ore.',
          ] },
        ],
      },
      {
        h: '3. Analisi (solo con consenso)',
        blocks: [
          { ul: [
            '**_ga**, **_ga_…** (Google Analytics 4) — statistiche delle visite. Fino a 2 anni. Le funzioni pubblicitarie di Google si attivano solo se hai dato anche il consenso al marketing.',
          ] },
        ],
      },
      {
        h: '4. Marketing (solo con consenso)',
        blocks: [
          { ul: [
            '**_fbp**, **_fbc** (pixel di Meta) — misurazione della pubblicità. Fino a 3 mesi.',
          ] },
          { p: 'Revocando il consenso questi cookie vengono cancellati e gli script smettono di inviare dati.' },
        ],
      },
      {
        h: '5. Memoria del browser (localStorage)',
        blocks: [
          { p: 'Questi dati restano sul tuo dispositivo e non vengono inviati altrove da soli. Cancellando i dati del sito nel browser li rimuovi.' },
          { ul: [
            '**lv.cookie-consent.v1** — la tua scelta sui cookie (12 mesi).',
            '**lv.cart.v1** — il carrello (30 giorni dall\'ultima modifica).',
            '**lv.wishlist.v1** — i preferiti senza accesso.',
            '**luxe-vault-orders** — numeri e chiavi di accesso degli ordini fatti da questo dispositivo senza account.',
            '**lv.checkout.profile.v1** — i dati per il checkout, solo se hai attivato «Salva i miei dati». Il numero di carta non viene mai salvato.',
            '**lv.recently-viewed.v1**, **lv.recent-searches.v1** — prodotti visti e ricerche recenti.',
            '**lv.fit.v1**, **lv.finder.v1** — le misure e le risposte inserite nel consulente taglie e in «Trova la tua misura» (altezza, peso ed età, se indicata). «Inizia da capo» cancella le risposte.',
            '**luxe-vault-locale**, **lv.currency.v1**, **lv.motion**, **soundEnabled** — lingua, valuta, animazioni e suoni.',
            '**lv.analytics.purchases** — numeri d\'ordine già comunicati all\'analisi (solo con consenso), per non contare due volte un acquisto.',
            '**lv.welcome-checked**, **lv.appCode.announced** — se il codice promo dell\'app è già stato mostrato.',
            '**luxe-vault-category-images** — immagini dei reparti, per aprire le pagine più in fretta.',
          ] },
          { p: 'Il sito usa anche un service worker che memorizza i file del sito per un caricamento rapido e offline. Non memorizza dati personali.' },
        ],
      },
      {
        h: '6. Domande',
        blocks: [
          { p: `Come trattiamo i dati in generale è spiegato nell\'[Informativa sulla privacy](/legal/privacy). Domande: [${SUPPORT}](mailto:${SUPPORT}).` },
        ],
      },
    ],
  },
}
