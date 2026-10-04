import pg from 'pg';

let pool;

/** Pool PostgreSQL unique (Neon). Toutes les requêtes passent par query() avec des paramètres. */
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL est manquante.');
    pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.error('[db] erreur client inactif :', err.message));
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/** Exécute fn(client) dans une transaction (COMMIT / ROLLBACK automatique). */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

// ---------------------------------------------------------------------------
// Migrations : ordonnées, versionnées (table schema_migrations), appliquées au démarrage.
// Pour modifier le schéma, ajoute une NOUVELLE entrée à la fin — ne modifie jamais une migration déjà appliquée.
// ---------------------------------------------------------------------------
export const MIGRATIONS = [
  {
    name: '001_create_users',
    sql: `
-- Fonction utilitaire : met à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL,
  email         VARCHAR(254) NOT NULL,
  password_hash TEXT         NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_-]{3,30}$')
);

-- Nom d'utilisateur unique sans tenir compte de la casse
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`,
  },
  {
    name: '002_create_movies',
    sql: `
-- Recherche textuelle rapide (ILIKE '%...%') sur les titres
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE movies (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id        INTEGER      NOT NULL,
  title              TEXT         NOT NULL,
  original_title     TEXT,
  overview           TEXT,
  tagline            TEXT,
  poster_path        TEXT,
  backdrop_path      TEXT,
  release_date       DATE,
  runtime            INTEGER,
  vote_average       NUMERIC(4,2) NOT NULL DEFAULT 0,
  vote_count         INTEGER      NOT NULL DEFAULT 0,
  original_language  VARCHAR(10),
  director           TEXT,
  production_countries TEXT[]     NOT NULL DEFAULT '{}',
  -- NULL tant que la fiche détaillée n'a pas été synchronisée depuis l'API externe
  details_synced_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT movies_external_id_unique UNIQUE (external_id)
);

-- external_id est déjà indexé par la contrainte UNIQUE ci-dessus
CREATE INDEX movies_release_date_idx  ON movies (release_date DESC);
CREATE INDEX movies_vote_average_idx  ON movies (vote_average DESC);
CREATE INDEX movies_title_trgm_idx    ON movies USING gin (title gin_trgm_ops);
CREATE INDEX movies_original_title_trgm_idx ON movies USING gin (original_title gin_trgm_ops);

CREATE TRIGGER movies_set_updated_at
  BEFORE UPDATE ON movies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`,
  },
  {
    name: '003_create_genres',
    sql: `
CREATE TABLE genres (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  CONSTRAINT genres_external_id_unique UNIQUE (external_id)
);
`,
  },
  {
    name: '004_create_movie_genres',
    sql: `
CREATE TABLE movie_genres (
  movie_id BIGINT NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  genre_id BIGINT NOT NULL REFERENCES genres (id) ON DELETE CASCADE,
  PRIMARY KEY (movie_id, genre_id)
);

-- Pour retrouver les films d'un genre
CREATE INDEX movie_genres_genre_id_idx ON movie_genres (genre_id);
`,
  },
  {
    name: '005_create_people',
    sql: `
CREATE TABLE people (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id          INTEGER NOT NULL,
  name                 TEXT    NOT NULL,
  profile_path         TEXT,
  known_for_department TEXT,
  CONSTRAINT people_external_id_unique UNIQUE (external_id)
);
`,
  },
  {
    name: '006_create_movie_cast',
    sql: `
-- name / profile_path sont dénormalisés volontairement (cf. cahier des charges)
-- pour afficher la distribution sans jointure supplémentaire.
CREATE TABLE movie_cast (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movie_id       BIGINT  NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  person_id      BIGINT  NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  character_name TEXT,
  profile_path   TEXT,
  cast_order     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT movie_cast_unique UNIQUE (movie_id, person_id, cast_order)
);

CREATE INDEX movie_cast_movie_order_idx ON movie_cast (movie_id, cast_order);
CREATE INDEX movie_cast_person_id_idx   ON movie_cast (person_id);
`,
  },
  {
    name: '007_create_favorites',
    sql: `
CREATE TABLE favorites (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  movie_id   BIGINT      NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT favorites_user_movie_unique UNIQUE (user_id, movie_id)
);

CREATE INDEX favorites_user_created_idx ON favorites (user_id, created_at DESC);
`,
  },
  {
    name: '008_create_watchlist',
    sql: `
CREATE TABLE watchlist (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  movie_id   BIGINT      NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_user_movie_unique UNIQUE (user_id, movie_id)
);

CREATE INDEX watchlist_user_created_idx ON watchlist (user_id, created_at DESC);
`,
  },
  {
    name: '009_create_reviews',
    sql: `
CREATE TABLE reviews (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  movie_id   BIGINT      NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  rating     SMALLINT    NOT NULL,
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Une seule note/critique par utilisateur et par film
  CONSTRAINT reviews_user_movie_unique UNIQUE (user_id, movie_id),
  CONSTRAINT reviews_rating_range CHECK (rating >= 1 AND rating <= 10),
  CONSTRAINT reviews_comment_length CHECK (comment IS NULL OR char_length(comment) <= 2000)
);

CREATE INDEX reviews_movie_created_idx ON reviews (movie_id, created_at DESC);

CREATE TRIGGER reviews_set_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`,
  },
  {
    name: '010_create_watch_history',
    sql: `
-- Suivi des films marqués comme « vus » dans le catalogue (aucun streaming).
CREATE TABLE watch_history (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
  movie_id   BIGINT      NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT watch_history_user_movie_unique UNIQUE (user_id, movie_id)
);

CREATE INDEX watch_history_user_watched_idx ON watch_history (user_id, watched_at DESC);
`,
  },
  {
    name: '011_create_search_history',
    sql: `
CREATE TABLE search_history (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  query      VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT search_history_query_not_blank CHECK (char_length(btrim(query)) > 0)
);

CREATE INDEX search_history_user_created_idx ON search_history (user_id, created_at DESC);
`,
  },
  {
    name: '012_seed_genres',
    sql: `
-- Genres TMDB (cinéma), noms en français. Idempotent.
INSERT INTO genres (external_id, name) VALUES
  (28, 'Action'), (12, 'Aventure'), (16, 'Animation'), (35, 'Comédie'), (80, 'Crime'),
  (99, 'Documentaire'), (18, 'Drame'), (10751, 'Familial'), (14, 'Fantastique'), (36, 'Histoire'),
  (27, 'Horreur'), (10402, 'Musique'), (9648, 'Mystère'), (10749, 'Romance'),
  (878, 'Science-Fiction'), (10770, 'Téléfilm'), (53, 'Thriller'), (10752, 'Guerre'), (37, 'Western')
ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name;
`,
  },
];

/** Applique, dans l'ordre, les migrations pas encore enregistrées. Un verrou évite les courses entre instances. */
export async function runMigrations({ log = console.log } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    let applied = 0;
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.name} échouée : ${err.message}`);
      }
      log(`✔ migration ${m.name}`);
      applied += 1;
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}
