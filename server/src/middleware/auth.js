import jwt from 'jsonwebtoken';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { forbidden, unauthorized } from '../utils.js';

const ALGORITHM = 'HS256';

export function signToken(userId, secret, expiresInSeconds = 7 * 24 * 60 * 60) {
  return jwt.sign({ sub: String(userId) }, secret, { algorithm: ALGORITHM, expiresIn: expiresInSeconds });
}

/** Retourne l'id utilisateur (string) ou null si le jeton est invalide/expiré. L'algorithme est imposé. */
export function verifyToken(token, secret) {
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export const rowToUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  avatarUrl: row.avatar_url,
  createdAt: row.created_at,
});

async function loadUser(req, config) {
  const token = req.cookies?.[config.cookie.name];
  if (!token) return null;
  const userId = verifyToken(token, config.jwtSecret);
  if (!userId || !/^\d+$/.test(userId)) return null;
  // On relit l'utilisateur en base : un compte supprimé perd immédiatement l'accès.
  const { rows } = await query('SELECT id, username, email, avatar_url, created_at FROM users WHERE id = $1', [userId]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

/** Route privée : 401 si aucune session valide. Place l'utilisateur dans req.user. */
export const requireAuth = (config) => async (req, _res, next) => {
  try {
    const user = await loadUser(req, config);
    if (!user) return next(unauthorized());
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** Route publique enrichie : req.user est défini si la session est valide, sinon on continue anonymement. */
export const optionalAuth = (config) => async (req, _res, next) => {
  try {
    req.user = (await loadUser(req, config)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'cinetheque';

/**
 * Défense CSRF en profondeur : les requêtes qui modifient des données doivent porter un en-tête
 * personnalisé. Un site tiers ne peut pas l'envoyer sans passer par CORS, qui n'autorise que notre origine.
 */
export function requireCustomHeader(req, _res, next) {
  if (MUTATING.has(req.method) && req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(forbidden('En-tête de sécurité manquant.'));
  }
  next();
}

export function corsMiddleware(allowedOrigins) {
  return cors({
    origin(origin, callback) {
      // Pas d'en-tête Origin : requête même origine, curl ou serveur à serveur → pas de CORS à appliquer
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    maxAge: 600,
  });
}

const limitMessage = { error: { code: 'rate_limited', message: 'Trop de requêtes. Réessaie dans quelques minutes.' } };

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage,
});

/** Inscription : limite stricte. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage,
});

/** Connexion : seules les tentatives échouées comptent (anti force brute). */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage,
});

/** Écritures (favoris, avis, etc.) : plafond raisonnable par IP. */
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  skip: (req) => !MUTATING.has(req.method),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage,
});
