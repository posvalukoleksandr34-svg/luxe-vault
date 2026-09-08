import { NextResponse, type NextRequest } from 'next/server'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { validateAddress } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * The customer's address book.
 *
 * Uses the REQUEST-SCOPED Supabase client, not the service-role one. That is
 * the point: every query here runs as the signed-in customer, so the RLS
 * policies in migration 0016 are what decide which rows are visible. A bug in
 * this file cannot hand one customer another's address, because the database
 * would refuse to return it.
 */

type Body = {
  id?: string
  label?: string
  name?: string
  phone?: string
  street?: string
  postalCode?: string
  city?: string
  country?: string
  isDefault?: boolean
}

const MAX_ADDRESSES = 10

function clean(body: Body) {
  return {
    label: (body.label ?? '').trim().slice(0, 40) || null,
    name: (body.name ?? '').trim(),
    phone: (body.phone ?? '').trim(),
    street: (body.street ?? '').trim(),
    postal_code: (body.postalCode ?? '').trim(),
    city: (body.city ?? '').trim(),
    country: (body.country ?? '').trim().toUpperCase(),
  }
}

/** Same rules the checkout form applies, so an address saved from the account
 *  page can never be one checkout would then reject. */
function problemWith(row: ReturnType<typeof clean>): string | null {
  if (row.name.length < 2) return 'Invalid name'
  if (row.phone.length < 4) return 'Invalid phone number'
  if (!/^[A-Z]{2}$/.test(row.country)) return 'Invalid country'

  const errors = validateAddress({
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    country: row.country,
  })
  return errors.length > 0 ? 'Invalid address' : null
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient()
  const { data, error } = await supabase
    .from('addresses')
    .select('id, label, name, phone, street, postal_code, city, country, is_default')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[addresses] read failed:', error.message)
    return NextResponse.json({ error: 'Could not load addresses' }, { status: 500 })
  }

  return NextResponse.json({
    addresses: (data ?? []).map((a) => ({
      id: a.id,
      label: a.label ?? undefined,
      name: a.name,
      phone: a.phone,
      street: a.street,
      postalCode: a.postal_code,
      city: a.city,
      country: a.country,
      isDefault: a.is_default,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const row = clean(body)
  const problem = problemWith(row)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const supabase = createClient()

  // A cap, not because storage is scarce, but because an unbounded list is a
  // worse address picker than a short one.
  const { count } = await supabase
    .from('addresses')
    .select('id', { count: 'exact', head: true })
  if ((count ?? 0) >= MAX_ADDRESSES) {
    return NextResponse.json(
      { error: `You can save up to ${MAX_ADDRESSES} addresses.` },
      { status: 409 },
    )
  }

  const { data, error } = await supabase
    .from('addresses')
    // The first address a customer saves becomes their default; there is
    // nothing else it could be, and asking would be a pointless question.
    .insert({ ...row, user_id: user.id, is_default: (count ?? 0) === 0 })
    .select('id')
    .single()

  if (error) {
    console.error('[addresses] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save the address' }, { status: 500 })
  }

  if (body.isDefault && (count ?? 0) > 0) {
    await supabase.rpc('set_default_address', { p_address_id: data.id })
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'Missing address id' }, { status: 400 })

  const supabase = createClient()

  // Making an existing address the default is its own operation — one RPC that
  // moves the flag atomically, rather than two writes with a window in which
  // the customer has none or two.
  if (body.isDefault && !body.street) {
    const { data, error } = await supabase.rpc('set_default_address', {
      p_address_id: body.id,
    })
    if (error || !data) {
      return NextResponse.json({ error: 'Could not set the default' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  const row = clean(body)
  const problem = problemWith(row)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // No user_id filter: RLS already restricts the update to the caller's own
  // rows, and adding one here would imply it does not.
  const { error } = await supabase.from('addresses').update(row).eq('id', body.id)

  if (error) {
    console.error('[addresses] update failed:', error.message)
    return NextResponse.json({ error: 'Could not update the address' }, { status: 500 })
  }

  if (body.isDefault) {
    await supabase.rpc('set_default_address', { p_address_id: body.id })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing address id' }, { status: 400 })

  const supabase = createClient()
  const { error } = await supabase.from('addresses').delete().eq('id', id)

  if (error) {
    console.error('[addresses] delete failed:', error.message)
    return NextResponse.json({ error: 'Could not delete the address' }, { status: 500 })
  }

  // Deleting the default leaves the book with none. Promoting the newest
  // remaining one means checkout always has something preselected.
  const { data: remaining } = await supabase
    .from('addresses')
    .select('id, is_default')
    .order('created_at', { ascending: false })

  if (remaining?.length && !remaining.some((a) => a.is_default)) {
    await supabase.rpc('set_default_address', { p_address_id: remaining[0].id })
  }

  return NextResponse.json({ ok: true })
}
