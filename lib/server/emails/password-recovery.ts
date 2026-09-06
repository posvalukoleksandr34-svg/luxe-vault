import 'server-only'

import { escapeHtml } from '@/lib/server/resend'
import { C, SANS, SERIF } from './order-confirmation'

/**
 * Password recovery code email, sent through Resend rather than by Supabase.
 *
 * WHY THIS EXISTS. Supabase can send recovery mail itself, and measurement
 * showed the send path works (POST /auth/v1/recover returned 200 in ~1.4s, the
 * latency of a real SMTP handoff). What it cannot guarantee is the *content*:
 * the body comes from a template pasted into the Supabase dashboard, so if
 * that template still ships the stock `{{ .ConfirmationURL }}` the customer
 * gets a link and no code — while this app's UI asks for a six-digit code.
 * Nothing in the codebase can detect or fix that.
 *
 * Owning the template removes the dashboard from the critical path entirely,
 * and puts recovery on exactly the same delivery route as the order receipts
 * that are already proven to arrive.
 */

type Lang = 'ru' | 'en' | 'it' | 'fr' | 'de'

const COPY: Record<Lang, {
  subject: string
  heading: string
  intro: string
  codeLabel: string
  ignore: string
  help: string
  footer: string
}> = {
  ru: {
    subject: 'Код для восстановления пароля — Luxe Vault',
    heading: 'Восстановление пароля',
    intro:
      'Введите код ниже, чтобы задать новый пароль. Код действует один час и используется один раз.',
    codeLabel: 'Код восстановления',
    ignore: 'Если вы не запрашивали смену пароля, просто проигнорируйте это письмо — пароль останется прежним.',
    help: 'Нужна помощь?',
    footer: 'Это письмо отправлено автоматически.',
  },
  en: {
    subject: 'Your password reset code — Luxe Vault',
    heading: 'Reset your password',
    intro:
      'Enter the code below to set a new password. It is valid for one hour and can be used once.',
    codeLabel: 'Recovery code',
    ignore: 'If you did not ask to reset your password, ignore this email — nothing will change.',
    help: 'Need help?',
    footer: 'This message was sent automatically.',
  },
  it: {
    subject: 'Codice di recupero password — Luxe Vault',
    heading: 'Reimposta la password',
    intro:
      'Inserisci il codice qui sotto per impostare una nuova password. È valido per un’ora e può essere usato una sola volta.',
    codeLabel: 'Codice di recupero',
    ignore: 'Se non hai richiesto il reset, ignora questa email: nulla cambierà.',
    help: 'Hai bisogno di aiuto?',
    footer: 'Messaggio inviato automaticamente.',
  },
  fr: {
    subject: 'Votre code de réinitialisation — Luxe Vault',
    heading: 'Réinitialiser le mot de passe',
    intro:
      'Saisissez le code ci-dessous pour définir un nouveau mot de passe. Il est valable une heure et à usage unique.',
    codeLabel: 'Code de récupération',
    ignore: 'Si vous n’avez pas demandé cette réinitialisation, ignorez cet e-mail : rien ne changera.',
    help: 'Besoin d’aide ?',
    footer: 'Message envoyé automatiquement.',
  },
  de: {
    subject: 'Ihr Code zum Zurücksetzen — Luxe Vault',
    heading: 'Passwort zurücksetzen',
    intro:
      'Geben Sie den folgenden Code ein, um ein neues Passwort zu setzen. Er ist eine Stunde gültig und einmal verwendbar.',
    codeLabel: 'Wiederherstellungscode',
    ignore: 'Falls Sie kein Zurücksetzen angefordert haben, ignorieren Sie diese E-Mail — es ändert sich nichts.',
    help: 'Brauchen Sie Hilfe?',
    footer: 'Diese Nachricht wurde automatisch gesendet.',
  },
}

/** Falls back to English for an account created before language was recorded. */
export function recoveryLang(raw: unknown): Lang {
  const v = String(raw ?? '').toLowerCase()
  return (['ru', 'en', 'it', 'fr', 'de'] as const).includes(v as Lang) ? (v as Lang) : 'en'
}

export function passwordRecoverySubject(lang: Lang): string {
  return COPY[lang].subject
}

export function passwordRecoveryText(code: string, lang: Lang): string {
  const c = COPY[lang]
  return [
    'LUXE VAULT',
    '',
    c.heading,
    c.intro,
    '',
    `${c.codeLabel}: ${code}`,
    '',
    c.ignore,
    '',
    `${c.help} support@luxe-vault.store`,
  ].join('\n')
}

export function passwordRecoveryHtml(code: string, lang: Lang): string {
  const c = COPY[lang]

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(c.subject)}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .lv-shell { padding: 20px 12px !important; }
        .lv-pad   { padding-left: 22px !important; padding-right: 22px !important; }
        .lv-code  { font-size: 30px !important; letter-spacing: 8px !important; }
      }
      /* Stop iOS and Gmail auto-linking the digits as a phone number. */
      .lv-code a { color: ${C.heading} !important; text-decoration: none !important; }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:${C.bg}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
    <div style="display:none; font-size:1px; color:${C.bg}; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      ${escapeHtml(c.codeLabel)}: ${escapeHtml(code)}
      &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};">
      <tr>
        <td align="center" class="lv-shell" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; width:100%; background-color:${C.card}; border:1px solid ${C.border};">

            <tr>
              <td class="lv-pad" style="padding:28px 32px 20px 32px; border-bottom:1px solid ${C.border};">
                <span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:4px; color:${C.heading};">LUXE</span><span style="font-family:${SANS}; font-size:15px; font-weight:bold; letter-spacing:4px; color:${C.gold};">VAULT</span>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:30px 32px 0 32px;">
                <h1 style="margin:0 0 14px 0; font-family:${SERIF}; font-size:22px; font-weight:normal; color:${C.heading};">
                  ${escapeHtml(c.heading)}
                </h1>
                <p style="margin:0; font-family:${SANS}; font-size:14px; line-height:24px; color:${C.body};">
                  ${escapeHtml(c.intro)}
                </p>
              </td>
            </tr>

            <!-- No action link, deliberately. Mail scanners (Outlook Safe
                 Links, corporate gateways) fetch links on delivery, which
                 would consume a one-time token before the customer ever sees
                 it — they then get "invalid or expired" for a code no human
                 ever used. A code cannot be prefetched. -->
            <tr>
              <td class="lv-pad" style="padding:26px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.inset}; border:1px solid ${C.gold};">
                  <tr>
                    <td align="center" style="padding:22px 16px 20px 16px;">
                      <p style="margin:0 0 12px 0; font-family:${SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.muted};">
                        ${escapeHtml(c.codeLabel)}
                      </p>
                      <div class="lv-code" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace; font-size:38px; line-height:46px; font-weight:bold; letter-spacing:12px; color:${C.heading}; -webkit-user-select:all; user-select:all;">
                        ${escapeHtml(code)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:24px 32px 0 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:22px; color:${C.muted};">
                  ${escapeHtml(c.ignore)}
                </p>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:22px 32px 30px 32px;">
                <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:22px; color:${C.muted};">
                  ${escapeHtml(c.help)}
                  <a href="mailto:support@luxe-vault.store" style="color:${C.gold}; text-decoration:none;">support@luxe-vault.store</a>
                </p>
              </td>
            </tr>

            <tr>
              <td class="lv-pad" style="padding:16px 32px; border-top:1px solid ${C.border};">
                <p style="margin:0; font-family:${SANS}; font-size:11px; line-height:18px; color:${C.faint};">
                  ${escapeHtml(c.footer)}
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
