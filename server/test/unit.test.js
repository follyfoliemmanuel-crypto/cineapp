import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterMovies, escapeLike, mergeMovies, sortMovies, createTmdbClient, mapMovieDetails, mapMovieSummary } from '../src/services/tmdb.js';
import { AppError, parse, schemas } from '../src/utils.js';
import { requireCustomHeader, signToken, verifyToken } from '../src/middleware/auth.js';
import jwt from 'jsonwebtoken';

const SECRET = 'x'.repeat(40);

describe('validation', () => {
  it('accepte une inscription valide et normalise l’e-mail', () => {
    const v = parse(schemas.register, { username: 'ana_01', email: '  ANA@Example.com ', password: 'un-mot-de-passe-long' });
    assert.equal(v.email, 'ana@example.com');
  });
  it('refuse un mot de passe court, un pseudo invalide et les champs inconnus', () => {
    assert.throws(() => parse(schemas.register, { username: 'ab', email: 'a@b.co', password: 'court' }), AppError);
    assert.throws(() => parse(schemas.register, { username: 'ok_name', email: 'a@b.co', password: 'un-mot-de-passe-long', role: 'admin' }), AppError);
  });
  it('refuse une note hors 1–10 et un avatar non https', () => {
    assert.throws(() => parse(schemas.reviewBody, { rating: 11 }), AppError);
    assert.throws(() => parse(schemas.reviewBody, { rating: 0 }), AppError);
    assert.throws(() => parse(schemas.profileUpdate, { avatarUrl: 'http://x.com/a.png' }), AppError);
    assert.throws(() => parse(schemas.profileUpdate, { avatarUrl: 'javascript:alert(1)' }), AppError);
  });
  it('borne la pagination et les identifiants', () => {
    assert.throws(() => parse(schemas.pageQuery, { page: '0' }), AppError);
    assert.throws(() => parse(schemas.movieParam, { id: "1; DROP TABLE users" }), AppError);
    assert.equal(parse(schemas.pageQuery, {}).page, 1);
  });
});

describe('recherche', () => {
  const a = { id: 1, title: 'Zorro', voteAverage: 6, releaseDate: '1998-07-17', genreIds: [28] };
  const b = { id: 2, title: 'Amélie', voteAverage: 8, releaseDate: '2001-04-25', genreIds: [35, 10749] };
  const c = { id: 3, title: 'Batman', voteAverage: 7, releaseDate: null, genreIds: [28] };

  it('fusionne sans doublon en gardant la priorité à la première liste', () => {
    assert.deepEqual(mergeMovies([a, b], [b, c]).map((m) => m.id), [1, 2, 3]);
  });
  it('filtre par genre et par année', () => {
    assert.deepEqual(filterMovies([a, b, c], { genre: 28 }).map((m) => m.id), [1, 3]);
    assert.deepEqual(filterMovies([a, b, c], { year: 2001 }).map((m) => m.id), [2]);
  });
  it('trie par note, date (nulls en dernier) et titre', () => {
    assert.deepEqual(sortMovies([a, b, c], 'rating').map((m) => m.id), [2, 3, 1]);
    assert.deepEqual(sortMovies([a, b, c], 'date').map((m) => m.id), [2, 1, 3]);
    assert.deepEqual(sortMovies([a, b, c], 'title').map((m) => m.id), [2, 3, 1]);
    assert.deepEqual(sortMovies([a, b, c], 'popularity').map((m) => m.id), [1, 2, 3]);
  });
  it('échappe les jokers LIKE', () => {
    assert.equal(escapeLike('100%_\\'), '100\\%\\_\\\\');
  });
});

