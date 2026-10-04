#!/usr/bin/env node
/**
 * Sets up the admin console's second factor (lib/server/admin-totp.ts).
 *
 *   node scripts/admin-totp-setup.mjs
 *
 * Prints a new secret and a QR code. Then:
 *   1. Scan the QR code with an authenticator app (1Password, Google
 *      Authenticator, Aegis, Authy…) on the phone of the person who signs in.
 *   2. Add the secret to Vercel → Settings → Environment Variables as
 *      ADMIN_TOTP_SECRET (Production, mark it Sensitive), then redeploy.
 *   3. Sign in once with the password and the 6-digit code to confirm.
 *
 * Run it on your own computer. The secret is shown only here, once: do not
 * paste it into chats, tickets or the repository. Running the script again
 * makes a NEW secret — the old enrolment stops working once Vercel has it.
 */
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'

function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

const secret = base32Encode(randomBytes(20)) // 160 bits, as RFC 4226 recommends
const label = encodeURIComponent('LUXE VAULT:admin')
const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('LUXE VAULT')}&algorithm=SHA1&digits=6&period=30`

console.log('\nScan with your authenticator app:\n')
console.log(await QRCode.toString(uri, { type: 'terminal', small: true }))
console.log('Or enter this key by hand (time-based, 6 digits, 30 s):\n')
console.log(`  ${secret.match(/.{1,4}/g).join(' ')}\n`)
console.log('Then set in Vercel (Production, Sensitive) and redeploy:\n')
console.log(`  ADMIN_TOTP_SECRET=${secret}\n`)
