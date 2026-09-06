import type {
  CategoryGroupKey,
  CategoryKey,
  Order,
  Product,
  Promo,
  Review,
  SizeMeasurement,
} from './types'

export const CATEGORY_TREE: { group: CategoryGroupKey; items: CategoryKey[] }[] = [
  { group: 'clothing', items: ['hoodies', 'tshirts', 'jackets'] },
  { group: 'shoes', items: ['sneakers', 'sneakers_low'] },
  { group: 'accessories', items: ['bags', 'caps'] },
]

/** Out-of-the-box preview image for each Collections (Collezioni) card,
 * used until an admin swaps it out via the admin panel's Коллекции tab —
 * see CATEGORY_IMAGES_STORAGE_KEY in lib/store.tsx. */
export const DEFAULT_CATEGORY_IMAGES: Record<CategoryGroupKey, string> = {
  clothing: '/images/hoodie.png',
  shoes: '/images/sneakers.png',
  accessories: '/images/bag.png',
}

const NEUTRALS = [
  { name: 'Onyx', hex: '#141414' },
  { name: 'Graphite', hex: '#3a3a3d' },
  { name: 'Ivory', hex: '#ece6d8' },
]

export const SEED_PRODUCTS: Product[] = [
  {
    id: 'p-gucci-blind-for-love-hoodie',
    name: {
      ru: 'Худи Gucci "Blind for Love" с тигром',
      en: 'Gucci "Blind for Love" Tiger Hoodie',
      it: 'Felpa Gucci "Blind for Love" con tigre',
      fr: 'Sweat Gucci « Blind for Love » à tigre',
      de: 'Gucci „Blind for Love"-Hoodie mit Tiger',
    },
    group: 'clothing',
    category: 'hoodies',
    price: 850,
    oldPrice: 1100,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ name: 'Onyx', hex: '#141414' }],
    image: '/images/gucci-hoodie-1.jpg',
    images: [
      '/images/gucci-hoodie-1.jpg',
      '/images/gucci-hoodie-2.jpg',
      '/images/gucci-hoodie-3.jpg',
      '/images/gucci-hoodie-4.jpg',
      '/images/gucci-hoodie-5.jpg',
      '/images/gucci-hoodie-6.jpg',
    ],
    description: {
      ru: 'Черное худи Gucci из плотного премиального хлопка. Модель украшена контрастной красной надписью "BLIND FOR LOVE" и объемной фактурной патч-вышивкой тигра на груди.',
      en: 'A black Gucci hoodie in heavyweight premium cotton, featuring the contrasting red "BLIND FOR LOVE" print and a raised textured tiger patch embroidery on the chest.',
      it: 'Felpa nera Gucci in cotone premium di peso elevato, con la scritta rossa a contrasto "BLIND FOR LOVE" e un ricamo patch a rilievo raffigurante una tigre sul petto.',
      fr: 'Sweat à capuche noir Gucci en coton premium épais, orné de l\'inscription rouge contrastante « BLIND FOR LOVE » et d\'un écusson brodé en relief représentant un tigre sur la poitrine.',
      de: 'Schwarzer Gucci-Hoodie aus schwerer Premium-Baumwolle mit kontrastierendem rotem „BLIND FOR LOVE"-Schriftzug und einer plastisch gestickten Tiger-Patch-Stickerei auf der Brust.',
    },
    statuses: ['in_stock', 'mirror_quality'],
    isNew: true,
    sizeChart: [
      { size: 'S', length: 63, chest: 106, shoulder: 47, sleeve: 60 },
      { size: 'M', length: 65, chest: 110, shoulder: 48, sleeve: 62 },
      { size: 'L', length: 67, chest: 114, shoulder: 49, sleeve: 64 },
      { size: 'XL', length: 69, chest: 118, shoulder: 50, sleeve: 66 },
    ],
  },
  {
    id: 'p-hoodie-noir',
    name: {
      ru: 'Noir Heavyweight Hoodie',
      en: 'Noir Heavyweight Hoodie',
      it: 'Noir Heavyweight Hoodie',
      fr: 'Noir Heavyweight Hoodie',
      de: 'Noir Heavyweight Hoodie',
    },
    group: 'clothing',
    category: 'hoodies',
    price: 189,
    oldPrice: 249,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: NEUTRALS,
    image: '/images/hoodie.png',
    description: {
      ru: 'Плотное худи из премиального хлопка плотностью 480 г/м². Свободный крой, кулиска ручной работы, брашированная изнанка. Идеальная посадка для повседневного люкса.',
      en: 'A heavyweight hoodie in premium cotton at 480 g/m². Relaxed fit, hand-finished drawcord, brushed interior. The perfect fit for everyday luxury.',
      it: 'Felpa pesante in cotone premium da 480 g/m². Vestibilità ampia, coulisse rifinita a mano, interno garzato. La vestibilità perfetta per il lusso quotidiano.',
      fr: "Sweat épais en coton premium de 480 g/m². Coupe ample, cordon de serrage fini à la main, intérieur brossé. L'ajustement parfait pour un luxe au quotidien.",
      de: 'Schwerer Hoodie aus Premium-Baumwolle mit 480 g/m². Lockere Passform, handgefertigte Kordel, gebürstetes Innenfutter. Die perfekte Passform für alltäglichen Luxus.',
    },
    statuses: ['in_stock', 'mirror_quality'],
  },
  {
    id: 'p-tee-blanc',
    name: {
      ru: 'Blanc Essential Tee',
      en: 'Blanc Essential Tee',
      it: 'Blanc Essential Tee',
      fr: 'Blanc Essential Tee',
      de: 'Blanc Essential Tee',
    },
    group: 'clothing',
    category: 'tshirts',
    price: 79,
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    colors: [
      { name: 'Ivory', hex: '#ece6d8' },
      { name: 'Onyx', hex: '#141414' },
    ],
    image: '/images/tshirt.png',
    description: {
      ru: 'Тяжёлая футболка из египетского хлопка с прямым силуэтом. Усиленные плечевые швы и гладкая поверхность премиального трикотажа.',
      en: 'A heavyweight tee in Egyptian cotton with a straight silhouette. Reinforced shoulder seams and a smooth premium jersey finish.',
      it: 'T-shirt pesante in cotone egiziano dalla silhouette dritta. Cuciture rinforzate sulle spalle e superficie liscia in jersey premium.',
      fr: "T-shirt épais en coton égyptien à la silhouette droite. Coutures d'épaule renforcées et surface lisse en jersey premium.",
      de: 'Schweres T-Shirt aus ägyptischer Baumwolle mit geradem Schnitt. Verstärkte Schulternähte und glatte Oberfläche aus Premium-Jersey.',
    },
    statuses: ['in_stock', 'premium_quality'],
  },
  {
    id: 'p-jacket-atelier',
    name: {
      ru: 'Atelier Leather Bomber',
      en: 'Atelier Leather Bomber',
      it: 'Atelier Leather Bomber',
      fr: 'Atelier Leather Bomber',
      de: 'Atelier Leather Bomber',
    },
    group: 'clothing',
    category: 'jackets',
    price: 649,
    oldPrice: 820,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ name: 'Onyx', hex: '#141414' }],
    image: '/images/jacket.png',
    description: {
      ru: 'Бомбер из натуральной кожи наппа с сатиновой подкладкой. Итальянская фурнитура и ручная финишная обработка кромок.',
      en: 'A bomber jacket in genuine nappa leather with a satin lining. Italian hardware and hand-finished edges.',
      it: 'Bomber in vera pelle nappa con fodera in raso. Accessori italiani e finiture dei bordi rifinite a mano.',
      fr: 'Blouson bomber en cuir nappa véritable avec doublure en satin. Quincaillerie italienne et finitions des bords à la main.',
      de: 'Bomberjacke aus echtem Nappaleder mit Satinfutter. Italienische Beschläge und handveredelte Kanten.',
    },
    statuses: ['limited_edition', 'mirror_quality'],
    limited: true,
  },
  {
    id: 'p-sneakers-aurum',
    name: {
      ru: 'Aurum High-Top',
      en: 'Aurum High-Top',
      it: 'Aurum High-Top',
      fr: 'Aurum High-Top',
      de: 'Aurum High-Top',
    },
    group: 'shoes',
    category: 'sneakers',
    price: 429,
    oldPrice: 520,
    sizes: ['40', '41', '42', '43', '44', '45'],
    colors: [
      { name: 'Onyx / Gold', hex: '#141414' },
      { name: 'Graphite', hex: '#3a3a3d' },
    ],
    image: '/images/sneakers.png',
    description: {
      ru: 'Высокие кроссовки с золотыми акцентами на премиальной подошве. Кожаный верх, амортизирующая стелька из вспененного пенополиуретана.',
      en: 'High-top sneakers with gold accents on a premium sole. Leather upper and a cushioned foam insole.',
      it: 'Sneakers alte con dettagli dorati su suola premium. Tomaia in pelle e soletta ammortizzante in schiuma.',
      fr: 'Baskets montantes avec détails dorés sur semelle premium. Tige en cuir et semelle intérieure amortissante en mousse.',
      de: 'High-Top-Sneaker mit goldenen Akzenten auf Premium-Sohle. Obermaterial aus Leder und dämpfende Schaumstoff-Einlegesohle.',
    },
    statuses: ['in_stock', 'limited_edition'],
    limited: true,
  },
  {
    id: 'p-keds-mono',
    name: {
      ru: 'Mono Canvas Low',
      en: 'Mono Canvas Low',
      it: 'Mono Canvas Low',
      fr: 'Mono Canvas Low',
      de: 'Mono Canvas Low',
    },
    group: 'shoes',
    category: 'sneakers_low',
    price: 219,
    sizes: ['40', '41', '42', '43', '44'],
    colors: [{ name: 'Onyx', hex: '#141414' }],
    image: '/images/keds.png',
    description: {
      ru: 'Минималистичные кеды из плотного канваса с вулканизированной подошвой. Комфорт на каждый день в чистом монохромном исполнении.',
      en: 'Minimalist low-top sneakers in heavyweight canvas with a vulcanized sole. Everyday comfort in a clean monochrome finish.',
      it: 'Sneakers basse minimaliste in tela pesante con suola vulcanizzata. Comfort quotidiano in una finitura monocromatica pulita.',
      fr: 'Baskets basses minimalistes en toile épaisse à semelle vulcanisée. Confort au quotidien dans une finition monochrome épurée.',
      de: 'Minimalistische Low-Top-Sneaker aus schwerem Canvas mit vulkanisierter Sohle. Alltagskomfort in cleaner, einfarbiger Ausführung.',
    },
    statuses: ['in_stock', 'premium_quality'],
  },
  {
    id: 'p-bag-vault',
    name: {
      ru: 'Vault Leather Tote',
      en: 'Vault Leather Tote',
      it: 'Vault Leather Tote',
      fr: 'Vault Leather Tote',
      de: 'Vault Leather Tote',
    },
    group: 'accessories',
    category: 'bags',
    price: 389,
    oldPrice: 459,
    sizes: ['One Size'],
    colors: [{ name: 'Onyx', hex: '#141414' }],
    image: '/images/bag.png',
    description: {
      ru: 'Вместительный тоут из зернистой кожи с золотой фурнитурой. Съёмный внутренний карман и усиленные ручки ручной работы.',
      en: 'A spacious tote in grained leather with gold hardware. A detachable inner pouch and reinforced hand-finished handles.',
      it: 'Ampia tote bag in pelle martellata con accessori dorati. Tasca interna removibile e manici rinforzati rifiniti a mano.',
      fr: 'Grand tote bag en cuir grainé avec quincaillerie dorée. Pochette intérieure amovible et anses renforcées finies à la main.',
      de: 'Geräumiger Tote Bag aus genarbtem Leder mit goldenen Beschlägen. Abnehmbare Innentasche und verstärkte, handgefertigte Henkel.',
    },
    statuses: ['in_stock', 'mirror_quality'],
  },
  {
    id: 'p-cap-signature',
    name: {
      ru: 'Signature Gold Cap',
      en: 'Signature Gold Cap',
      it: 'Signature Gold Cap',
      fr: 'Signature Gold Cap',
      de: 'Signature Gold Cap',
    },
    group: 'accessories',
    category: 'caps',
    price: 69,
    oldPrice: 99,
    sizes: ['One Size'],
    colors: [{ name: 'Onyx', hex: '#141414' }],
    image: '/images/cap.png',
    description: {
      ru: 'Классическая бейсболка с золотой вышивкой и регулируемым металлическим ремешком. Дышащий премиальный хлопок.',
      en: 'A classic baseball cap with gold embroidery and an adjustable metal strap. Breathable premium cotton.',
      it: 'Cappellino da baseball classico con ricamo dorato e cinturino metallico regolabile. Cotone premium traspirante.',
      fr: 'Casquette de baseball classique avec broderie dorée et sangle métallique réglable. Coton premium respirant.',
      de: 'Klassische Baseballkappe mit goldener Stickerei und verstellbarem Metallverschluss. Atmungsaktive Premium-Baumwolle.',
    },
    statuses: ['in_stock'],
  },
]

