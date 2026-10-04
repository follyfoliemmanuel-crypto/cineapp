import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon, useAsync, useDebounce, useDocumentTitle, useGenres } from '../utils.jsx';
import MovieGrid, { EmptyState, ErrorState, GridSkeleton, Pagination } from '../components/MovieGrid.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { movieService } from '../services/api.js';

const LISTS = {
  popular: 'Films populaires',
  trending: 'Tendances de la semaine',
  'top-rated': 'Mieux notés',
  'now-playing': 'Sorties récentes',
  upcoming: 'Films à venir',
};
const SORTS = [
  ['popularity', 'Pertinence / popularité'],
  ['rating', 'Mieux notés'],
  ['date', 'Plus récents'],
  ['title', 'Titre (A → Z)'],
];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { genres } = useGenres();

  const q = params.get('q') ?? '';
  const list = LISTS[params.get('list')] ? params.get('list') : '';
  const genre = params.get('genre') ?? '';
  const year = params.get('year') ?? '';
  const sort = SORTS.some(([v]) => v === params.get('sort')) ? params.get('sort') : 'popularity';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = (changes, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '' || v === null) next.delete(k); else next.set(k, String(v));
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Recherche instantanée : la saisie est « débouncée » avant de modifier l'URL
  const [text, setText] = useState(q);
  useEffect(() => { setText(q); }, [q]);
  const debounced = useDebounce(text, 350);
  useEffect(() => {
    if (debounced.trim() !== q.trim()) update({ q: debounced.trim(), list: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const hasQuery = q.trim().length > 0;
  const mode = hasQuery ? 'search' : list ? 'list' : 'discover';

  const { data, error, loading, reload } = useAsync(
    (signal) => {
      if (mode === 'search') return movieService.search({ q: q.trim(), page, genre, year, sort }, signal);
      if (mode === 'list') return movieService.list(list, page, signal);
      return movieService.discover({ page, genre, year, sort }, signal);
    },
    [mode, q, list, page, genre, year, sort],
  );

  const history = useAsync((signal) => movieService.searchHistory(signal), [user?.id], { enabled: Boolean(user) && mode === 'discover' });

  const title = mode === 'search' ? `Résultats pour « ${q.trim()} »` : mode === 'list' ? LISTS[list] : 'Explorer le catalogue';
  useDocumentTitle(mode === 'search' ? `Recherche : ${q.trim()}` : title);

  const hasFilters = Boolean(genre || year || sort !== 'popularity');
  const results = data?.results ?? [];

  const goToPage = (p) => { update({ page: p > 1 ? p : undefined }, { resetPage: false }); window.scrollTo({ top: 0 }); };

  return (
    <div className="container page">
      <div className="page__head">
        <h1>{title}</h1>
        {mode === 'discover' && <p>Cherche un titre, ou filtre par genre, année et popularité.</p>}
        {mode === 'list' && <p><Link to="/search">Explorer tout le catalogue →</Link></p>}
      </div>

      <div className="toolbar" role="search">
        <div className="toolbar__search">
          <label htmlFor="search-input" className="visually-hidden">Rechercher un film</label>
          <Icon name="search" />
          <input id="search-input" className="input" type="search" placeholder="Titre d’un film…" value={text} onChange={(e) => setText(e.target.value)} maxLength={100} autoComplete="off" />
        </div>

        {mode !== 'list' && (
          <div className="toolbar__filters">
            <div className="field">
              <label htmlFor="f-genre">Genre</label>
              <select id="f-genre" className="select" value={genre} onChange={(e) => update({ genre: e.target.value })}>
                <option value="">Tous les genres</option>
                {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-year">Année</label>
              <input id="f-year" className="input" type="number" inputMode="numeric" min="1888" max="2100" placeholder="Toutes" value={year} onChange={(e) => update({ year: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-sort">Trier par</label>
              <select id="f-sort" className="select" value={sort} onChange={(e) => update({ sort: e.target.value === 'popularity' ? '' : e.target.value })}>
                {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            {hasFilters && <button type="button" className="btn btn--ghost" onClick={() => update({ genre: '', year: '', sort: '' })}>Réinitialiser</button>}
          </div>
        )}

        {user && mode === 'discover' && history.data?.results.length > 0 && (
          <div className="search-history">
            <span>Recherches récentes</span>
            {history.data.results.slice(0, 6).map((h) => (
              <button key={h.id} type="button" className="tag" onClick={() => update({ q: h.query })}>{h.query}</button>
            ))}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => movieService.clearSearchHistory().then(history.reload)}>Effacer</button>
          </div>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} title="La recherche a échoué" />
      ) : loading && !data ? (
        <GridSkeleton />
      ) : results.length === 0 ? (
        <EmptyState
          icon="search"
          title={hasQuery ? `Aucun film ne correspond à « ${q.trim()} »` : 'Aucun film pour ces critères'}
          actions={hasFilters || hasQuery ? <button type="button" className="btn btn--secondary" onClick={() => { setText(''); update({ q: '', genre: '', year: '', sort: '' }); }}>Effacer la recherche et les filtres</button> : null}
        >
          Vérifie l’orthographe, essaie un titre plus court, ou retire un filtre.
        </EmptyState>
      ) : (
        <div aria-busy={loading}>
          {data.totalResults > 0 && <p className="result-count" aria-live="polite">{data.totalResults.toLocaleString('fr-FR')} film{data.totalResults > 1 ? 's' : ''}</p>}
          <MovieGrid movies={results} />
          <Pagination page={data.page} totalPages={data.totalPages} onChange={goToPage} />
        </div>
      )}
    </div>
  );
}
