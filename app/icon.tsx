import { ImageResponse } from 'next/server'

export const runtime = 'edge'
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

/**
 * File-based favicon — Next.js serves this automatically at /icon and
 * links it from <head> for every page, so no separate favicon.ico asset
 * needs to be maintained by hand.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          color: '#d4af37',
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        LV
      </div>
    ),
    { ...size },
  )
}