export const SEED_PROMOS: Promo[] = [
  { code: 'LUXE10', percent: 10, active: true },
  { code: 'VAULT20', percent: 20, active: true },
]

const now = Date.now()

// SEED_ORDERS removed: orders now live in Postgres (public.orders).
// Demo rows here would never appear in the app and would drift from the
// real schema, so the seed data was deleted rather than translated.

export const CRYPTO_PAYMENT_METHOD = 'Криптовалюта'

/** Online card payment, settled through Stripe Checkout. */
export const CARD_PAYMENT_METHOD = 'Карта онлайн'

/**
 * "SBP / transfer" and "cash on delivery" were removed deliberately.
 *
 * Both settled outside the app: SBP produced a manual bank transfer nobody
 * reconciled automatically, and cash on delivery let an order ship before any
 * money existed. Card payments now run through Stripe Checkout, which
 * confirms the payment through a signed webhook before the order is marked
 * paid.
 */
export const PAYMENT_METHODS = [CARD_PAYMENT_METHOD, CRYPTO_PAYMENT_METHOD]

/**
 * Every remaining method is paid up front, so every order starts life as
 * `pending_payment` and is promoted only when the provider confirms it.
 * Kept as a function rather than inlined `true`: it is the single place to
 * change if a settle-later method is ever reintroduced.
 */
