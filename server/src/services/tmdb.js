import { notFound, upstream } from '../utils.js';
import { query, withTransaction } from '../db.js';

const IMAGE_PATH = /^\/[\w.-]+\.(jpg|jpeg|png|webp)$/i;
const safeImage = (p) => (typeof p === 'string' && IMAGE_PATH.test(p) ? p : null);
const safeDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Résumé d'un film tel que renvoyé par les listes TMDB (popular, search, discover…). */
export function mapMovieSummary(raw) {
  return {
    id: Number(raw.id),
    title: text(raw.title) ?? text(raw.original_title) ?? 'Sans titre',
    originalTitle: text(raw.original_title),
    overview: text(raw.overview),
    posterPath: safeImage(raw.poster_path),
    backdropPath: safeImage(raw.backdrop_path),
    releaseDate: safeDate(raw.release_date),
    voteAverage: Math.round(num(raw.vote_average) * 10) / 10,
    voteCount: Math.trunc(num(raw.vote_count)),
    originalLanguage: text(raw.original_language),
    genreIds: Array.isArray(raw.genre_ids) ? raw.genre_ids.map(Number).filter(Number.isInteger) : [],
  };
}

const CAST_LIMIT = 12;

/** Fiche détaillée (/movie/{id}?append_to_response=credits). */
export function mapMovieDetails(raw) {
  const credits = raw.credits ?? {};
  const director = (credits.crew ?? []).find((c) => c.job === 'Director');
  return {
    ...mapMovieSummary(raw),
    tagline: text(raw.tagline),
    runtime: Number.isInteger(raw.runtime) && raw.runtime > 0 ? raw.runtime : null,
    director: text(director?.name),
    countries: (raw.production_countries ?? []).map((c) => text(c.name)).filter(Boolean),
    genres: (raw.genres ?? [])
      .filter((g) => Number.isInteger(g.id) && text(g.name))
      .map((g) => ({ id: g.id, name: g.name.trim() })),
    cast: (credits.cast ?? []).slice(0, CAST_LIMIT).map((c, i) => ({
      personId: Number(c.id),
      name: text(c.name) ?? 'Inconnu',
      character: text(c.character),
      profilePath: safeImage(c.profile_path),
      department: text(c.known_for_department),
      order: Number.isInteger(c.order) ? c.order : i,
    })),
  };
}

/**
 * Client TMDB : timeout, cache mémoire à durée de vie courte, gestion d'erreurs.
 * La clé API ne quitte jamais le serveur et n'est jamais journalisée.
 */
export function createTmdbClient({ apiKey, baseUrl }, { fetchImpl = fetch, timeoutMs = 8000, maxCache = 500 } = {}) {
  const cache = new Map();
  // Un jeton v4 est un long JWT ; une clé v3 fait 32 caractères.
  const useBearer = apiKey.length > 40;

  async function request(path, params = {}, { ttlMs = 10 * 60 * 1000 } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set('language', 'fr-FR');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.sort();
    const cacheKey = url.pathname + url.search;

    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.data;

    if (!useBearer) url.searchParams.set('api_key', apiKey);
    const headers = { Accept: 'application/json' };
    if (useBearer) headers.Authorization = `Bearer ${apiKey}`;

    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      console.error(`[tmdb] réseau/timeout sur ${path} : ${err.name}`);
      throw upstream();
    }

    if (response.status === 404) throw notFound('Film introuvable.');
    if (!response.ok) {
      console.error(`[tmdb] HTTP ${response.status} sur ${path}`);
      throw upstream();
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw upstream();
    }

    if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { data, expires: Date.now() + ttlMs });
    return data;
  }

  const toPage = (data) => ({
    results: (data.results ?? []).filter((m) => Number.isInteger(m.id)).map(mapMovieSummary),
    page: num(data.page, 1),
    totalPages: Math.min(num(data.total_pages, 1), 500),
    totalResults: num(data.total_results, 0),
  });

  return {
    list: async (kind, page = 1) => {
      const paths = {
        popular: '/movie/popular',
        trending: '/trending/movie/week',
        topRated: '/movie/top_rated',
        upcoming: '/movie/upcoming',
        nowPlaying: '/movie/now_playing',
      };
      if (!paths[kind]) throw new Error(`Liste inconnue : ${kind}`);
      return toPage(await request(paths[kind], { page }));
    },
    search: async ({ q, page = 1, year }) =>
      toPage(await request('/search/movie', { query: q, page, year, include_adult: false }, { ttlMs: 2 * 60 * 1000 })),
    discover: async ({ page = 1, genre, year, sort = 'popularity' }) => {
      const sortBy = {
        popularity: 'popularity.desc',
        rating: 'vote_average.desc',
        date: 'primary_release_date.desc',
        title: 'original_title.asc',
      }[sort];
      const today = new Date().toISOString().slice(0, 10);
      return toPage(
        await request('/discover/movie', {
          page,
          sort_by: sortBy,
          with_genres: genre,
          primary_release_year: year,
          include_adult: false,
          // Évite les films sans votes en tête du classement par note, et les sorties futures en tête par date
          'vote_count.gte': sort === 'rating' ? 300 : undefined,
          'primary_release_date.lte': sort === 'date' ? today : undefined,
        }),
      );
    },
    details: async (id) => mapMovieDetails(await request(`/movie/${id}`, { append_to_response: 'credits' }, { ttlMs: 60 * 60 * 1000 })),
    similar: async (id) => toPage(await request(`/movie/${id}/similar`, { page: 1 }, { ttlMs: 60 * 60 * 1000 })),
    genres: async () =>
      ((await request('/genre/movie/list', {}, { ttlMs: 24 * 60 * 60 * 1000 })).genres ?? []).filter(
        (g) => Number.isInteger(g.id) && text(g.name),
      ),
  };
}

