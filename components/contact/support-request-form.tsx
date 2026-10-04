'use client'

import { getCountries } from 'libphonenumber-js'
import { Check, ChevronDown, Loader2, Paperclip, X } from 'lucide-react'
import { Link } from '@/components/locale-link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ERROR_TEXT, FIELD, LABEL, PRIMARY_BUTTON } from '@/components/contact/fields'
import { fillCopy, type ContactCopy, type ContactMethod } from '@/lib/contact-copy'
import { useStore } from '@/lib/store'
import {
  ACCEPTED_TYPES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  formatBytes,
  prepareAttachment,
  submitTicket,
} from '@/lib/support/client'
import { SUPPORT_COPY } from '@/lib/support/copy'
import { SUPPORT_CATEGORIES, type SupportCategory } from '@/lib/types'
import { cn } from '@/lib/utils'
import { isValidEmail } from '@/lib/validation'
import { PrivacyNotice } from '@/components/privacy-notice'

type FieldKey = 'name' | 'email' | 'handle' | 'message'

const METHODS: ContactMethod[] = ['email', 'phone', 'telegram']

/**
 * The contact form, inline on /contact (it used to open in a modal, one click
 * further away from the customer who came to write).
 *
 * It files an ordinary support ticket through /api/support/tickets — the same
 * endpoint, rate limit, attachment rules and confirmation emails as the
 * support center — so a request sent from here lands in the same inbox and
 * appears under "My requests" on this device. The form's two extra answers
 * (how to reach the customer, where they ship to) have no columns of their
 * own; they head the message, where the team reads them first.
 */
