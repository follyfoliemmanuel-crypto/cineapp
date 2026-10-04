// Tests d'intégration : vraie base PostgreSQL, faux TMDB. Ignorés sans TEST_DATABASE_URL.
// ⚠️ N'utilise JAMAIS la base de production : crée une branche Neon dédiée aux tests.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = !TEST_DB && 'TEST_DATABASE_URL non défini';

const fakeDetails = (id) => ({
  id, title: `Film ${id}`, originalTitle: `Film ${id}`, overview: 'Résumé', tagline: null,
  posterPath: '/p.jpg', backdropPath: '/b.jpg', releaseDate: '2020-01-02', voteAverage: 7.5, voteCount: 100,
  originalLanguage: 'fr', genreIds: [18], runtime: 100, director: 'Réal', countries: ['France'],
  genres: [{ id: 18, name: 'Drame' }],
  cast: [{ personId: 900 + id, name: 'Acteur', character: 'Rôle', profilePath: null, department: 'Acting', order: 0 }],
});
const summary = (id, title) => ({ ...fakeDetails(id), title });
const fakeTmdb = {
  list: async () => ({ results: [summary(9001, 'Populaire A')], page: 1, totalPages: 1, totalResults: 1 }),
  search: async ({ q }) => ({ results: [summary(9002, `Résultat ${q}`)], page: 1, totalPages: 4, totalResults: 80 }),
  discover: async () => ({ results: [summary(9003, 'Découverte')], page: 1, totalPages: 1, totalResults: 1 }),
  details: async (id) => { if (id === 404404) { const { notFound } = await import('../src/utils.js'); throw notFound(); } return fakeDetails(id); },
  similar: async () => ({ results: [summary(9004, 'Similaire')], page: 1, totalPages: 1, totalResults: 1 }),
  genres: async () => [{ id: 18, name: 'Drame' }],
};