export function requiresPrepayment(_method: string): boolean {
  return true
}

export const DEFAULT_SIZE_CHART: SizeMeasurement[] = [
  { size: 'S', length: 63, chest: 106, shoulder: 47, sleeve: 60 },
  { size: 'M', length: 65, chest: 110, shoulder: 48, sleeve: 62 },
  { size: 'L', length: 67, chest: 114, shoulder: 49, sleeve: 64 },
  { size: 'XL', length: 69, chest: 118, shoulder: 50, sleeve: 66 },
]

export const TELEGRAM_ADMIN = '@luxevault_orders'
/**
 * Public support mailbox. Shown in the footer and the support widget, and used
 * as the Reply-To on customer email.
 *
 * Must stay on `luxe-vault.store` — the hyphenated domain verified in Resend.
 * It previously read `luxevault.store` (no hyphen), a different domain
 * entirely, which meant the auto-reply invited customers to "просто ответьте
 * на это письмо" and pointed that reply somewhere unowned.
 */
export const SUPPORT_EMAIL = 'support@luxe-vault.store'

export const SEED_REVIEWS: Review[] = [
  {
    id: 'rev-1001',
    name: 'Алексей М.',
    rating: 5,
    message: 'Худи пришло раньше срока, качество пошива и вышивки — отличное для реплики. Уже заказал второй раз.',
    createdAt: now - 1000 * 60 * 60 * 24 * 9,
    status: 'approved',
  },
  {
    id: 'rev-1002',
    name: 'Дарья С.',
    rating: 5,
    message: 'Бомбер сидит идеально, кожа мягкая и приятная. Упаковка и подача — как в бутике.',
    createdAt: now - 1000 * 60 * 60 * 24 * 21,
    status: 'approved',
  },
  {
    id: 'rev-1003',
    name: 'Marco T.',
    rating: 4,
    message: 'Ottima qualità delle sneaker, consegna leggermente più lenta del previsto ma ne è valsa la pena.',
    createdAt: now - 1000 * 60 * 60 * 24 * 34,
    status: 'approved',
  },
]
