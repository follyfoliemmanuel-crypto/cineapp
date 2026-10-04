import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils.js';
import { query } from '../db.js';
import { MOVIE_SELECT, rowToSummary } from '../services/tmdb.js';
import { conflict, notFound, parse, schemas } from '../utils.js';

const LIST_PAGE_SIZE = 20;

/**
 * Les trois listes personnelles (favoris, à voir, vus) ont la même forme :
 * (user_id, movie_id, <colonne de date>). Les noms de table/colonne viennent de constantes
 * ci-dessous, jamais de la requête : aucune injection possible.
 */
export const COLLECTIONS = {
  favorites: { table: 'favorites', dateColumn: 'created_at' },
  watchlist: { table: 'watchlist', dateColumn: 'created_at' },
  watchHistory: { table: 'watch_history', dateColumn: 'watched_at' },
};

export function createCollectionController(name, { movies }) {
  const { table, dateColumn } = COLLECTIONS[name];

  return {
    async list(req, res) {
      const { page } = parse(schemas.pageQuery, req.query);
      const [{ rows }, { rows: count }] = await Promise.all([
        query(
          `SELECT ${MOVIE_SELECT}, c.${dateColumn} AS added_at
           FROM ${table} c JOIN movies m ON m.id = c.movie_id
           WHERE c.user_id = $1 ORDER BY c.${dateColumn} DESC, c.id DESC LIMIT $2 OFFSET $3`,
          [req.user.id, LIST_PAGE_SIZE, (page - 1) * LIST_PAGE_SIZE],
        ),
        query(`SELECT count(*)::int AS total FROM ${table} WHERE user_id = $1`, [req.user.id]),
      ]);
      const total = count[0].total;
      res.json({
        results: rows.map((r) => ({ ...rowToSummary(r), addedAt: r.added_at })),
        page,
        totalPages: Math.max(1, Math.ceil(total / LIST_PAGE_SIZE)),
        totalResults: total,
      });
    },

    async add(req, res) {
      const { movieId } = parse(schemas.movieBody, req.body);
      const internalId = await movies.ensureMovie(movieId);
      const { rowCount } = await query(
        `INSERT INTO ${table} (user_id, movie_id) VALUES ($1, $2) ON CONFLICT (user_id, movie_id) DO NOTHING`,
        [req.user.id, internalId],
      );
      res.status(rowCount ? 201 : 200).json({ movieId, added: rowCount > 0 });
    },

    async remove(req, res) {
      const { movieId } = parse(schemas.movieIdParam, req.params);
      await query(
        `DELETE FROM ${table} t USING movies m WHERE t.movie_id = m.id AND m.external_id = $2 AND t.user_id = $1`,
        [req.user.id, movieId],
      );
      res.status(204).end();
    },
  };
}

/** Ids TMDB des films présents dans chaque liste : sert à afficher l'état des boutons dans les cartes. */
export async function libraryIds(req, res) {
  const ids = async (table) =>
    (
      await query(
        `SELECT m.external_id FROM ${table} t JOIN movies m ON m.id = t.movie_id WHERE t.user_id = $1`,
        [req.user.id],
      )
    ).rows.map((r) => r.external_id);

  const [favorites, watchlist, watched] = await Promise.all([
    ids(COLLECTIONS.favorites.table),
    ids(COLLECTIONS.watchlist.table),
    ids(COLLECTIONS.watchHistory.table),
  ]);
  res.json({ favorites, watchlist, watched });
}

const REVIEWS_PAGE_SIZE = 10;

const rowToReview = (r) => ({
  id: r.id,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  user: { id: r.user_id, username: r.username, avatarUrl: r.avatar_url },
  ...(r.movie_external_id
    ? {
        movie: {
          id: r.movie_external_id,
          title: r.movie_title,
          posterPath: r.poster_path,
          releaseDate: r.release_date,
        },
      }
    : {}),
});

const REVIEW_SELECT = `
  r.id, r.rating, r.comment, r.created_at, r.updated_at, r.user_id, u.username, u.avatar_url`;

