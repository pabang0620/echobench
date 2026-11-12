import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from './config.js'
import { errorHandler } from './http.js'
import { accessGuard } from './access.js'
import { visitorSession } from './visitors.js'
import { hooksRouter } from './routes/hooks.js'
import { apiRouter } from './routes/api.js'

export function createApp(lab) {
  const app = express()
  app.disable('x-powered-by')
  app.use(accessGuard(lab.cfg.accessToken))
  app.use(hooksRouter(lab))
  app.use('/api', visitorSession(), express.json({ limit: '256kb' }), apiRouter(lab))
  const dist = path.join(APP_ROOT, 'dist')
  if (existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^\/(?!api|hooks|rec|forge).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
  app.use(errorHandler)
  return app
}