export function SupportRequestForm({ c, replySpan }: { c: ContactCopy; replySpan: string }) {
  const { locale, currentUser } = useStore()
  const categories = SUPPORT_COPY[locale].categories

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [method, setMethod] = useState<ContactMethod>('email')
  const [handle, setHandle] = useState('')
  const [country, setCountry] = useState('')
  const [category, setCategory] = useState<SupportCategory>('other')
  const [subject, setSubject] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [sending, setSending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState<{ number: string; email: string } | null>(null)

  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    handle: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
  }

  // A signed-in customer's details as a starting point.
  useEffect(() => {
    if (!currentUser) return
    setName((v) => v || currentUser.name || '')
    setEmail((v) => v || currentUser.email || '')
  }, [currentUser])

  // Country names come from Intl.DisplayNames, whose data differs between
  // the server's ICU and the browser's — rendered on the server they made the
  // page fail hydration. The list is built in the browser only; until then
  // the select holds just its empty option.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const countries = useMemo(() => {
    if (!mounted) return []
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      names = null
    }
    return getCountries()
      .map((code) => ({ code, name: names?.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [locale, mounted])

  const emailValid = isValidEmail(email.trim())
  const showEmailState = emailTouched && email.trim().length > 0

  function reset() {
    setName('')
    setEmail('')
    setEmailTouched(false)
    setMethod('email')
    setHandle('')
    setCountry('')
    setCategory('other')
    setSubject('')
    setOrderNumber('')
    setMessage('')
    setFiles([])
    setFileError(null)
    setErrors({})
    setServerError(null)
    setDone(null)
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setFileError(null)
    const picked = Array.from(list)
    if (picked.some((f) => ACCEPTED_TYPES.indexOf(f.type) === -1)) {
      setFileError(c.attachType)
      return
    }
    if (files.length + picked.length > MAX_FILES) {
      setFileError(c.attachTooMany)
      return
    }
    const prepared = await Promise.all(picked.map(prepareAttachment))
    const next = [...files, ...prepared]
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
      setFileError(c.attachTooBig)
      return
    }
    setFiles(next)
  }

  function validate(): Partial<Record<FieldKey, string>> {
    const next: Partial<Record<FieldKey, string>> = {}
    if (!name.trim()) next.name = c.nameMissing
    if (!isValidEmail(email.trim())) next.email = c.emailInvalid
    if (method !== 'email' && !handle.trim()) next.handle = c.handleMissing
    if (!message.trim()) next.message = c.messageMissing
    return next
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending) return
    setEmailTouched(true)
    const found = validate()
    setErrors(found)
    const first = (['name', 'email', 'handle', 'message'] as FieldKey[]).find((k) => found[k])
    if (first) {
      refs[first].current?.focus()
      return
    }

    const countryName = countries.find((x) => x.code === country)?.name
    const order = orderNumber.trim().toUpperCase().slice(0, 40)
    const meta = [
      order ? `${c.metaOrder}: ${order}` : '',
      `${c.metaMethod}: ${c.methods[method]}${method !== 'email' ? ` — ${handle.trim()}` : ''}`,
      countryName ? `${c.metaCountry}: ${countryName}` : '',
    ].filter(Boolean)

    const form = new FormData()
    form.set('category', category)
    form.set('subject', subject.trim() || categories[category])
    form.set('message', `${meta.join('\n')}\n\n${message.trim()}`)
    form.set('locale', locale)
    form.set('name', name.trim())
    form.set('email', email.trim())
    files.forEach((f) => form.append('files', f, f.name))

    setSending(true)
    setServerError(null)
    const r = await submitTicket(form)
    setSending(false)
    if (r.ok) {
      // Signed in, the server replies to the account's address.
      setDone({ number: r.ticket.number, email: currentUser?.email ?? email.trim() })
    } else {
      setServerError(r.status > 0 && r.status < 500 && r.error ? r.error : c.error)
    }
  }

  const describedBy = (key: FieldKey) => (errors[key] ? `contact-${key}-error` : undefined)

  return (
    <div id="request" className="scroll-mt-24 rounded-xl border border-border bg-card/30 px-5 py-8 sm:px-8 sm:py-10">
              {done ? (
                <div role="status" className="py-6">
                  <Check className="size-6 text-foreground" strokeWidth={1.25} aria-hidden />
                  <h2 className="mt-6 font-serif text-[30px] font-normal leading-tight tracking-tight text-foreground">
                    {c.doneTitle}
                  </h2>
                  <p className="mt-3 text-[14px] font-light leading-relaxed text-foreground/70">
                    {fillCopy(c.doneBody, { number: done.number, email: done.email, span: replySpan })}
                  </p>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href={`/support/tickets/${encodeURIComponent(done.number)}`}
                      className={PRIMARY_BUTTON}
                    >
                      {c.doneOpen}
                    </Link>
                    <button
                      type="button"
                      onClick={reset}
                      className="t-cta inline-flex min-h-[48px] items-center justify-center rounded-xl border border-border px-8 text-foreground/[0.85] transition-colors hover:border-gold/60 hover:text-foreground"
                    >
                      {c.sendAnother}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} noValidate aria-labelledby="contact-form-title">
                  <h2 id="contact-form-title" className="font-serif text-[28px] font-normal leading-tight tracking-tight text-foreground sm:text-[30px]">
                    {c.formTitle}
                  </h2>
                  <p className="mt-2 text-[13px] font-light text-foreground/70">
                    {fillCopy(c.formIntro, { span: replySpan })}
                  </p>

                  <div className="mt-8 flex flex-col gap-5">
                    <div>
                      <label htmlFor="contact-name" className={LABEL}>
                        {c.name} <span className="text-foreground/70">· {c.required}</span>
                      </label>
                      <input
                        ref={refs.name}
                        id="contact-name"
                        name="name"
                        autoComplete="name"
                        maxLength={60}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          if (errors.name) setErrors((x) => ({ ...x, name: undefined }))
                        }}
                        aria-invalid={Boolean(errors.name)}
                        aria-describedby={describedBy('name')}
                        className={FIELD}
                      />
                      {errors.name && (
                        <p id="contact-name-error" className={ERROR_TEXT}>
                          {errors.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="contact-email" className={LABEL}>
                        {c.email} <span className="text-foreground/70">· {c.required}</span>
                      </label>
                      <div className="relative">
                        <input
                          ref={refs.email}
                          id="contact-email"
                          name="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          spellCheck={false}
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value)
                            if (errors.email) setErrors((x) => ({ ...x, email: undefined }))
                          }}
                          onBlur={() => setEmailTouched(true)}
                          aria-invalid={Boolean(errors.email) || (showEmailState && !emailValid)}
                          aria-describedby={
                            showEmailState && !emailValid ? 'contact-email-error' : describedBy('email')
                          }
                          className={cn(FIELD, 'pr-11', showEmailState && emailValid && 'border-gold/50')}
                        />
                        {showEmailState && emailValid && (
                          <Check
                            className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-foreground/70"
                            strokeWidth={1.5}
                            aria-label={c.emailValid}
                          />
                        )}
                      </div>
                      {(errors.email || (showEmailState && !emailValid)) && (
                        <p id="contact-email-error" className={ERROR_TEXT}>
                          {c.emailInvalid}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="contact-order" className={LABEL}>
                        {c.orderNumber}
                      </label>
                      <input
                        id="contact-order"
                        name="order"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={40}
                        placeholder={c.orderNumberPh}
                        value={orderNumber}
                        onChange={(e) => setOrderNumber(e.target.value)}
                        className={FIELD}
                      />
                    </div>

                    <div>
                      <label htmlFor="contact-method" className={LABEL}>
                        {c.method}
                      </label>
                      <Select
                        id="contact-method"
                        value={method}
                        onChange={(v) => {
                          setMethod(v as ContactMethod)
                          setErrors((x) => ({ ...x, handle: undefined }))
                        }}
                      >
                        {METHODS.map((m) => (
                          <option key={m} value={m} className="bg-background text-foreground">
                            {c.methods[m]}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {method !== 'email' && (
                      <div>
                        <label htmlFor="contact-handle" className={LABEL}>
                          {method === 'phone' ? c.handlePhone : c.handleTelegram}{' '}
                          <span className="text-foreground/70">· {c.required}</span>
                        </label>
                        <input
                          ref={refs.handle}
                          id="contact-handle"
                          name="handle"
                          type={method === 'phone' ? 'tel' : 'text'}
                          inputMode={method === 'phone' ? 'tel' : 'text'}
                          autoComplete={method === 'phone' ? 'tel' : 'off'}
                          spellCheck={false}
                          placeholder={method === 'phone' ? '+41 …' : '@username'}
                          value={handle}
                          onChange={(e) => {
                            setHandle(e.target.value)
                            if (errors.handle) setErrors((x) => ({ ...x, handle: undefined }))
                          }}
                          aria-invalid={Boolean(errors.handle)}
                          aria-describedby={describedBy('handle')}
                          className={FIELD}
                        />
                        {errors.handle && (
                          <p id="contact-handle-error" className={ERROR_TEXT}>
                            {errors.handle}
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <label htmlFor="contact-country" className={LABEL}>
                        {c.country}
                      </label>
                      <Select id="contact-country" value={country} onChange={setCountry} autoComplete="country">
                        <option value="" className="bg-background text-foreground">
                          {c.countryNone}
                        </option>
                        {countries.map((x) => (
                          <option key={x.code} value={x.code} className="bg-background text-foreground">
                            {x.name}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label htmlFor="contact-type" className={LABEL}>
                        {c.type}
                      </label>
                      <Select id="contact-type" value={category} onChange={(v) => setCategory(v as SupportCategory)}>
                        {SUPPORT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat} className="bg-background text-foreground">
                            {categories[cat]}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <label htmlFor="contact-subject" className={LABEL}>
                        {c.subject}
                      </label>
                      <input
                        id="contact-subject"
                        name="subject"
                        maxLength={150}
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={c.subjectPh}
                        className={FIELD}
                      />
                    </div>

                    <div>
                      <label htmlFor="contact-message" className={LABEL}>
                        {c.message} <span className="text-foreground/70">· {c.required}</span>
                      </label>
                      <textarea
                        ref={refs.message}
                        id="contact-message"
                        name="message"
                        rows={5}
                        maxLength={4800}
                        value={message}
                        onChange={(e) => {
                          setMessage(e.target.value)
                          if (errors.message) setErrors((x) => ({ ...x, message: undefined }))
                        }}
                        placeholder={c.messagePh}
                        aria-invalid={Boolean(errors.message)}
                        aria-describedby={describedBy('message')}
                        className={cn(FIELD, 'resize-y leading-relaxed')}
                      />
                      {errors.message && (
                        <p id="contact-message-error" className={ERROR_TEXT}>
                          {errors.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <span className={LABEL}>{c.attach}</span>
                      <label
                        htmlFor="contact-files"
                        className="flex min-h-[64px] cursor-pointer items-center gap-4 rounded-xl border border-dashed border-border px-4 py-3 transition-colors hover:border-gold/60 focus-within:border-gold/60"
                      >
                        <Paperclip className="size-4 shrink-0 text-foreground/70" strokeWidth={1.25} aria-hidden />
                        <span className="flex flex-col">
                          <span className="text-[13px] text-foreground underline decoration-foreground/30 underline-offset-4">
                            {c.attachChoose}
                          </span>
                          <span className="t-meta mt-0.5 text-foreground/70">{c.attachHint}</span>
                        </span>
                        <input
                          id="contact-files"
                          type="file"
                          multiple
                          accept={ACCEPTED_TYPES.join(',')}
                          className="sr-only"
                          onChange={(e) => {
                            void addFiles(e.target.files)
                            e.target.value = ''
                          }}
                        />
                      </label>
                      {fileError && (
                        <p role="alert" className={ERROR_TEXT}>
                          {fileError}
                        </p>
                      )}
                      {files.length > 0 && (
                        <ul className="mt-3 divide-y divide-border border-y border-border">
                          {files.map((f, i) => (
                            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
                              <span className="min-w-0 truncate text-[13px] font-light text-foreground/[0.85]">{f.name}</span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="t-meta tabular-nums text-foreground/70">{formatBytes(f.size)}</span>
                                <button
                                  type="button"
                                  onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                                  aria-label={`${c.remove}: ${f.name}`}
                                  className="flex size-9 items-center justify-center text-foreground/70 transition-colors hover:text-foreground"
                                >
                                  <X className="size-3.5" strokeWidth={1.5} />
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {serverError && (
                    <p role="alert" className={cn(ERROR_TEXT, 'mt-6')}>
                      {serverError}
                    </p>
                  )}

                  <button type="submit" disabled={sending} className={cn(PRIMARY_BUTTON, 'mt-8 min-h-[52px] w-full')}>
                    {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                    {sending ? c.sending : c.submit}
                  </button>
                  <PrivacyNotice purpose="privacy.support" className="mt-3 text-center" />
                </form>
              )}
    </div>
  )
}

/** A native select in the field treatment, with its own chevron: native for
 *  keyboard and screen-reader behaviour, restyled so every engine matches. */
function Select({
  id,
  value,
  onChange,
  autoComplete,
  children,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={cn(FIELD, 'cursor-pointer appearance-none pr-11')}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-foreground/70"
        strokeWidth={1.25}
        aria-hidden
      />
    </div>
  )
}
