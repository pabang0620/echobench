import { z } from 'zod'

export { ConfigError } from './config.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  return result.data
}

export const idSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/)

export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500
  if (status >= 500) process.stderr.write(`[error] ${err.stack || err.message}\n`)
  res.status(status).json({ success: false, message: status >= 500 && !err.expose ? 'Internal error' : err.message })
}
