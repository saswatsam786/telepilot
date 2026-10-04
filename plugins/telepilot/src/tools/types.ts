export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type ToolResult = { content: Content[]; isError?: boolean }

export type Tool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, any>) => Promise<ToolResult>
}

export const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] })
export const json = (o: unknown): ToolResult => text(JSON.stringify(o, null, 2))
export const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true })

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
export const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