export const LOCAL_SEARCH_LIMIT = 20;

/** Fusionne deux listes de films (dédoublonnage par id, la première liste a la priorité). */
export function mergeMovies(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const movie of [...primary, ...secondary]) {
    if (seen.has(movie.id)) continue;
    seen.add(movie.id);
    merged.push(movie);
  }
  return merged;
}

export function filterMovies(movies, { genre, year } = {}) {
  return movies.filter((m) => {
    if (genre && !(m.genreIds ?? []).includes(genre)) return false;
    if (year && !(m.releaseDate && m.releaseDate.startsWith(String(year)))) return false;
    return true;
  });
}

/** Tri stable. « popularity » conserve l'ordre d'origine (pertinence de l'API). */
export function sortMovies(movies, sort = 'popularity') {
  const list = [...movies];
  switch (sort) {
    case 'rating':
      return list.sort((a, b) => b.voteAverage - a.voteAverage);
    case 'date':
      return list.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
    default:
      return list;
  }
}

/** Échappe les caractères spéciaux d'un motif LIKE pour une recherche littérale. */
export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const DETAILS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Colonnes d'un film (alias m) avec une date au format ISO et les ids de genres. */
export const MOVIE_SELECT = `
  m.external_id, m.title, m.original_title, m.overview, m.tagline, m.poster_path, m.backdrop_path,
  to_char(m.release_date, 'YYYY-MM-DD') AS release_date, m.runtime, m.vote_average, m.vote_count,
  m.original_language, m.director, m.production_countries, m.details_synced_at,
  ARRAY(SELECT g.external_id FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = m.id) AS genre_ids`;

/** Ligne SQL → objet « carte » exposé par l'API (même forme que les résumés TMDB). */
export function rowToSummary(row) {
  return {
    id: row.external_id,
    title: row.title,
    originalTitle: row.original_title,
    overview: row.overview,
    posterPath: row.poster_path,
    backdropPath: row.backdrop_path,
    releaseDate: row.release_date,
    voteAverage: Number(row.vote_average),
    voteCount: row.vote_count,
    originalLanguage: row.original_language,
    genreIds: row.genre_ids ?? [],
  };
}

