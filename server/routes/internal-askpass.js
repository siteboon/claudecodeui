/**
 * Loopback-only endpoint the sudo askpass helper calls to fetch a password.
 *
 * Not behind JWT/api-key: the helper is a short-lived sudo child with no session.
 * It is guarded instead by (a) accepting only loopback connections and (b) a
 * per-run random token issued by registerSudoRun().
 */
import express from 'express';

import { requestSudoPassword } from '../modules/sudo-askpass/sudo-askpass.service.js';

const router = express.Router();

function isLoopback(req) {
  const address = req.socket?.remoteAddress || '';
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

router.post('/', async (req, res) => {
  if (!isLoopback(req)) {
    res.status(403).end();
    return;
  }

  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  if (!token) {
    res.status(401).end();
    return;
  }

  try {
    const password = await requestSudoPassword({ token, prompt });
    res.status(200).type('text/plain').send(password);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('timed out')) {
      res.status(408).end();
    } else if (message.includes('cancelled')) {
      res.status(499).end();
    } else {
      res.status(401).end();
    }
  }
});

export default router;
