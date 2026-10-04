import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authService, libraryService, setUnauthorizedHandler } from '../services/api.js';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((message, type = 'info') => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-2), { id, message, type }]);
    setTimeout(() => dismiss(id), type === 'error' ? 6000 : 3500);
  }, [dismiss]);

  const api = useMemo(() => ({
    info: (m) => push(m, 'info'),
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Région live : annoncée par les lecteurs d'écran sans voler le focus */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            <span>{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)}>Fermer</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans <ToastProvider>');
  return ctx;
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    authService.me(controller.signal)
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  // Session expirée détectée par une requête protégée
  useEffect(() => { setUnauthorizedHandler(() => setUser(null)); }, []);

  const login = useCallback(async (credentials) => {
    const data = await authService.login(credentials);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (input) => {
    const data = await authService.register(input);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await authService.logout(); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout, setUser }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
};

const LibraryContext = createContext(null);
const EMPTY = { favorites: new Set(), watchlist: new Set(), watched: new Set() };

// Libellés et routes d'API de chacune des trois listes
export const KINDS = {
  favorites: { api: 'favorites', add: 'Ajouté aux favoris', remove: 'Retiré des favoris' },
  watchlist: { api: 'watchlist', add: 'Ajouté à ta liste « À voir »', remove: 'Retiré de ta liste « À voir »' },
  watched: { api: 'watch-history', add: 'Marqué comme vu', remove: 'Retiré des films vus' },
};

/** État des favoris / à voir / vus de l'utilisateur, avec mises à jour optimistes. */
export function LibraryProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [ids, setIds] = useState(EMPTY);
  const [pending, setPending] = useState(() => new Set());

  useEffect(() => {
    if (!user) { setIds(EMPTY); return undefined; }
    const controller = new AbortController();
    libraryService.ids(controller.signal)
      .then((d) => setIds({ favorites: new Set(d.favorites), watchlist: new Set(d.watchlist), watched: new Set(d.watched) }))
      .catch(() => {});
    return () => controller.abort();
  }, [user]);

  const has = useCallback((kind, id) => ids[kind].has(id), [ids]);

  const setMembership = (kind, id, present) =>
    setIds((prev) => {
      const next = new Set(prev[kind]);
      if (present) next.add(id); else next.delete(id);
      return { ...prev, [kind]: next };
    });

  const toggle = useCallback(async (kind, movieId) => {
    if (!user) {
      toast.info('Connecte-toi pour gérer tes listes.');
      navigate('/login', { state: { from: location.pathname + location.search } });
      return false;
    }
    const key = `${kind}:${movieId}`;
    if (pending.has(key)) return false;
    const wasPresent = ids[kind].has(movieId);
    setPending((p) => new Set(p).add(key));
    setMembership(kind, movieId, !wasPresent); // optimiste
    try {
      if (wasPresent) await libraryService.remove(KINDS[kind].api, movieId);
      else await libraryService.add(KINDS[kind].api, movieId);
      toast.success(wasPresent ? KINDS[kind].remove : KINDS[kind].add);
      return true;
    } catch (err) {
      setMembership(kind, movieId, wasPresent); // annulation
      toast.error(err.message);
      return false;
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  }, [user, ids, pending, toast, navigate, location]);

  const value = useMemo(() => ({ has, toggle, pending }), [has, toggle, pending]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export const useLibrary = () => {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary doit être utilisé dans <LibraryProvider>');
  return ctx;
};
