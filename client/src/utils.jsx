import { useCallback, useEffect, useRef, useState } from 'react';
import { movieService } from './services/api.js';

// Une seule famille d'icônes (trait 1.75, arrondis) — pas de bibliothèque externe.
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  heart: <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.7 3.7 4.5 7 4.5c2 0 3.7 1 5 2.8 1.3-1.8 3-2.8 5-2.8 3.3 0 5.4 3.2 4.2 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z" />,
  bookmark: <path d="M6 3.5h12v17l-6-4.2-6 4.2v-17Z" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20.5c1-4 4-6 8-6s7 2 8 6" /></>,
  logout: <><path d="M9 4.5H5.5v15H9" /><path d="M16 8l4 4-4 4M20 12H9.5" /></>,
  left: <path d="m14.5 5.5-6 6.5 6 6.5" />,
  right: <path d="m9.5 5.5 6 6.5-6 6.5" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  film: <><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M8 3.5v17M16 3.5v17M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" /></>,
  alert: <><path d="M12 3.5 2.5 20h19L12 3.5Z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  trash: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  pencil: <path d="M4 20l1-4.5L16.5 4a2 2 0 0 1 3 3L8 18.5 4 20Z" />,
  list: <path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />,
};

const FILLABLE = new Set(['heart', 'bookmark', 'star']);

export function Icon({ name, filled = false, className, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill={filled && FILLABLE.has(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export function formatYear(date) {
  return typeof date === 'string' && /^\d{4}/.test(date) ? date.slice(0, 4) : '';
}

/** 125 → « 2 h 05 », 45 → « 45 min » */
export function formatRuntime(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** 7.456 → « 7,5 » ; 0 ou invalide → '' (pas de note affichée) */
export function formatScore(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toFixed(1).replace('.', ',');
}

export function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

export function initial(name) {
  return (name?.trim()?.[0] ?? '?').toUpperCase();
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** Image TMDB à une largeur donnée (w185, w342, w500, w780, w1280, original). */
export function imageUrl(path, size = 'w342') {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export function posterSrcSet(path) {
  if (!path) return undefined;
  return `${imageUrl(path, 'w185')} 185w, ${imageUrl(path, 'w342')} 342w, ${imageUrl(path, 'w500')} 500w`;
}

/**
 * Exécute fn(signal) au montage et quand deps changent. Annule la requête précédente,
 * ignore les réponses obsolètes. Retourne { data, error, loading, reload, setData }.
 */
export function useAsync(fn, deps, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const controller = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    fnRef.current(controller.signal)
      .then((data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setState({ data: null, error, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload, setData };
}

export function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const SITE_NAME = 'Cinéthèque';

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Catalogue de films`;
  }, [title]);
}

let cache = null;
let inflight = null;

function loadGenres() {
  if (cache) return Promise.resolve(cache);
  inflight ??= movieService
    .genres()
    .then((data) => { cache = data.results; return cache; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Genres (chargés une seule fois pour toute l'application). */
export function useGenres() {
  const [genres, setGenres] = useState(cache ?? []);
  useEffect(() => {
    let alive = true;
    loadGenres().then((g) => alive && setGenres(g)).catch(() => {});
    return () => { alive = false; };
  }, []);
  const byId = new Map(genres.map((g) => [g.id, g.name]));
  return { genres, nameOf: (id) => byId.get(id) };
}