export function createReviewsController({ movies }) {
  async function loadReview(id) {
    const { rows } = await query(
      `SELECT ${REVIEW_SELECT} FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.id = $1`,
      [id],
    );
    return rows[0];
  }

  return {
    async listForMovie(req, res) {
      const { id } = parse(schemas.movieParam, req.params);
      const { page } = parse(schemas.pageQuery, req.query);
      const [{ rows }, { rows: stats }] = await Promise.all([
        query(
          `SELECT ${REVIEW_SELECT} FROM reviews r
           JOIN movies m ON m.id = r.movie_id JOIN users u ON u.id = r.user_id
           WHERE m.external_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
          [id, REVIEWS_PAGE_SIZE, (page - 1) * REVIEWS_PAGE_SIZE],
        ),
        query(
          `SELECT count(*)::int AS total, round(avg(r.rating), 1) AS average
           FROM reviews r JOIN movies m ON m.id = r.movie_id WHERE m.external_id = $1`,
          [id],
        ),
      ]);
      const total = stats[0].total;
      let mine = null;
      if (req.user) {
        const { rows: own } = await query(
          `SELECT ${REVIEW_SELECT} FROM reviews r
           JOIN movies m ON m.id = r.movie_id JOIN users u ON u.id = r.user_id
           WHERE m.external_id = $1 AND r.user_id = $2`,
          [id, req.user.id],
        );
        mine = own[0] ? rowToReview(own[0]) : null;
      }
      res.json({
        results: rows.map(rowToReview),
        mine,
        page,
        totalPages: Math.max(1, Math.ceil(total / REVIEWS_PAGE_SIZE)),
        totalResults: total,
        average: stats[0].average === null ? null : Number(stats[0].average),
      });
    },

    async create(req, res) {
      const { id } = parse(schemas.movieParam, req.params);
      const { rating, comment } = parse(schemas.reviewBody, req.body);
      const movieId = await movies.ensureMovie(id);
      try {
        const { rows } = await query(
          'INSERT INTO reviews (user_id, movie_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING id',
          [req.user.id, movieId, rating, comment || null],
        );
        res.status(201).json({ review: rowToReview(await loadReview(rows[0].id)) });
      } catch (err) {
        if (err.code === '23505') throw conflict('Tu as déjà publié un avis pour ce film. Modifie-le plutôt.');
        throw err;
      }
    },

    async update(req, res) {
      const { id } = parse(schemas.idParam, req.params);
      const { rating, comment } = parse(schemas.reviewBody, req.body);
      // Le filtre user_id fait office de contrôle de propriété : l'avis d'un autre est « introuvable »
      const { rowCount } = await query(
        'UPDATE reviews SET rating = $1, comment = $2 WHERE id = $3 AND user_id = $4',
        [rating, comment || null, id, req.user.id],
      );
      if (!rowCount) throw notFound('Avis introuvable.');
      res.json({ review: rowToReview(await loadReview(id)) });
    },

    async remove(req, res) {
      const { id } = parse(schemas.idParam, req.params);
      const { rowCount } = await query('DELETE FROM reviews WHERE id = $1 AND user_id = $2', [id, req.user.id]);
      if (!rowCount) throw notFound('Avis introuvable.');
      res.status(204).end();
    },

    async mine(req, res) {
      const { page } = parse(schemas.pageQuery, req.query);
      const [{ rows }, { rows: count }] = await Promise.all([
        query(
          `SELECT ${REVIEW_SELECT}, m.external_id AS movie_external_id, m.title AS movie_title,
                  m.poster_path, to_char(m.release_date, 'YYYY-MM-DD') AS release_date
           FROM reviews r JOIN movies m ON m.id = r.movie_id JOIN users u ON u.id = r.user_id
           WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
          [req.user.id, REVIEWS_PAGE_SIZE, (page - 1) * REVIEWS_PAGE_SIZE],
        ),
        query('SELECT count(*)::int AS total FROM reviews WHERE user_id = $1', [req.user.id]),
      ]);
      res.json({
        results: rows.map(rowToReview),
        page,
        totalPages: Math.max(1, Math.ceil(count[0].total / REVIEWS_PAGE_SIZE)),
        totalResults: count[0].total,
      });
    },
  };
}

/** Espace utilisateur : favoris, à voir, films vus, et avis. */
export function listRoutes({ config, movies }) {
  const router = Router();
  const auth = requireAuth(config);
  const maybeAuth = optionalAuth(config);
  const reviews = createReviewsController({ movies });

  router.get('/library/ids', auth, h(libraryIds));
  const mounts = { favorites: 'favorites', watchlist: 'watchlist', 'watch-history': 'watchHistory' };
  for (const [path, name] of Object.entries(mounts)) {
    const ctl = createCollectionController(name, { movies });
    router.get(`/${path}`, auth, h(ctl.list));
    router.post(`/${path}`, auth, h(ctl.add));
    router.delete(`/${path}/:movieId`, auth, h(ctl.remove));
  }

  router.get('/movies/:id/reviews', maybeAuth, h(reviews.listForMovie));
  router.post('/movies/:id/reviews', auth, h(reviews.create));
  router.get('/reviews/mine', auth, h(reviews.mine));
  router.put('/reviews/:id', auth, h(reviews.update));
  router.delete('/reviews/:id', auth, h(reviews.remove));
  return router;
}
