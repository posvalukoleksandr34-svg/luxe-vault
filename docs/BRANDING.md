# Luxe Vault — site icons, link previews and the email sender logo

Everything here is generated from one monogram (a Didone “LV” in #D4AF37 gold on
#000000) and wired up through Next.js file-based metadata, so no page can end up
with a missing icon or a random preview image.

---

## 0. First: one canonical host

`luxe-vault.store` currently answers with a **308 redirect to
`www.luxe-vault.store`**, while the code (canonical links, sitemap, `metadataBase`,
so every absolute `og:image` URL) uses the bare domain. Facebook and Telegram
follow the redirect; WhatsApp and some crawlers sometimes drop a redirected
preview image, and search engines see canonicals that point at a redirect.

Pick one — the recommended option needs no code:

- **Recommended:** Vercel → Project → Settings → Domains → make `luxe-vault.store`
  the primary domain (`www` then redirects to it). Afterwards, set the GitHub
  repository **variable** `SITE_URL=https://luxe-vault.store` for the cron workflow
  and use the bare domain in the BIMI record below.
- Or keep `www` primary and switch `SITE_URL` in `app/layout.tsx`, `app/sitemap.ts`,
  `app/robots.ts` and `app/product/[slug]/page.tsx` to `https://www.luxe-vault.store`.

---

## 1. Folder structure

```
app/
  favicon.ico              16/32/48 px ICO — legacy browsers, Google Search
  icon.svg                 scalable tab icon — Chrome, Edge, Firefox, Safari 17+
  apple-icon.png           180×180 — iOS / iPadOS home screen
  manifest.ts              → /manifest.webmanifest (Android, desktop install)
  opengraph-image.tsx      1200×630 site-wide preview card (every route)
  product/[slug]/opengraph-image.tsx   1200×630 card per product
public/
  icons/icon-192.png       manifest, purpose "any"
  icons/icon-512.png       manifest, purpose "any"
  icons/icon-maskable-512.png   manifest, purpose "maskable"
  brand/lv-monogram.svg         master, transparent (dark backgrounds)
  brand/lv-monogram-black.svg   master on a black square (social profiles)
  email/avatar-512.png     sender avatar (Gravatar, Google account)
  email/avatar-1024.png    the same at 1024
  bimi/luxe-vault.svg      BIMI logo (SVG Tiny Portable/Secure)
lib/brand/monogram.generated.ts   the monogram paths, used by the OG cards
scripts/brand/generate_brand_assets.py   writes all of the above
```

## 2. File specifications

| File | Size | Format | Requirements |
|---|---|---|---|
| `app/favicon.ico` | 16, 32, 48 px | ICO (PNG frames) | Heavy-stroke variant — a 1 px hairline vanishes at 16 px. 48 px frame satisfies Google Search (multiples of 48). |
| `app/icon.svg` | any | SVG | Rounded black tile so it reads on light **and** dark tab bars. < 1 KB. |
| `app/apple-icon.png` | 180×180 | PNG, RGB | **Opaque**, full bleed. iOS rounds the corners itself; transparency turns black. |
| `public/icons/icon-192.png`, `icon-512.png` | 192, 512 | PNG, RGB | Full bleed, purpose `any`. |
| `public/icons/icon-maskable-512.png` | 512×512 | PNG, RGB | Mark inside the **central 80 % circle** (safe zone for Android masks). |
| OG / Twitter cards | 1200×630 (1.91:1) | PNG | Generated. Keep under **300 KB** (WhatsApp); key content in the centre; absolute HTTPS URL. |
| `public/email/avatar-*.png` | 512 and 1024 | PNG, RGB | Square, mark inside a circle crop; ≥ 512 px for Gravatar, ≥ 250 px for Google. |
| `public/bimi/luxe-vault.svg` | any | SVG Tiny PS | `version="1.2" baseProfile="tiny-ps"`, `<title>`, square viewBox, no `x`/`y` on the root, no text, images, scripts or external links, solid background, **< 32 KB**. |

## 3. Regenerating

```bash
pip install pillow
python scripts/brand/generate_brand_assets.py
```

The geometry lives in the script (`monogram()`); change it there and re-run.
Never edit the PNGs by hand — the next run overwrites them.

## 4. What every page now has in `<head>`

```html
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16">
<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-icon.png" type="image/png" sizes="180x180">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="LUXE VAULT">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
```

Test: Chrome DevTools → Application → Manifest (icons, installability);
add to the home screen on an iPhone and an Android phone.

## 5. Link previews (Open Graph + Twitter Card)

Every route emits, without any page having to ask for it:

```html
<meta property="og:type" content="website">
<meta property="og:site_name" content="LUXE VAULT">
<meta property="og:title" content="…">
<meta property="og:description" content="…">
<meta property="og:locale" content="ru_RU">  (+ en_US, it_IT, fr_FR, de_DE alternates)
<meta property="og:image" content="https://luxe-vault.store/opengraph-image?…">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="LUXE VAULT — Premium Apparel & Accessories">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="…">
<meta name="twitter:description" content="…">
<meta name="twitter:image" content="…same card…">  (+ width, height, type, alt)
```

- `app/opengraph-image.tsx` covers **every** route, so a scraper never falls back to
  guessing an image from the page. Product pages override it with their own card
  (photo when it is PNG/JPEG, otherwise the monogram; name; price).
- `og:url` is set only by pages that declare their own Open Graph (products,
  categories). A site-wide `og:url` made other pages claim to be the homepage.
- `twitter:creator` is `@luxevault_orders`. **Replace it with the brand’s real X
  handle, or remove it**; add `twitter.site` in `app/layout.tsx` if you have one.

Refreshing a preview after a change (each platform caches):

| Platform | How to refresh |
|---|---|
| Telegram | Send the link to **@WebpageBot**, then share again. |
| WhatsApp | Uses Facebook’s crawler: **Facebook Sharing Debugger** → “Scrape again”. Old chats keep their cached preview; `?v=2` forces a new one. |
| Facebook / Instagram DMs | developers.facebook.com/tools/debug → “Scrape again”. |
| LinkedIn | linkedin.com/post-inspector. |
| X | No validator any more — compose a post and check the preview. |
| iMessage | Cached on the device; test from a device that has not seen the link. |

## 6. The sender logo in inboxes

### 6.1 Where things stand (DNS, checked 15 Sep 2026)

| Record | Value | Status |
|---|---|---|
| `_dmarc` | `v=DMARC1; p=none;` | Too weak for BIMI (needs quarantine/reject). |
| `default._bimi` | — | Missing. |
| `resend._domainkey` | DKIM key | ✅ Resend signs as `luxe-vault.store`. |
| `send` (SPF for Resend) | — | Not found — confirm in Resend → Domains that every record is green. |
| MX | Namecheap email forwarding | `support@`/`orders@` forward to another inbox. |

The display name is already set: `Luxe Vault <orders@luxe-vault.store>` and
`Luxe Vault <support@luxe-vault.store>` (`lib/server/resend.ts`).

### 6.2 Step 1 — DMARC to enforcement

Before tightening, make sure **every** service that sends as `@luxe-vault.store` is
DKIM-signed for the domain (Resend is; replying “as” support@ from a personal Gmail
is not, and would start landing in spam).

```
_dmarc.luxe-vault.store  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@luxe-vault.store; fo=1"
      ↓ 1–2 weeks of clean reports
_dmarc.luxe-vault.store  TXT  "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@luxe-vault.store"
      ↓ optional, later
_dmarc.luxe-vault.store  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc@luxe-vault.store"
```

BIMI requires `p=quarantine` or `p=reject`, `pct=100` (or absent), and no
`sp=none`.

### 6.3 Step 2 — BIMI record

```
default._bimi.luxe-vault.store  TXT  "v=BIMI1; l=https://www.luxe-vault.store/bimi/luxe-vault.svg; a=;"
```

`l=` must be served over HTTPS **without a redirect** — use whichever host is primary
after section 0. This alone (self-asserted) shows the logo in **Yahoo Mail, AOL and
Fastmail**.

### 6.4 Step 3 — Gmail and Apple Mail

- **Gmail** shows BIMI logos only with a certificate: a **VMC** (needs a registered
  trademark) or a **CMC** (logo in public use for 12 months, no trademark). Issued
  by DigiCert, Entrust, GlobalSign or SSL.com; expect ~US$1,000+/year. Add the
  `.pem` URL as `a=https://…/vmc.pem` in the BIMI record. Gmail then also shows the
  blue verified check.
- **Apple Mail** (iOS 16+/macOS 13+) shows BIMI with a VMC. Apple’s own route is
  **Apple Business Connect → Branded Mail** (register the brand and upload the
  logo, no certificate) — check availability for your region when you sign up.
- **Outlook / Microsoft 365**: no BIMI support; recipients see initials.

### 6.5 Free options while BIMI is pending

- **Gravatar** — create an account for `orders@` and `support@` (both send mail),
  upload `public/email/avatar-1024.png`. Used by Thunderbird (with add-ons), several
  mobile mail apps and many web tools; not by Gmail, Apple Mail or Outlook.
- **Google Account photo** — accounts.google.com → Create account → “Use my current
  email address instead” with `orders@luxe-vault.store` (the code arrives through
  the Namecheap forward), then set `avatar-1024.png` as the profile photo. Gmail may
  show it beside authenticated mail from that address; best effort, not guaranteed.

### 6.6 Verify

- BIMI Group inspector (bimigroup.org/bimi-generator) and MXToolbox BIMI/DMARC lookups.
- Send a test to a Yahoo address; in Gmail use “Show original” and look for
  `dkim=pass` and `dmarc=pass`.

### 6.7 The logo inside the emails

Every email already opens with the LUXE VAULT wordmark as **text** in the Dark
Luxury layout (`lib/server/emails/layout.ts`), which no client can block. The inbox
avatar above is the part that needs DNS and, for Gmail, a certificate.

## 7. Checklist

- [ ] Section 0: one primary domain (and `SITE_URL` variable for the workflow)
- [ ] Replace or remove `twitter:creator`
- [ ] Resend → Domains: all records verified
- [ ] DMARC `p=none` with `rua` → quarantine after clean reports
- [ ] `default._bimi` TXT with the SVG URL
- [ ] Gravatar + Google profile photo for `orders@` and `support@`
- [ ] Optional: VMC/CMC for Gmail and Apple Mail, or Apple Branded Mail
- [ ] Refresh previews: @WebpageBot, Facebook Sharing Debugger
