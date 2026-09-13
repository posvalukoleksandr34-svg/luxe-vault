import 'server-only'

import { L, esc, paragraphSection, renderEmail } from './layout'

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
 * and puts recovery on exactly the same delivery route (and the same light
 * layout) as the order emails.
 */

type Lang = 'ru' | 'en' | 'it' | 'fr' | 'de'

const COPY: Record<Lang, {
  subject: string
  heading: string
  intro: string
  codeLabel: string
  ignore: string
}> = {
  ru: {
    subject: 'Код для восстановления пароля — Luxe Vault',
    heading: 'Восстановление пароля',
    intro:
      'Введите код ниже, чтобы задать новый пароль. Код действует один час и используется один раз.',
    codeLabel: 'Код восстановления',
    ignore: 'Если вы не запрашивали смену пароля, просто проигнорируйте это письмо — пароль останется прежним.',
  },
  en: {
    subject: 'Your password reset code — Luxe Vault',
    heading: 'Reset your password',
    intro:
      'Enter the code below to set a new password. It is valid for one hour and can be used once.',
    codeLabel: 'Recovery code',
    ignore: 'If you did not ask to reset your password, ignore this email — nothing will change.',
  },
  it: {
    subject: 'Codice di recupero password — Luxe Vault',
    heading: 'Reimposta la password',
    intro:
      'Inserisci il codice qui sotto per impostare una nuova password. È valido per un’ora e può essere usato una sola volta.',
    codeLabel: 'Codice di recupero',
    ignore: 'Se non hai richiesto il reset, ignora questa email: nulla cambierà.',
  },
  fr: {
    subject: 'Votre code de réinitialisation — Luxe Vault',
    heading: 'Réinitialiser le mot de passe',
    intro:
      'Saisissez le code ci-dessous pour définir un nouveau mot de passe. Il est valable une heure et à usage unique.',
    codeLabel: 'Code de récupération',
    ignore: 'Si vous n’avez pas demandé cette réinitialisation, ignorez cet e-mail : rien ne changera.',
  },
  de: {
    subject: 'Ihr Code zum Zurücksetzen — Luxe Vault',
    heading: 'Passwort zurücksetzen',
    intro:
      'Geben Sie den folgenden Code ein, um ein neues Passwort zu setzen. Er ist eine Stunde gültig und einmal verwendbar.',
    codeLabel: 'Wiederherstellungscode',
    ignore: 'Falls Sie kein Zurücksetzen angefordert haben, ignorieren Sie diese E-Mail — es ändert sich nichts.',
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
  return ['LUXE VAULT', '', c.heading, c.intro, '', `${c.codeLabel}: ${code}`, '', c.ignore, '', 'support@luxe-vault.store'].join('\n')
}

/**
 * No action link, deliberately. Mail scanners (Outlook Safe Links, corporate
 * gateways) fetch links on delivery, which would consume a one-time token
 * before the customer ever sees it. A code cannot be prefetched.
 */
export function passwordRecoveryHtml(code: string, lang: Lang): string {
  const c = COPY[lang]
  const codeBox = `
    <tr>
      <td class="lv-pad" style="padding:26px 36px 0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid ${L.rule}; background:${L.inset};">
          <tr>
            <td align="center" style="padding:22px 16px 20px 16px;">
              <p style="margin:0 0 10px 0; font-family:Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${L.muted};">${esc(c.codeLabel)}</p>
              <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace; font-size:34px; line-height:42px; font-weight:bold; letter-spacing:10px; color:${L.heading}; -webkit-user-select:all; user-select:all;">${esc(code)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`

  return renderEmail({
    lang,
    subject: c.subject,
    preheader: `${c.codeLabel}: ${code}`,
    heading: c.heading,
    intro: c.intro,
    sections: [codeBox, paragraphSection(c.ignore, true)],
    cta: null,
  })
}
