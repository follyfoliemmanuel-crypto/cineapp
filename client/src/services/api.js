

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

let onUnauthorized = () => {};
/** Permet à AuthContext d'être prévenu quand une session expire. */
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, { body, signal, params } = {}) {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'cinetheque',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Impossible de joindre le serveur. Vérifie ta connexion et réessaie.');
  }

  if (response.status === 204) return null;

  let data = null;
  try { data = await response.json(); } catch { /* corps vide ou non JSON */ }

  if (!response.ok) {
    const e = data?.error;
    if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(
      response.status,
      e?.code ?? 'error',
      e?.message ?? 'Une erreur est survenue. Réessaie dans un instant.',
      e?.fields,
    );
  }
  return data;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),
};

export const movieService = {
  list: (name, page = 1, signal) => api.get(`/movies/${name}`, { params: { page }, signal }),
  discover: (params, signal) => api.get('/movies', { params, signal }),
  search: (params, signal) => api.get('/search', { params, signal }),
  details: (id, signal) => api.get(`/movies/${id}`, { signal }),
  similar: (id, signal) => api.get(`/movies/${id}/similar`, { signal }),
  genres: (signal) => api.get('/genres', { signal }),
  searchHistory: (signal) => api.get('/search/history', { signal }),
  clearSearchHistory: () => api.delete('/search/history'),
};

export const libraryService = {
  ids: (signal) => api.get('/library/ids', { signal }),
  list: (kind, page = 1, signal) => api.get(`/${kind}`, { params: { page }, signal }),
  add: (kind, movieId) => api.post(`/${kind}`, { movieId }),
  remove: (kind, movieId) => api.delete(`/${kind}/${movieId}`),
};

export const reviewService = {
  forMovie: (id, page = 1, signal) => api.get(`/movies/${id}/reviews`, { params: { page }, signal }),
  create: (id, data) => api.post(`/movies/${id}/reviews`, data),
  update: (reviewId, data) => api.put(`/reviews/${reviewId}`, data),
  remove: (reviewId) => api.delete(`/reviews/${reviewId}`),
  mine: (page = 1, signal) => api.get('/reviews/mine', { params: { page }, signal }),
};

export const authService = {
  me: (signal) => api.get('/auth/me', { signal }),
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  profile: (signal) => api.get('/profile', { signal }),
  updateProfile: (data) => api.patch('/profile', data),
};
