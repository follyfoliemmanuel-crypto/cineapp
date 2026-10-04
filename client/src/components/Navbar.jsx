import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useToast } from '../context/AuthContext.jsx';
import { Icon, initial } from '../utils.jsx';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <p>Cinéthèque est un catalogue de découverte : aucun film n’est diffusé sur ce site.</p>
        <p>
          Données et images fournies par <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>.
          Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.
        </p>
      </div>
    </footer>
  );
}

const NAV = [
  { to: '/', label: 'Accueil', end: true, icon: 'film' },
  { to: '/search', label: 'Explorer', icon: 'search' },
  { to: '/favorites', label: 'Favoris', icon: 'heart' },
  { to: '/watchlist', label: 'À voir', icon: 'bookmark' },
];

function SearchBox({ onDone, id }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
    setValue('');
    onDone?.();
  };
  return (
    <form className="header-search" role="search" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">Rechercher un film</label>
      <Icon name="search" />
      <input id={id} className="input" type="search" placeholder="Rechercher un film" value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} autoComplete="off" />
    </form>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const signOut = async () => {
    setOpen(false);
    await logout().catch(() => {});
    toast.info('Tu es déconnecté.');
    navigate('/');
  };

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="true" aria-expanded={open} aria-label="Menu du compte" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial(user.username)}
        </span>
      </button>
      {open && (
        <div className="user-menu__panel">
          <div className="who"><strong>{user.username}</strong><span>{user.email}</span></div>
          <Link to="/profile" onClick={() => setOpen(false)}><Icon name="user" /> Mon profil</Link>
          <button type="button" onClick={signOut}><Icon name="logout" /> Se déconnecter</button>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => { setDrawer(false); }, [location.pathname]);

  useEffect(() => {
    if (!drawer) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [drawer]);

  const mobileSignOut = async () => {
    setDrawer(false);
    await logout().catch(() => {});
    toast.info('Tu es déconnecté.');
    navigate('/');
  };

  return (
    <header className="site-header">
      <div className="container site-header__bar">
        <Link to="/" className="wordmark" aria-label="Cinéthèque — accueil">
          <Icon name="film" /> Cinéthèque
        </Link>

        <nav className="main-nav" aria-label="Navigation principale">
          {NAV.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
        </nav>

        <SearchBox id="header-search" />

        <div className="header-actions">
          {user ? (
            <span className="desktop-only"><UserMenu /></span>
          ) : (
            <span className="desktop-only">
              <Link to="/login" className="btn btn--secondary btn--sm">Connexion</Link>
            </span>
          )}
          <button type="button" className="icon-btn mobile-only" aria-label="Ouvrir le menu" aria-expanded={drawer} aria-controls="mobile-drawer" onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
        </div>
      </div>

      {drawer && (
        <>
          <div className="drawer-backdrop mobile-only" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div className="drawer mobile-only" id="mobile-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="drawer__head">
              <span className="wordmark"><Icon name="film" /> Cinéthèque</span>
              <button type="button" ref={closeRef} className="icon-btn" aria-label="Fermer le menu" onClick={() => setDrawer(false)}><Icon name="x" /></button>
            </div>
            <SearchBox id="drawer-search" onDone={() => setDrawer(false)} />
            <nav aria-label="Navigation mobile">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}><Icon name={item.icon} /> {item.label}</NavLink>
              ))}
              {user ? (
                <>
                  <NavLink to="/profile"><Icon name="user" /> Mon profil</NavLink>
                  <button type="button" onClick={mobileSignOut}><Icon name="logout" /> Se déconnecter</button>
                </>
              ) : (
                <NavLink to="/login"><Icon name="user" /> Connexion</NavLink>
              )}
            </nav>
          </div>
        </>
      )}
    </header>
  );
}
