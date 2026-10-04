import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth, useToast } from '../context/AuthContext.jsx';
import { Icon, formatDate, formatRuntime, formatScore, formatYear, imageUrl, plural, useAsync, useDocumentTitle } from '../utils.jsx';
import { movieService, reviewService } from '../services/api.js';
import { EmptyState, ErrorState, MovieRow, Pagination } from '../components/MovieGrid.jsx';
import { FilmActions, Poster } from '../components/MovieCard.jsx';

const MAX = 2000;

function ReviewForm({ initial, onSubmit, onCancel, busy, serverFields }) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [ratingError, setRatingError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!rating) { setRatingError('Choisis une note de 1 à 10.'); return; }
    setRatingError('');
    onSubmit({ rating, comment: comment.trim() || null });
  };

  const commentError = serverFields?.comment;
  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <div className="field" role="radiogroup" aria-labelledby="rating-label" aria-describedby={ratingError ? 'rating-error' : undefined}>
        <span className="field-label" id="rating-label">Ta note sur 10</span>
        <div className="rating-scale">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} sur 10`} onClick={() => { setRating(n); setRatingError(''); }}>{n}</button>
          ))}
        </div>
        {ratingError && <p className="error-text" id="rating-error" role="alert">{ratingError}</p>}
      </div>

      <div className="field">
        <label htmlFor="review-comment">Ton avis <span className="hint">(facultatif)</span></label>
        <textarea
          id="review-comment" className="textarea" value={comment} maxLength={MAX}
          onChange={(e) => setComment(e.target.value)}
          aria-invalid={Boolean(commentError)} aria-describedby="review-count"
          placeholder="Ce que tu as aimé, ce qui t’a manqué…"
        />
        <span className="hint" id="review-count">{comment.length} / {MAX}</span>
        {commentError && <p className="error-text" role="alert">{commentError}</p>}
      </div>

      <div className="film__actions">
        <button type="submit" className="btn btn--primary" aria-busy={busy} disabled={busy}>
          {initial ? 'Enregistrer les modifications' : 'Publier mon avis'}
        </button>
        {onCancel && <button type="button" className="btn btn--ghost" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}

function ReviewItem({ review, mine, onEdit, onDelete, busy }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={`review ${mine ? 'review--mine' : ''}`}>
      <div className="review__head">
        <span className="avatar">{review.user.avatarUrl ? <img src={review.user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : review.user.username[0]}</span>
        <strong>{mine ? 'Ton avis' : review.user.username}</strong>
        <span className="score"><Icon name="star" filled />{review.rating}/10</span>
        <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
      </div>
      {review.comment && <p className="review__body">{review.comment}</p>}
      {mine && (
        <div className="review__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit}><Icon name="pencil" /> Modifier</button>
          {confirming ? (
            <>
              <button type="button" className="btn btn--danger btn--sm" onClick={onDelete} disabled={busy}>Confirmer la suppression</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(false)}>Annuler</button>
            </>
          ) : (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(true)}><Icon name="trash" /> Supprimer</button>
          )}
        </div>
      )}
    </li>
  );
}

export function ReviewSection({ movieId }) {
  const { user } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState(null);
  const { data, error, loading, reload } = useAsync((signal) => reviewService.forMovie(movieId, page, signal), [movieId, page, user?.id]);

  const run = async (action, successMessage) => {
    setBusy(true);
    setFields(null);
    try {
      await action();
      toast.success(successMessage);
      setEditing(false);
      reload();
    } catch (err) {
      setFields(err.fields ?? null);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const others = (data?.results ?? []).filter((r) => r.id !== data?.mine?.id);

  return (
    <section className="reviews" aria-labelledby="reviews-title">
      <div>
        <h2 id="reviews-title">Avis des spectateurs</h2>
        {data && data.totalResults > 0 && (
          <p className="reviews__summary">
            <span className="score"><Icon name="star" filled />{String(data.average).replace('.', ',')}/10</span>
            <span>{plural(data.totalResults, 'avis', 'avis')}</span>
          </p>
        )}
      </div>

      {!user ? (
        <p className="banner banner--ok">
          <Link to="/login" state={{ from: location.pathname }}>Connecte-toi</Link> pour noter ce film et publier ton avis.
        </p>
      ) : data?.mine && !editing ? null : (
        !loading && (
          <ReviewForm
            initial={data?.mine ?? undefined}
            busy={busy}
            serverFields={fields}
            onCancel={data?.mine ? () => setEditing(false) : undefined}
            onSubmit={(payload) =>
              data?.mine
                ? run(() => reviewService.update(data.mine.id, payload), 'Avis mis à jour')
                : run(() => reviewService.create(movieId, payload), 'Avis publié')
            }
          />
        )
      )}

      {error ? (
        <ErrorState error={error} onRetry={reload} title="Les avis n’ont pas pu être chargés" />
      ) : (
        <ul className="review-list" aria-busy={loading}>
          {data?.mine && !editing && (
            <ReviewItem review={data.mine} mine busy={busy} onEdit={() => setEditing(true)} onDelete={() => run(() => reviewService.remove(data.mine.id), 'Avis supprimé')} />
          )}
          {others.map((r) => <ReviewItem key={r.id} review={r} />)}
          {!loading && !data?.mine && others.length === 0 && (
            <li className="review"><p>Aucun avis pour l’instant. Sois le premier à donner le tien.</p></li>
          )}
        </ul>
      )}
      <Pagination page={page} totalPages={data?.totalPages} onChange={setPage} />
    </section>
  );
}

function MovieSkeleton() {
  return (
    <div className="container page" aria-busy="true" aria-label="Chargement de la fiche">
      <div className="film__layout">
        <div className="skeleton skeleton--poster film__poster" />
        <div className="film__info">
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--block" />
        </div>
      </div>
    </div>
  );
}

export default function MovieDetails() {
  const { id } = useParams();
  const valid = /^\d{1,10}$/.test(id);
  const { data, error, loading, reload } = useAsync((signal) => movieService.details(id, signal), [id], { enabled: valid });
  const similar = useAsync((signal) => movieService.similar(id, signal), [id], { enabled: valid });

  const movie = data?.movie;
  useDocumentTitle(movie ? `${movie.title}${formatYear(movie.releaseDate) ? ` (${formatYear(movie.releaseDate)})` : ''}` : 'Film');

  if (!valid || error?.status === 404) {
    return (
      <div className="container page">
        <EmptyState icon="film" title="Film introuvable" actions={<Link to="/search" className="btn btn--primary">Explorer le catalogue</Link>}>
          Ce film n’existe pas ou a été retiré du catalogue.
        </EmptyState>
      </div>
    );
  }
  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} title="La fiche n’a pas pu être chargée" /></div>;
  if (loading && !movie) return <MovieSkeleton />;

  const score = formatScore(movie.voteAverage);
  const year = formatYear(movie.releaseDate);
  const runtime = formatRuntime(movie.runtime);
  const showOriginal = movie.originalTitle && movie.originalTitle !== movie.title;

  return (
    <article>
      <div className={`film__backdrop ${movie.backdropPath ? '' : 'film__backdrop--empty'}`}>
        {movie.backdropPath && (
          <img src={imageUrl(movie.backdropPath, 'w1280')} srcSet={`${imageUrl(movie.backdropPath, 'w780')} 780w, ${imageUrl(movie.backdropPath, 'w1280')} 1280w`} sizes="100vw" alt="" width="1280" height="720" fetchpriority="high" decoding="async" />
        )}
      </div>

      <div className="container">
        <div className="film__layout">
          <Poster path={movie.posterPath} title={movie.title} className="film__poster" sizes="(min-width: 760px) 260px, 220px" priority />

          <div className="film__info">
            <h1 className="film__title">
              {movie.title}
              {showOriginal && <small>Titre original : {movie.originalTitle}</small>}
            </h1>

            <p className="film__meta">
              {year && <span>{year}</span>}
              {runtime && <span>{runtime}</span>}
              {movie.countries.length > 0 && <span>{movie.countries.join(', ')}</span>}
              {movie.releaseDate && <span>Sortie le {formatDate(movie.releaseDate)}</span>}
            </p>

            {movie.genres.length > 0 && (
              <ul className="tag-list" aria-label="Genres">
                {movie.genres.map((g) => <li key={g.id}><Link className="tag" to={`/search?genre=${g.id}`}>{g.name}</Link></li>)}
              </ul>
            )}

            {score && (
              <p className="film__rating">
                <span className="big" aria-label={`Note ${score} sur 10`}>{score}</span>
                <span className="of">/ 10 · {plural(movie.voteCount, 'vote', 'votes')}</span>
              </p>
            )}

            {movie.tagline && <p className="film__tagline">{movie.tagline}</p>}
            <p className="film__overview">{movie.overview ?? 'Aucun synopsis disponible en français pour ce film.'}</p>

            <dl className="film__facts">
              {movie.director && <div><dt>Réalisation : </dt><dd>{movie.director}</dd></div>}
              {movie.originalLanguage && <div><dt>Langue originale : </dt><dd>{languageName(movie.originalLanguage)}</dd></div>}
            </dl>

            <FilmActions movieId={movie.id} primary />
          </div>
        </div>

        <div className="stack section">
          {movie.cast.length > 0 && (
            <section aria-labelledby="cast-title">
              <h2 id="cast-title" className="section__title">Distribution</h2>
              <ul className="cast">
                {movie.cast.map((p) => (
                  <li key={`${p.personId}-${p.order}`} className="cast__person">
                    <Poster path={p.profilePath} title={p.name} sizes="112px" />
                    <strong>{p.name}</strong>
                    {p.character && <span>{p.character}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ReviewSection movieId={movie.id} />

          {(similar.loading || similar.data?.results.length > 0) && (
            <MovieRow headingId="similar-title" title="Films similaires" movies={similar.data?.results ?? []} loading={similar.loading} />
          )}
        </div>
      </div>
    </article>
  );
}

function languageName(code) {
  try {
    return new Intl.DisplayNames(['fr'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
