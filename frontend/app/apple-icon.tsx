import { ImageResponse } from 'next/og'

// iOS ignores SVG icons when adding a site to the home screen, so render the
// same mark as app/icon.svg to a PNG at build time.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: '#09090b',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 37,
            top: 37,
            width: 68,
            height: 68,
            border: '11px solid #f4f4f5',
            borderRadius: 11,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 76,
            top: 76,
            width: 68,
            height: 68,
            background: '#f4f4f5',
            borderRadius: 11,
          }}
        />
      </div>
    ),
    size
  )
}
