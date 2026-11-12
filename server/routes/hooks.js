import express from 'express'
import { attackerCertPem } from '../scenarios/forge.js'
import { parse } from '../http.js'
import { z } from 'zod'

// PayPal posts here. The answer is always 2xx: PayPal does not resend pending notifications,
// and what the target answers is recorded separately, never passed back to PayPal.
export function hooksRouter(lab) {
  const router = express.Router()

  router.post('/hooks/paypal', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const outcome = lab.recorder.ingest(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers)
    res.status(200).json({ received: true, stored: outcome.stored })
  })

  // The buyer's return URL goes through here while recording, so start point SP0 is saved first.
  router.get('/rec/return', async (req, res, next) => {
    try {
      const { token } = parse(z.object({ token: z.string().min(1) }), req.query)
      const result = await lab.recorder.markReturn(token)
      res.status(result.status).json(result.body)
    } catch (err) {
      next(err)
    }
  })

  // The attacker's certificate for scenario S6. A handler that downloads whatever cert_url says would trust it.
  router.get('/forge/cert.pem', (_req, res) => {
    res.type('application/x-pem-file').send(attackerCertPem())
  })

  return router
}
