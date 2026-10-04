import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils.js';

const HISTORY_LIMIT = 20;

/** Enregistre une recherche (sans doublon consécutif) et plafonne l'historique à 20 entrées. */
export async function recordHistory(userId, q) {
  await query(
    `INSERT INTO search_history (user_id, query)
     SELECT $1::bigint, $2::text WHERE COALESCE(
       (SELECT lower(query) FROM search_history WHERE user_id = $1::bigint ORDER BY created_at DESC, id DESC LIMIT 1), ''
     ) <> lower($2::text)`,
    [userId, q],
  );
  await query(
    `DELETE FROM search_history WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM search_history WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
    [userId, HISTORY_LIMIT],
  );
}

export function searchHistoryRoutes({ config }) {
  const router = Router();
  const auth = requireAuth(config);

  router.get('/search/history', auth, h(async (req, res) => {
    const { rows } = await query(
      'SELECT id, query, created_at FROM search_history WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
      [req.user.id, HISTORY_LIMIT],
    );
    res.json({ results: rows.map((r) => ({ id: r.id, query: r.query, createdAt: r.created_at })) });
  }));

  router.delete('/search/history', auth, h(async (req, res) => {
    await query('DELETE FROM search_history WHERE user_id = $1', [req.user.id]);
    res.status(204).end();
  }));

  return router;
}