describe('API (intégration)', { skip }, () => {
  let server, base, pool, closePool;
  const suffix = Math.random().toString(36).slice(2, 8);
  const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'cinetheque' };

  // Mini client avec gestion de cookie
  const client = () => {
    let cookie = '';
    return async (method, path, body, headers = H) => {
      const res = await fetch(base + path, {
        method, headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].startsWith('ct_session=;') ? '' : set.split(';')[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
    };
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { runMigrations, getPool, closePool: close } = await import('../src/db.js');
    pool = getPool; closePool = close;
    await runMigrations({ log: () => {} });
    const { loadConfig, createApp } = await import('../src/index.js');
    const config = loadConfig({ requireAll: false });
    config.jwtSecret = 'z'.repeat(48);
    config.tmdb = { apiKey: 'k'.repeat(32), baseUrl: 'http://unused' };
    config.clientOrigins = ['http://localhost:5173'];
    server = createApp(config, { tmdb: fakeTmdb }).listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await pool().query('DELETE FROM users WHERE email LIKE $1', [`%${suffix}@example.test`]);
    await new Promise((r) => server.close(r));
    await closePool();
  });

  const creds = (n) => ({ username: `t${n}_${suffix}`, email: `t${n}${suffix}@example.test`, password: 'mot-de-passe-solide-1' });

  it('refuse une écriture sans en-tête de sécurité (CSRF)', async () => {
    const res = await client()('POST', '/api/auth/register', creds(0), { 'Content-Type': 'application/json' });
    assert.equal(res.status, 403);
  });

  it('inscrit, hache le mot de passe, pose un cookie httpOnly et refuse les doublons', async () => {
    const api = client();
    const res = await api('POST', '/api/auth/register', creds(1));
    assert.equal(res.status, 201);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
    assert.equal(res.body.user.password_hash, undefined);
    assert.equal(res.body.user.passwordHash, undefined);
    const { rows } = await pool().query('SELECT password_hash FROM users WHERE email = $1', [creds(1).email]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);
    const dup = await client()('POST', '/api/auth/register', creds(1));
    assert.equal(dup.status, 409);
  });

  it('connecte, répond de façon identique pour e-mail inconnu / mauvais mot de passe', async () => {
    const ok = await client()('POST', '/api/auth/login', { email: creds(1).email, password: creds(1).password });
    assert.equal(ok.status, 200);
    const bad = await client()('POST', '/api/auth/login', { email: creds(1).email, password: 'mauvais-mot-de-passe' });
    const unknown = await client()('POST', '/api/auth/login', { email: `inconnu${suffix}@example.test`, password: 'mauvais-mot-de-passe' });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.body, unknown.body);
  });

  it('protège les routes privées', async () => {
    const api = client();
    for (const [m, p] of [['GET', '/api/favorites'], ['GET', '/api/watchlist'], ['GET', '/api/watch-history'], ['GET', '/api/profile'], ['GET', '/api/reviews/mine'], ['GET', '/api/search/history'], ['POST', '/api/favorites']]) {
      const res = await api(m, p, m === 'POST' ? { movieId: 1 } : undefined);
      assert.equal(res.status, 401, `${m} ${p}`);
    }
  });

  it('synchronise un film (TMDB → PostgreSQL) puis le sert depuis la base', async () => {
    const api = client();
    const first = await api('GET', '/api/movies/777001');
    assert.equal(first.status, 200);
    assert.equal(first.body.movie.director, 'Réal');
    assert.deepEqual(first.body.movie.genres, [{ id: 18, name: 'Drame' }]);
    assert.equal(first.body.movie.cast.length, 1);
    // Casse volontairement TMDB : la 2e lecture doit venir de la base
    const original = fakeTmdb.details;
    fakeTmdb.details = async () => { throw new Error('TMDB ne doit pas être appelé'); };
    const second = await api('GET', '/api/movies/777001');
    fakeTmdb.details = original;
    assert.equal(second.status, 200);
    assert.equal(second.body.movie.title, 'Film 777001');
    assert.equal((await api('GET', '/api/movies/404404')).status, 404);
    assert.equal((await api('GET', '/api/movies/abc')).status, 400);
  });

  it('gère favoris, watchlist et historique (idempotent, sans doublon)', async () => {
    const api = client();
    await api('POST', '/api/auth/register', creds(2));
    for (const path of ['favorites', 'watchlist', 'watch-history']) {
      const add = await api('POST', `/api/${path}`, { movieId: 777002 });
      assert.equal(add.status, 201, path);
      const again = await api('POST', `/api/${path}`, { movieId: 777002 });
      assert.equal(again.status, 200, `${path} doublon ignoré`);
      const list = await api('GET', `/api/${path}`);
      assert.equal(list.body.totalResults, 1);
      assert.equal(list.body.results[0].id, 777002);
      assert.equal((await api('DELETE', `/api/${path}/777002`)).status, 204);
      assert.equal((await api('GET', `/api/${path}`)).body.totalResults, 0);
    }
    assert.equal((await api('POST', '/api/favorites', { movieId: 'x' })).status, 400);
    assert.equal((await api('POST', '/api/favorites', { movieId: 1, userId: 99 })).status, 400);
  });

  it('isole les données entre utilisateurs', async () => {
    const alice = client(); const bob = client();
    await alice('POST', '/api/auth/register', creds(3));
    await bob('POST', '/api/auth/register', creds(4));
    await alice('POST', '/api/favorites', { movieId: 777003 });
    assert.equal((await bob('GET', '/api/favorites')).body.totalResults, 0);
    const ids = await alice('GET', '/api/library/ids');
    assert.deepEqual(ids.body.favorites, [777003]);
  });

  it('avis : une note par film, bornes 1–10, propriété vérifiée (IDOR)', async () => {
    const alice = client(); const bob = client();
    await alice('POST', '/api/auth/register', creds(5));
    await bob('POST', '/api/auth/register', creds(6));

    assert.equal((await alice('POST', '/api/movies/777004/reviews', { rating: 11 })).status, 400);
    assert.equal((await alice('POST', '/api/movies/777004/reviews', { rating: 0 })).status, 400);
    const created = await alice('POST', '/api/movies/777004/reviews', { rating: 8, comment: 'Très bon' });
    assert.equal(created.status, 201);
    const reviewId = created.body.review.id;
    assert.equal((await alice('POST', '/api/movies/777004/reviews', { rating: 5 })).status, 409);

    assert.equal((await bob('PUT', `/api/reviews/${reviewId}`, { rating: 1 })).status, 404, 'Bob ne peut pas modifier');
    assert.equal((await bob('DELETE', `/api/reviews/${reviewId}`)).status, 404, 'Bob ne peut pas supprimer');
    assert.equal((await alice('PUT', `/api/reviews/${reviewId}`, { rating: 9, comment: null })).body.review.rating, 9);

    const list = await bob('GET', '/api/movies/777004/reviews');
    assert.equal(list.body.mine, null, 'Bob n’a pas d’avis');
    assert.equal((await alice('GET', '/api/movies/777004/reviews')).body.mine.rating, 9);
    assert.equal(list.body.totalResults, 1);
    assert.equal(list.body.average, 9);
    assert.equal(list.body.results[0].user.username, `t5_${suffix}`);
    assert.equal(list.body.results[0].user.email, undefined, 'l’e-mail ne fuite pas');

    assert.equal((await alice('DELETE', `/api/reviews/${reviewId}`)).status, 204);
  });

  it('recherche : fusion local + externe, historique plafonné', async () => {
    const api = client();
    await api('POST', '/api/auth/register', creds(7));
    const res = await api('GET', '/api/search?q=film');
    assert.equal(res.status, 200);
    assert.ok(res.body.results.some((m) => m.id === 9002), 'résultat externe présent');
    assert.ok(res.body.results.length >= 1);
    assert.equal((await api('GET', '/api/search?q=')).status, 400);
    assert.equal((await api('GET', `/api/search?q=${'a'.repeat(101)}`)).status, 400);
    // Caractères spéciaux traités littéralement (pas d'erreur SQL)
    assert.equal((await api('GET', '/api/search?q=100%25_%5C')).status, 200);
    await new Promise((r) => setTimeout(r, 200));
    const hist = await api('GET', '/api/search/history');
    assert.ok(hist.body.results.length >= 1);
    assert.equal((await api('DELETE', '/api/search/history')).status, 204);
  });

  it('contraintes SQL : unicité, plage de note, cascade à la suppression', async () => {
    const { rows: u } = await pool().query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,'x') RETURNING id`,
      [`c_${suffix}`, `c${suffix}@example.test`],
    );
    await assert.rejects(
      () => pool().query(`INSERT INTO users (username, email, password_hash) VALUES ($1,$2,'x')`, [`C_${suffix}`, `other${suffix}@example.test`]),
      (e) => e.code === '23505', 'pseudo unique sans tenir compte de la casse',
    );
    await assert.rejects(
      () => pool().query(`INSERT INTO users (username, email, password_hash) VALUES ('mixed_ok', $1, 'x')`, [`Maj${suffix}@Example.test`]),
      (e) => e.code === '23514', 'e-mail en minuscules imposé',
    );
    const { rows: m } = await pool().query(`SELECT id FROM movies WHERE external_id = 777001`);
    await assert.rejects(
      () => pool().query('INSERT INTO reviews (user_id, movie_id, rating) VALUES ($1,$2,11)', [u[0].id, m[0].id]),
      (e) => e.code === '23514',
    );
    await pool().query('INSERT INTO favorites (user_id, movie_id) VALUES ($1,$2)', [u[0].id, m[0].id]);
    await assert.rejects(() => pool().query('INSERT INTO favorites (user_id, movie_id) VALUES ($1,$2)', [u[0].id, m[0].id]), (e) => e.code === '23505');
    await pool().query('DELETE FROM users WHERE id = $1', [u[0].id]);
    const { rows: left } = await pool().query('SELECT 1 FROM favorites WHERE user_id = $1', [u[0].id]);
    assert.equal(left.length, 0, 'favoris supprimés en cascade');
  });

  it('retourne des erreurs JSON propres (pas de fuite) : 404 route, JSON invalide', async () => {
    const api = client();
    assert.equal((await api('GET', '/api/nope')).status, 404);
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: H, body: '{pas du json' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(!JSON.stringify(body).includes('SyntaxError'));
  });
});
