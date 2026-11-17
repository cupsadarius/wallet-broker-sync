import { ImageResponse } from 'next/og'

const SIZES = new Set([180, 192, 512])

export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const size = Number((await ctx.params).size)
  if (!SIZES.has(size)) return new Response('not found', { status: 404 })
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f1115', color: '#8ab4f8', fontSize: size * 0.55, fontWeight: 700,
      }}>
        W
      </div>
    ),
    { width: size, height: size },
  )
}
