import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils.js';
import { query } from '../db.js';
import { parse, schemas } from '../utils.js';
import { recordHistory } from './searchHistory.js';
import { LOCAL_SEARCH_LIMIT, escapeLike, filterMovies, mergeMovies, sortMovies } from '../services/tmdb.js';

const LISTS = {
  popular: 'popular',
  trending: 'trending',
  'top-rated': 'topRated',
  upcoming: 'upcoming',
  'now-playing': 'nowPlaying',
};

export function createMoviesController({ tmdb, movies }) {
  /** État de l'utilisateur connecté pour un film (favori, à voir, vu, son avis). */
  async function userState(userId, externalId) {
    const { rows } = await query(
      `SELECT
         EXISTS (SELECT 1 FROM favorites f JOIN movies m ON m.id = f.movie_id WHERE f.user_id = $1 AND m.external_id = $2) AS favorite,
         EXISTS (SELECT 1 FROM watchlist w JOIN movies m ON m.id = w.movie_id WHERE w.user_id = $1 AND m.external_id = $2) AS watchlist,
         EXISTS (SELECT 1 FROM watch_history h JOIN movies m ON m.id = h.movie_id WHERE h.user_id = $1 AND m.external_id = $2) AS watched,
         (SELECT r.id FROM reviews r JOIN movies m ON m.id = r.movie_id WHERE r.user_id = $1 AND m.external_id = $2) AS review_id`,
      [userId, externalId],
    );
    const r = rows[0];
    return { favorite: r.favorite, watchlist: r.watchlist, watched: r.watched, reviewId: r.review_id };
  }

  return {
    list: (name) => async (req, res) => {
      const { page } = parse(schemas.pageQuery, req.query);
      const data = await tmdb.list(LISTS[name], page);
      movies.cacheSummaries(data.results);
      res.json(data);
    },

    async discover(req, res) {
      const filters = parse(schemas.discoverQuery, req.query);
      const data = await tmdb.discover(filters);
      movies.cacheSummaries(data.results);
      res.json(data);
    },

    async details(req, res) {
      const { id } = parse(schemas.movieParam, req.params);
      const movie = await movies.getMovieDetails(id);
      const state = req.user ? await userState(req.user.id, id) : null;
      res.json({ movie, userState: state });
    },

    async similar(req, res) {
      const { id } = parse(schemas.movieParam, req.params);
      const data = await tmdb.similar(id);
      movies.cacheSummaries(data.results);
      res.json({ results: data.results.slice(0, 12) });
    },
  };
}

export function createGenresController({ tmdb, movies }) {
  return {
    async list(_req, res) {
      res.json({ results: await movies.getGenres() });
    },

    async moviesByGenre(req, res) {
      const { id } = parse(schemas.movieParam, req.params);
      const { page, sort } = parse(schemas.discoverQuery, req.query);
      const data = await tmdb.discover({ page, genre: id, sort });
      movies.cacheSummaries(data.results);
      res.json(data);
    },
  };
}

export function createSearchController({ tmdb, movies }) {
  return {
    /**
     * Page 1 : PostgreSQL d'abord ; si moins de 20 résultats locaux, on complète avec l'API externe.
     * Pages suivantes : API externe (seule à connaître le catalogue complet).
     */
    async search(req, res) {
      const { q, page, genre, year, sort } = parse(schemas.searchQuery, req.query);

      let local = [];
      if (page === 1) local = await movies.searchLocal(q, LOCAL_SEARCH_LIMIT, escapeLike);

      let remote = { results: [], totalPages: 1, totalResults: local.length };
      if (page > 1 || local.length < LOCAL_SEARCH_LIMIT) {
        remote = await tmdb.search({ q, page, year });
        movies.cacheSummaries(remote.results);
      }

      const merged = mergeMovies(local, remote.results);
      const results = sortMovies(filterMovies(merged, { genre, year }), sort);

      if (req.user && page === 1) recordHistory(req.user.id, q).catch((e) => console.error('[db] historique :', e.message));

      res.json({
        results,
        page,
        totalPages: remote.totalPages,
        totalResults: Math.max(remote.totalResults, results.length),
        source: remote.results.length ? (local.length ? 'mixed' : 'external') : 'local',
      });
    },

  };
}

export function movieRoutes({ config, tmdb, movies }) {
  const router = Router();
  const maybeAuth = optionalAuth(config);
  const moviesCtl = createMoviesController({ tmdb, movies });
  const searchCtl = createSearchController({ tmdb, movies });
  const genresCtl = createGenresController({ tmdb, movies });

  // Les routes statiques doivent précéder /movies/:id
  router.get('/movies', h(moviesCtl.discover));
  router.get('/movies/popular', h(moviesCtl.list('popular')));
  router.get('/movies/trending', h(moviesCtl.list('trending')));
  router.get('/movies/top-rated', h(moviesCtl.list('top-rated')));
  router.get('/movies/upcoming', h(moviesCtl.list('upcoming')));
  router.get('/movies/now-playing', h(moviesCtl.list('now-playing')));
  router.get('/movies/:id', maybeAuth, h(moviesCtl.details));
  router.get('/movies/:id/similar', h(moviesCtl.similar));

  router.get('/search', maybeAuth, h(searchCtl.search));

  router.get('/genres', h(genresCtl.list));
  router.get('/genres/:id/movies', h(genresCtl.moviesByGenre));
  return router;
}
