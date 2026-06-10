/**
 * routes/health.ts — GET /api/health (Contract §6).
 *
 * Liveness probe consumed by the docker-compose healthcheck
 * (`wget -q -O /dev/null http://127.0.0.1:8080/api/health`). Responds
 * `{ status: 'ok', uptime_secs }` — uptime reported in metric SI seconds,
 * floored to a whole number.
 */
import express from 'express';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptime_secs: Math.floor(process.uptime()), // process uptime in SI seconds
  });
});

export default router;
