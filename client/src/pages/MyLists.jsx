import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, formatDate, formatYear, initial, useAsync, useDocumentTitle } from '../utils.jsx';
import MovieGrid, { EmptyState, ErrorState, GridSkeleton, Pagination } from '../components/MovieGrid.jsx';
import MovieCard, { Poster } from '../components/MovieCard.jsx';
import { KINDS, useAuth, useLibrary, useToast } from '../context/AuthContext.jsx';
import { authService, libraryService, reviewService } from '../services/api.js';

const TABS = [
  { id: 'favorites', label: 'Favoris', stat: 'favorites', api: 'favorites', seeAll: '/favorites' },
  { id: 'watchlist', label: 'À voir', stat: 'watchlist', api: 'watchlist', seeAll: '/watchlist' },
  { id: 'watched', label: 'Films vus', stat: 'watched', api: 'watch-history' },
  { id: 'reviews', label: 'Mes avis', stat: 'reviews' },
];

function EditProfile({ onDone }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ username: user.username, avatarUrl: user.avatarUrl ?? '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const data = await authService.updateProfile({ username: form.username.trim(), avatarUrl: form.avatarUrl.trim() });
      setUser(data.user);
      toast.success('Profil mis à jour');
      onDone();
    } catch (err) {
      setErrors(err.fields ?? { _: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="profile__form" onSubmit={submit} noValidate>
      {errors._ && <p className="banner" role="alert">{errors._}</p>}
      <div className="field">
        <label htmlFor="p-username">Nom d’utilisateur</label>
        <input id="p-username" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? 'p-username-err' : undefined} autoComplete="username" />
        {errors.username && <span className="error-text" id="p-username-err">{errors.username}</span>}
      </div>
      <div className="field">
        <label htmlFor="p-avatar">Image de profil <span className="hint">(URL https, facultatif)</span></label>
        <input id="p-avatar" className="input" type="url" value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} placeholder="https://…" aria-invalid={Boolean(errors.avatarUrl)} aria-describedby={errors.avatarUrl ? 'p-avatar-err' : undefined} />
        {errors.avatarUrl && <span className="error-text" id="p-avatar-err">{errors.avatarUrl}</span>}
      </div>
      <div className="film__actions">
        <button type="submit" className="btn btn--primary" aria-busy={busy} disabled={busy}>Enregistrer</button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>Annuler</button>
      </div>
    </form>
  );
}

