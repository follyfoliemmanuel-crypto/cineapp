import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, formatScore, formatYear, imageUrl, posterSrcSet } from '../utils.jsx';
import { useLibrary } from '../context/AuthContext.jsx';

/** Affiche d'un film : chargement paresseux, repli lisible si l'image manque ou échoue. */
export function Poster({ path, title, sizes = '(min-width: 1024px) 176px, 160px', priority = false, className = '' }) {
  const [failed, setFailed] = useState(false);

  if (!path || failed) {
    return (
      <div className={`poster poster--empty ${className}`} role="img" aria-label={`Affiche indisponible : ${title}`}>
        <div>
          <Icon name="film" />
          <span>{title}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`poster ${className}`}>
      <img
        src={imageUrl(path, 'w342')}
        srcSet={posterSrcSet(path)}
        sizes={sizes}
        alt={`Affiche de ${title}`}
        width="342"
        height="513"
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchpriority={priority ? 'high' : undefined}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

const ACTIONS = [
  { kind: 'favorites', icon: 'heart', on: 'Dans mes favoris', off: 'Ajouter aux favoris' },
  { kind: 'watchlist', icon: 'bookmark', on: 'Dans ma liste', off: 'À voir plus tard' },
  { kind: 'watched', icon: 'check', on: 'Déjà vu', off: 'Marquer comme vu' },
];

export function FilmActions({ movieId, primary = false }) {
  const { has, toggle, pending } = useLibrary();
  return (
    <div className="film__actions">
      {ACTIONS.map((a, i) => {
        const active = has(a.kind, movieId);
        const isPrimary = primary && i === 0 && !active;
        return (
          <button
            key={a.kind}
            type="button"
            className={`btn ${isPrimary ? 'btn--primary' : 'btn--secondary'}`}
            aria-pressed={active}
            aria-busy={pending.has(`${a.kind}:${movieId}`)}
            onClick={() => toggle(a.kind, movieId)}
          >
            <Icon name={a.icon} filled={active} />
            {active ? a.on : a.off}
          </button>
        );
      })}
    </div>
  );
}

export default function MovieCard({ movie }) {
  const { has, toggle, pending } = useLibrary();
  const isFavorite = has('favorites', movie.id);
  const score = formatScore(movie.voteAverage);
  const year = formatYear(movie.releaseDate);

  return (
    <article className="movie-card">
      <Link to={`/movie/${movie.id}`} className="movie-card__link">
        <Poster path={movie.posterPath} title={movie.title} />
        <h3 className="movie-card__title">{movie.title}</h3>
      </Link>
      <p className="movie-card__meta">
        {year && <span>{year}</span>}
        {score && (
          <span className="score" aria-label={`Note ${score} sur 10`}>
            <Icon name="star" filled />
            {score}
          </span>
        )}
      </p>
      <button
        type="button"
        className="card-action"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Retirer ${movie.title} des favoris` : `Ajouter ${movie.title} aux favoris`}
        disabled={pending.has(`favorites:${movie.id}`)}
        onClick={() => toggle('favorites', movie.id)}
      >
        <Icon name="heart" filled={isFavorite} />
      </button>
    </article>
  );
}
