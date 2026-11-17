import { handleMcp } from '@/src/mcp/http'

const handle = (req: Request) => handleMcp(req, process.env.WALLET_MCP_TOKEN)

export const GET = handle
export const POST = handle
export const DELETE = handle
