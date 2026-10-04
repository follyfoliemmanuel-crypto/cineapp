import { Router } from 'express';
import { loginLimiter, optionalAuth, registerLimiter, requireAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils.js';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { rowToUser, signToken } from '../middleware/auth.js';
import { badRequest, conflict, parse, schemas, unauthorized } from '../utils.js';

const BCRYPT_COST = 12;
// Hash factice : comparé quand l'e-mail est inconnu pour garder un temps de réponse similaire
const DUMMY_HASH = bcrypt.hashSync('mot-de-passe-factice-pour-timing', BCRYPT_COST);

export function createAuthController(config) {
  const cookieOptions = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
  };

  const startSession = (res, userId) =>
    res.cookie(config.cookie.name, signToken(userId, config.jwtSecret), { ...cookieOptions, maxAge: config.cookie.maxAgeMs });

  return {
    async register(req, res) {
      const { username, email, password } = parse(schemas.register, req.body);
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      try {
        const { rows } = await query(
          `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)
           RETURNING id, username, email, avatar_url, created_at`,
          [username, email, passwordHash],
        );
        startSession(res, rows[0].id);
        res.status(201).json({ user: rowToUser(rows[0]) });
      } catch (err) {
        if (err.code === '23505') {
          const field = String(err.constraint).includes('email') ? 'email' : 'username';
          const message = field === 'email' ? 'Cette adresse e-mail est déjà utilisée.' : "Ce nom d'utilisateur est déjà pris.";
          throw Object.assign(conflict(message), { details: { [field]: message } });
        }
        throw err;
      }
    },

    async login(req, res) {
      const { email, password } = parse(schemas.login, req.body);
      const { rows } = await query(
        'SELECT id, username, email, avatar_url, created_at, password_hash FROM users WHERE email = $1',
        [email],
      );
      const user = rows[0];
      const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !valid) throw unauthorized('E-mail ou mot de passe incorrect.');
      startSession(res, user.id);
      res.json({ user: rowToUser(user) });
    },

    logout(_req, res) {
      res.clearCookie(config.cookie.name, cookieOptions);
      res.status(204).end();
    },

    me(req, res) {
      res.json({ user: req.user });
    },

    async updateProfile(req, res) {
      const input = parse(schemas.profileUpdate, req.body);
      const sets = [];
      const values = [];
      if (input.username !== undefined) {
        values.push(input.username);
        sets.push(`username = $${values.length}`);
      }
      if (input.avatarUrl !== undefined) {
        values.push(input.avatarUrl === '' ? null : input.avatarUrl);
        sets.push(`avatar_url = $${values.length}`);
      }
      if (!sets.length) throw badRequest('Aucune modification fournie.');
      values.push(req.user.id);
      try {
        const { rows } = await query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}
           RETURNING id, username, email, avatar_url, created_at`,
          values,
        );
        res.json({ user: rowToUser(rows[0]) });
      } catch (err) {
        if (err.code === '23505') {
          throw Object.assign(conflict("Ce nom d'utilisateur est déjà pris."), {
            details: { username: "Ce nom d'utilisateur est déjà pris." },
          });
        }
        throw err;
      }
    },
  };
}

export async function getProfile(req, res) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM favorites     WHERE user_id = $1) AS favorites,
       (SELECT count(*)::int FROM watchlist     WHERE user_id = $1) AS watchlist,
       (SELECT count(*)::int FROM watch_history WHERE user_id = $1) AS watched,
       (SELECT count(*)::int FROM reviews       WHERE user_id = $1) AS reviews`,
    [req.user.id],
  );
  res.json({ user: req.user, stats: rows[0] });
}

export function authRoutes({ config }) {
  const router = Router();
  const auth = requireAuth(config);
  const maybeAuth = optionalAuth(config);
  const ctl = createAuthController(config);

  router.post('/auth/register', registerLimiter, h(ctl.register));
  router.post('/auth/login', loginLimiter, h(ctl.login));
  router.post('/auth/logout', ctl.logout);
  // 200 + { user: null } si non connecté : pas de 401 parasite au chargement de l'application
  router.get('/auth/me', maybeAuth, (req, res) => res.json({ user: req.user ?? null }));
  router.get('/profile', auth, h(getProfile));
  router.patch('/profile', auth, h(ctl.updateProfile));
  return router;
}
