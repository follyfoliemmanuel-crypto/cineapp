// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { AuthProvider, LibraryProvider, ToastProvider } from './context/AuthContext.jsx';

const MOVIES = [
  { id: 1, title: 'Dune', overview: 'Un jeune noble.', posterPath: '/a.jpg', backdropPath: '/b.jpg', releaseDate: '2021-10-22', voteAverage: 8.1, voteCount: 100, genreIds: [878] },
  { id: 2, title: 'Amélie', overview: 'Une serveuse.', posterPath: '/c.jpg', backdropPath: '/d.jpg', releaseDate: '2001-04-25', voteAverage: 7.9, voteCount: 90, genreIds: [35] },
];
const USER = { id: 1, username: 'ana', email: 'ana@example.test', avatarUrl: null, createdAt: '2026-01-01T00:00:00Z' };
const LISTS = /\/api\/movies\/(trending|popular|top-rated|now-playing|upcoming)$/;

let calls;
function mockApi({ user = null, failLists = false, favorites = [] } = {}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method ?? 'GET';
    calls.push({ method, path: u.pathname, search: u.search, body: opts.body });
    const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (u.pathname === '/api/auth/me') return json({ user });
    if (u.pathname === '/api/genres') return json({ results: [{ id: 878, name: 'Science-Fiction' }, { id: 35, name: 'Comédie' }] });
    if (LISTS.test(u.pathname)) return failLists ? json({ error: { message: 'Service indisponible' } }, 502) : json({ results: MOVIES, page: 1, totalPages: 1, totalResults: 2 });
    if (u.pathname === '/api/library/ids') return json({ favorites, watchlist: [], watched: [] });
    if (u.pathname === '/api/favorites' && method === 'POST') return json({ movieId: 1, added: true }, 201);
    if (u.pathname === '/api/favorites') return json({ results: [], page: 1, totalPages: 1, totalResults: 0 });
    if (u.pathname === '/api/search') return json({ results: [MOVIES[0]], page: 1, totalPages: 1, totalResults: 1 });
    if (u.pathname === '/api/search/history') return json({ results: [] });
    return json({ error: { message: 'inattendu' } }, 404);
  });
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><AuthProvider><LibraryProvider><App /></LibraryProvider></AuthProvider></ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => { window.scrollTo = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('application', () => {
  it('affiche le film à la une et les sélections de l’accueil', async () => {
    mockApi();
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Films populaires' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Parcourir par genre' })).toBeTruthy();
  });

  it('affiche une erreur claire avec un bouton Réessayer quand l’API échoue', async () => {
    mockApi({ failLists: true });
    renderAt('/');
    expect(await screen.findByText('Le catalogue est momentanément indisponible')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Réessayer' }).length).toBeGreaterThan(0);
  });

  it('recherche avec debounce et envoie la requête à l’API', async () => {
    mockApi();
    renderAt('/search');
    const input = await screen.findByLabelText('Rechercher un film', { selector: '#search-input' });
    await userEvent.type(input, 'dune');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/search' && c.search.includes('q=dune'))).toBe(true), { timeout: 3000 });
    expect(calls.filter((c) => c.path === '/api/search').length).toBe(1); // une seule requête malgré 4 frappes
    expect(await screen.findByRole('heading', { name: 'Résultats pour « dune »' })).toBeTruthy();
  });

  it('redirige vers la connexion quand un visiteur veut ajouter un favori', async () => {
    mockApi();
    renderAt('/');
    const heart = (await screen.findAllByRole('button', { name: /Ajouter Dune aux favoris/ }))[0];
    await userEvent.click(heart);
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/favorites')).toBe(false);
  });

  it('ajoute un favori (mise à jour optimiste) pour un utilisateur connecté', async () => {
    mockApi({ user: USER });
    renderAt('/');
    const heart = (await screen.findAllByRole('button', { name: /Ajouter Dune aux favoris/ }))[0];
    await userEvent.click(heart);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/favorites' && JSON.parse(c.body).movieId === 1)).toBe(true));
    expect((await screen.findAllByRole('button', { name: /Retirer Dune des favoris/ }))[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('protège les pages privées', async () => {
    mockApi();
    renderAt('/favorites');
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeTruthy();
  });

  it('affiche l’état vide des favoris avec une action', async () => {
    mockApi({ user: USER });
    renderAt('/favorites');
    expect(await screen.findByText('Aucun favori pour l’instant')).toBeTruthy();
    expect(within(document.body).getByRole('link', { name: /Explorer le catalogue/ })).toBeTruthy();
  });

  it('valide le formulaire d’inscription côté client', async () => {
    mockApi();
    renderAt('/register');
    await userEvent.click(await screen.findByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText('Au moins 10 caractères.')).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/auth/register')).toBe(false);
  });
});