describe('mapping TMDB', () => {
  it('nettoie un résumé et rejette les chemins d’image suspects', () => {
    const m = mapMovieSummary({ id: 5, title: ' Film ', release_date: '', poster_path: '/../../etc/passwd', backdrop_path: '/ok.jpg', vote_average: 7.456, genre_ids: [1, 'x', 2] });
    assert.equal(m.title, 'Film');
    assert.equal(m.releaseDate, null);
    assert.equal(m.posterPath, null);
    assert.equal(m.backdropPath, '/ok.jpg');
    assert.equal(m.voteAverage, 7.5);
    assert.deepEqual(m.genreIds, [1, 2]);
  });
  it('extrait réalisateur, pays, genres et limite la distribution', () => {
    const cast = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, name: `Acteur ${i}`, order: i }));
    const d = mapMovieDetails({
      id: 9, title: 'X', runtime: 120, genres: [{ id: 18, name: 'Drame' }],
      production_countries: [{ name: 'France' }],
      credits: { cast, crew: [{ job: 'Producer', name: 'P' }, { job: 'Director', name: 'Réal' }] },
    });
    assert.equal(d.director, 'Réal');
    assert.deepEqual(d.countries, ['France']);
    assert.equal(d.cast.length, 12);
    assert.equal(d.runtime, 120);
  });
});

describe('client TMDB', () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url: new URL(url), opts });
    return { ok: true, status: 200, json: async () => ({ results: [{ id: 1, title: 'A' }], page: 1, total_pages: 3 }) };
  };

  it('met en cache, envoie la clé v3 en paramètre et le jeton v4 en en-tête', async () => {
    const v3 = createTmdbClient({ apiKey: 'k'.repeat(32), baseUrl: 'http://x/3' }, { fetchImpl: fakeFetch });
    await v3.list('popular', 1);
    await v3.list('popular', 1);
    assert.equal(calls.length, 1, 'deuxième appel servi par le cache');
    assert.equal(calls[0].url.searchParams.get('api_key'), 'k'.repeat(32));

    const v4 = createTmdbClient({ apiKey: 't'.repeat(200), baseUrl: 'http://x/3' }, { fetchImpl: fakeFetch });
    await v4.list('popular', 1);
    assert.equal(calls[1].url.searchParams.get('api_key'), null);
    assert.match(calls[1].opts.headers.Authorization, /^Bearer /);
  });

  it('transforme les erreurs réseau en 502 sans fuite d’information', async () => {
    const down = createTmdbClient({ apiKey: 'k'.repeat(32), baseUrl: 'http://x/3' }, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    await assert.rejects(() => down.list('popular'), (e) => e.status === 502 && !/ECONN/.test(e.message));
  });

  it('transforme un 404 en « introuvable »', async () => {
    const nf = createTmdbClient({ apiKey: 'k'.repeat(32), baseUrl: 'http://x/3' }, { fetchImpl: async () => ({ ok: false, status: 404 }) });
    await assert.rejects(() => nf.details(1), (e) => e.status === 404);
  });
});

describe('jwt', () => {
  it('signe et vérifie', () => assert.equal(verifyToken(signToken(42, SECRET), SECRET), '42'));
  it('refuse un mauvais secret, un jeton expiré et l’algorithme "none"', () => {
    assert.equal(verifyToken(signToken(42, SECRET), 'y'.repeat(40)), null);
    assert.equal(verifyToken(signToken(42, SECRET, -10), SECRET), null);
    const none = jwt.sign({ sub: '1' }, '', { algorithm: 'none' });
    assert.equal(verifyToken(none, SECRET), null);
    assert.equal(verifyToken('pas-un-jwt', SECRET), null);
  });
});

describe('protection CSRF (en-tête personnalisé)', () => {
  const run = (method, headers = {}) => {
    let err;
    requireCustomHeader({ method, get: (h) => headers[h.toLowerCase()] }, {}, (e) => (err = e));
    return err;
  };
  it('laisse passer les lectures', () => assert.equal(run('GET'), undefined));
  it('bloque une écriture sans en-tête', () => assert.equal(run('POST')?.status, 403));
  it('autorise une écriture avec l’en-tête attendu', () => assert.equal(run('DELETE', { 'x-requested-with': 'cinetheque' }), undefined));
});