function TabContent({ tab }) {
  const { data, error, loading, reload } = useAsync(
    (signal) => (tab.id === 'reviews' ? reviewService.mine(1, signal) : libraryService.list(tab.api, 1, signal)),
    [tab.id],
  );

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <GridSkeleton count={6} />;

  if (!data.results.length) {
    return (
      <EmptyState icon={tab.id === 'reviews' ? 'star' : 'film'} title={`Rien dans « ${tab.label} » pour l’instant`} actions={<Link to="/search" className="btn btn--primary">Explorer le catalogue</Link>}>
        {tab.id === 'reviews' ? 'Ouvre la fiche d’un film pour donner ta note et ton avis.' : 'Les films que tu ajoutes apparaîtront ici.'}
      </EmptyState>
    );
  }

  if (tab.id === 'reviews') {
    return (
      <ul>
        {data.results.map((r) => (
          <li key={r.id} className="my-review">
            <Link to={`/movie/${r.movie.id}`} aria-label={r.movie.title}><Poster path={r.movie.posterPath} title={r.movie.title} sizes="64px" /></Link>
            <div>
              <h3><Link to={`/movie/${r.movie.id}`}>{r.movie.title}</Link> <small>{formatYear(r.movie.releaseDate)}</small></h3>
              <p className="score"><Icon name="star" filled /> {r.rating}/10 <time dateTime={r.createdAt}>· {formatDate(r.createdAt)}</time></p>
              {r.comment && <p className="review__body">{r.comment}</p>}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <MovieGrid movies={data.results} />
      {tab.seeAll && data.totalResults > data.results.length && (
        <p className="result-count"><Link to={tab.seeAll}>Voir les {data.totalResults} films →</Link></p>
      )}
    </>
  );
}

export function Profile() {
  useDocumentTitle('Mon profil');
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState('favorites');
  const stats = useAsync((signal) => authService.profile(signal), [active]);

  const tab = TABS.find((t) => t.id === active);

  return (
    <div className="container page">
      <div className="profile__head">
        <span className="avatar avatar--lg">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial(user.username)}
        </span>
        <div>
          <h1>{user.username}</h1>
          <p>{user.email} · Membre depuis le {formatDate(user.createdAt)}</p>
        </div>
        <div className="profile__edit">
          {!editing && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(true)}><Icon name="pencil" /> Modifier le profil</button>}
          {editing && <EditProfile onDone={() => setEditing(false)} />}
        </div>
      </div>

      <div role="tablist" aria-label="Mes listes" className="tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={active === t.id} aria-controls="profile-panel" tabIndex={active === t.id ? 0 : -1} className="tab" onClick={() => setActive(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === active);
              if (e.key === 'ArrowRight') { setActive(TABS[(i + 1) % TABS.length].id); }
              if (e.key === 'ArrowLeft') { setActive(TABS[(i - 1 + TABS.length) % TABS.length].id); }
            }}>
            {t.label}
            {stats.data && <span className="count">{stats.data.stats[t.stat]}</span>}
          </button>
        ))}
      </div>

      <div className="profile__panel" role="tabpanel" id="profile-panel" aria-labelledby={`tab-${active}`} tabIndex={0}>
        <TabContent key={active} tab={tab} />
      </div>
    </div>
  );
}

const COPY = {
  favorites: {
    title: 'Mes favoris',
    intro: 'Les films que tu as mis de côté parce qu’ils comptent pour toi.',
    emptyTitle: 'Aucun favori pour l’instant',
    emptyText: 'Touche le cœur sur une affiche pour retrouver ici les films que tu aimes.',
  },
  watchlist: {
    title: 'À voir',
    intro: 'Ta liste de films à regarder plus tard.',
    emptyTitle: 'Ta liste est vide',
    emptyText: 'Depuis la fiche d’un film, choisis « À voir plus tard » pour le retrouver ici.',
  },
};

/** Page de liste personnelle (favoris ou à voir). */
export default function MyLists({ kind }) {
  const copy = COPY[kind];
  const { has, toggle, pending } = useLibrary();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync((signal) => libraryService.list(KINDS[kind].api, page, signal), [kind, page]);
  useDocumentTitle(copy.title);

  // Un film retiré disparaît tout de suite de la liste (l'état local fait foi)
  const movies = (data?.results ?? []).filter((m) => has(kind, m.id));

  return (
    <div className="container page">
      <div className="page__head">
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <GridSkeleton count={8} />
      ) : movies.length === 0 ? (
        <EmptyState icon={kind === 'favorites' ? 'heart' : 'bookmark'} title={copy.emptyTitle} actions={<Link to="/search" className="btn btn--primary">Explorer le catalogue <Icon name="arrow" /></Link>}>
          {copy.emptyText}
        </EmptyState>
      ) : (
        <>
          <p className="result-count">{data.totalResults} film{data.totalResults > 1 ? 's' : ''}</p>
          <div className="movie-grid">
            {movies.map((m) => (
              <div key={m.id}>
                <MovieCard movie={m} />
                {kind === 'watchlist' && (
                  <button type="button" className="btn btn--ghost btn--sm" disabled={pending.has(`${kind}:${m.id}`)} onClick={() => toggle(kind, m.id)}>
                    <Icon name="x" /> Retirer
                  </button>
                )}
              </div>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={(p) => { setPage(p); window.scrollTo({ top: 0 }); }} />
        </>
      )}
    </div>
  );
}