export function createMovieService({ tmdb }) {
  /** Enregistre/actualise les infos de base de plusieurs films en une seule requête. */
  async function upsertSummaries(movies) {
    const unique = [...new Map(movies.map((m) => [m.id, m])).values()];
    if (!unique.length) return;
    await query(
      `INSERT INTO movies (external_id, title, original_title, overview, poster_path, backdrop_path,
                           release_date, vote_average, vote_count, original_language)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                            $7::date[], $8::numeric[], $9::int[], $10::text[])
       ON CONFLICT (external_id) DO UPDATE SET
         title = EXCLUDED.title, original_title = EXCLUDED.original_title,
         overview = COALESCE(EXCLUDED.overview, movies.overview),
         poster_path = EXCLUDED.poster_path, backdrop_path = EXCLUDED.backdrop_path,
         release_date = EXCLUDED.release_date, vote_average = EXCLUDED.vote_average,
         vote_count = EXCLUDED.vote_count, original_language = EXCLUDED.original_language`,
      [
        unique.map((m) => m.id),
        unique.map((m) => m.title),
        unique.map((m) => m.originalTitle),
        unique.map((m) => m.overview),
        unique.map((m) => m.posterPath),
        unique.map((m) => m.backdropPath),
        unique.map((m) => m.releaseDate),
        unique.map((m) => m.voteAverage),
        unique.map((m) => m.voteCount),
        unique.map((m) => m.originalLanguage),
      ],
    );
  }

  /** Mise en cache non bloquante des résultats de liste : une erreur ne doit jamais casser la réponse. */
  function cacheSummaries(movies) {
    upsertSummaries(movies).catch((err) => console.error('[db] mise en cache des films :', err.message));
  }

  /** Enregistre la fiche complète (film, genres, distribution) dans une transaction. */
  async function storeDetails(d) {
    return withTransaction(async (client) => {
      // Sérialise les synchronisations concurrentes d'un même film
      await client.query('SELECT pg_advisory_xact_lock($1)', [d.id]);

      const { rows } = await client.query(
        `INSERT INTO movies (external_id, title, original_title, overview, tagline, poster_path, backdrop_path,
                             release_date, runtime, vote_average, vote_count, original_language, director,
                             production_countries, details_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
         ON CONFLICT (external_id) DO UPDATE SET
           title = EXCLUDED.title, original_title = EXCLUDED.original_title, overview = EXCLUDED.overview,
           tagline = EXCLUDED.tagline, poster_path = EXCLUDED.poster_path, backdrop_path = EXCLUDED.backdrop_path,
           release_date = EXCLUDED.release_date, runtime = EXCLUDED.runtime, vote_average = EXCLUDED.vote_average,
           vote_count = EXCLUDED.vote_count, original_language = EXCLUDED.original_language,
           director = EXCLUDED.director, production_countries = EXCLUDED.production_countries,
           details_synced_at = now()
         RETURNING id`,
        [d.id, d.title, d.originalTitle, d.overview, d.tagline, d.posterPath, d.backdropPath, d.releaseDate,
         d.runtime, d.voteAverage, d.voteCount, d.originalLanguage, d.director, d.countries],
      );
      const movieId = rows[0].id;

      // Genres
      await client.query('DELETE FROM movie_genres WHERE movie_id = $1', [movieId]);
      if (d.genres.length) {
        await client.query(
          `INSERT INTO genres (external_id, name) SELECT * FROM unnest($1::int[], $2::text[])
           ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name`,
          [d.genres.map((g) => g.id), d.genres.map((g) => g.name)],
        );
        await client.query(
          `INSERT INTO movie_genres (movie_id, genre_id)
           SELECT $1, g.id FROM genres g WHERE g.external_id = ANY($2::int[])`,
          [movieId, d.genres.map((g) => g.id)],
        );
      }

      // Distribution
      await client.query('DELETE FROM movie_cast WHERE movie_id = $1', [movieId]);
      const cast = d.cast.filter((c) => Number.isInteger(c.personId));
      if (cast.length) {
        const people = [...new Map(cast.map((c) => [c.personId, c])).values()];
        const { rows: personRows } = await client.query(
          `INSERT INTO people (external_id, name, profile_path, known_for_department)
           SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])
           ON CONFLICT (external_id) DO UPDATE SET
             name = EXCLUDED.name, profile_path = EXCLUDED.profile_path,
             known_for_department = EXCLUDED.known_for_department
           RETURNING id, external_id`,
          [people.map((p) => p.personId), people.map((p) => p.name), people.map((p) => p.profilePath),
           people.map((p) => p.department)],
        );
        const personIds = new Map(personRows.map((r) => [r.external_id, r.id]));
        await client.query(
          `INSERT INTO movie_cast (movie_id, person_id, name, character_name, profile_path, cast_order)
           SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::int[])`,
          [movieId, cast.map((c) => personIds.get(c.personId)), cast.map((c) => c.name),
           cast.map((c) => c.character), cast.map((c) => c.profilePath), cast.map((c) => c.order)],
        );
      }
      return movieId;
    });
  }

  async function loadDetailsFromDb(externalId) {
    const { rows } = await query(`SELECT m.id, ${MOVIE_SELECT} FROM movies m WHERE m.external_id = $1`, [externalId]);
    const row = rows[0];
    if (!row || !row.details_synced_at) return { row, fresh: false };
    const fresh = Date.now() - new Date(row.details_synced_at).getTime() < DETAILS_TTL_MS;
    return { row, fresh };
  }

  /**
   * Fiche film : PostgreSQL d'abord ; sinon (ou si la fiche est ancienne) appel TMDB puis sauvegarde.
   * Si TMDB est indisponible mais qu'une fiche (même ancienne) existe, on la sert plutôt que d'échouer.
   */
  async function getMovieDetails(externalId) {
    const local = await loadDetailsFromDb(externalId);
    if (local.row && local.fresh) return buildDetails(local.row);

    try {
      const details = await tmdb.details(externalId);
      await storeDetails(details);
    } catch (err) {
      if (local.row?.details_synced_at && err.status !== 404) return buildDetails(local.row);
      throw err;
    }
    const reloaded = await loadDetailsFromDb(externalId);
    if (!reloaded.row) throw notFound('Film introuvable.');
    return buildDetails(reloaded.row);
  }

  async function buildDetails(row) {
    const { rows: genres } = await query(
      `SELECT g.external_id AS id, g.name FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
       WHERE mg.movie_id = $1 ORDER BY g.name`,
      [row.id],
    );
    const { rows: cast } = await query(
      `SELECT p.external_id AS person_id, c.name, c.character_name, c.profile_path, c.cast_order
       FROM movie_cast c JOIN people p ON p.id = c.person_id
       WHERE c.movie_id = $1 ORDER BY c.cast_order LIMIT 12`,
      [row.id],
    );
    return {
      ...rowToSummary(row),
      tagline: row.tagline,
      runtime: row.runtime,
      director: row.director,
      countries: row.production_countries ?? [],
      genres,
      cast: cast.map((c) => ({
        personId: c.person_id,
        name: c.name,
        character: c.character_name,
        profilePath: c.profile_path,
        order: c.cast_order,
      })),
    };
  }

  /** Renvoie l'id interne du film, en le synchronisant d'abord s'il n'existe pas encore en base. */
  async function ensureMovie(externalId) {
    const { rows } = await query('SELECT id FROM movies WHERE external_id = $1', [externalId]);
    if (rows[0]) return rows[0].id;
    await getMovieDetails(externalId);
    const again = await query('SELECT id FROM movies WHERE external_id = $1', [externalId]);
    if (!again.rows[0]) throw notFound('Film introuvable.');
    return again.rows[0].id;
  }

  async function syncGenres() {
    const list = await tmdb.genres();
    if (!list.length) return;
    await query(
      `INSERT INTO genres (external_id, name) SELECT * FROM unnest($1::int[], $2::text[])
       ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name`,
      [list.map((g) => g.id), list.map((g) => g.name)],
    );
  }

  async function getGenres() {
    let { rows } = await query('SELECT external_id AS id, name FROM genres ORDER BY name');
    if (!rows.length) {
      await syncGenres();
      ({ rows } = await query('SELECT external_id AS id, name FROM genres ORDER BY name'));
    }
    return rows;
  }

  /** Recherche locale (PostgreSQL, index trigramme). */
  async function searchLocal(q, limit, likeEscape) {
    const { rows } = await query(
      `SELECT ${MOVIE_SELECT} FROM movies m
       WHERE m.title ILIKE $1 OR m.original_title ILIKE $1
       ORDER BY m.vote_count DESC, m.title LIMIT $2`,
      [`%${likeEscape(q)}%`, limit],
    );
    return rows.map(rowToSummary);
  }

  return { upsertSummaries, cacheSummaries, getMovieDetails, ensureMovie, getGenres, syncGenres, searchLocal };
}
