const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const { rateLimit } = require('express-rate-limit');

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'pv_session';
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = '8e8d1c48b81207a9269a231ea0a8727f';
const DUMMY_PASSWORD_HASH = `scrypt$${DUMMY_SALT}$${crypto.scryptSync(
    'invalid-user-password',
    DUMMY_SALT,
    PASSWORD_HASH_BYTES,
    PASSWORD_SCRYPT_OPTIONS
).toString('hex')}`;

const protectedPages = new Set([
    'dashboard.html',
    'reader.html',
    'character.html',
    'shop.html',
    'subscribe.html',
    'angular-reviews.html',
    'react-recommendations.html'
]);

function createApplication(options = {}) {
    const publicDir = options.publicDir || __dirname;
    const databasePath = options.databasePath || process.env.DATABASE_PATH || path.join(__dirname, 'data', 'prabhat-vachan.sqlite');
    const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    const secureCookies = options.secureCookies === undefined
        ? process.env.NODE_ENV === 'production'
        : options.secureCookies;

    if (process.env.NODE_ENV === 'production' && !options.sessionSecret && !process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET must be set in production.');
    }
    if (sessionSecret.length < 32) {
        throw new Error('SESSION_SECRET must contain at least 32 characters.');
    }

    if (databasePath !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }

    const db = new DatabaseSync(databasePath);
    db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL,
            email TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            csrf_token TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions(expires_at);
    `);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        next();
    });
    app.use(express.json({ limit: '10kb' }));
    app.use('/api', (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    const getCookieValue = (cookieHeader, name) => {
        if (!cookieHeader) return null;
        const prefix = `${name}=`;
        const entry = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
        return entry ? entry.slice(prefix.length) : null;
    };

    const signatureFor = sessionId => crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('base64url');
    const safeEqual = (left, right) => {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
    };

    const issueCookie = (res, sessionId) => {
        const parts = [
            `${SESSION_COOKIE}=${sessionId}.${signatureFor(sessionId)}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Lax',
            `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
        ];
        if (secureCookies) parts.push('Secure');
        res.setHeader('Set-Cookie', parts.join('; '));
    };

    const clearCookie = res => {
        const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
        if (secureCookies) parts.push('Secure');
        res.setHeader('Set-Cookie', parts.join('; '));
    };

    const lookupSession = req => {
        const cookie = getCookieValue(req.headers.cookie, SESSION_COOKIE);
        if (!cookie) return null;

        const separator = cookie.indexOf('.');
        if (separator <= 0 || separator === cookie.length - 1) return null;

        const sessionId = cookie.slice(0, separator);
        const signature = cookie.slice(separator + 1);
        if (!/^[A-Za-z0-9_-]{40,50}$/.test(sessionId) || !safeEqual(signatureFor(sessionId), signature)) {
            return null;
        }

        const tokenHash = crypto.createHash('sha256').update(sessionId).digest('hex');
        const session = db.prepare(`
            SELECT s.token_hash, s.user_id, s.csrf_token, s.expires_at,
                   u.display_name, u.email
            FROM sessions s
            LEFT JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
        `).get(tokenHash);

        if (!session || session.expires_at <= Date.now()) {
            if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
            return null;
        }

        return {
            tokenHash: session.token_hash,
            csrfToken: session.csrf_token,
            user: session.user_id === null
                ? null
                : { id: session.user_id, displayName: session.display_name, email: session.email }
        };
    };

    app.use((req, res, next) => {
        req.authSession = lookupSession(req);
        req.user = req.authSession ? req.authSession.user : null;
        next();
    });

    const createSession = (res, userId) => {
        const sessionId = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(sessionId).digest('hex');
        const csrfToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + SESSION_TTL_MS;
        db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
            .run(tokenHash, userId, csrfToken, expiresAt);
        issueCookie(res, sessionId);
        return csrfToken;
    };

    const rotateSession = (req, res, userId) => {
        if (req.authSession) {
            db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.authSession.tokenHash);
        }
        return createSession(res, userId);
    };

    const requireCsrf = (req, res, next) => {
        const providedToken = req.get('X-CSRF-Token');
        if (!req.authSession || !providedToken || !safeEqual(req.authSession.csrfToken, providedToken)) {
            return res.status(403).json({ error: 'Your session expired. Refresh the page and try again.' });
        }
        next();
    };

    const requireAuth = (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!req.user) {
            const returnTo = encodeURIComponent(req.path);
            return res.redirect(302, `/index.html?returnTo=${returnTo}`);
        }
        next();
    };

    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' }
    });

    const publicUser = user => ({
        id: user.id,
        displayName: user.display_name,
        email: user.email
    });

    app.get('/api/auth/me', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const csrfToken = req.authSession
            ? req.authSession.csrfToken
            : createSession(res, null);
        res.json({ user: req.user, csrfToken });
    });

    app.post('/api/auth/register', authLimiter, requireCsrf, async (req, res) => {
        const { displayName, email, password } = req.body || {};
        if (typeof displayName !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Enter your name, email, and password.' });
        }

        const cleanName = displayName.trim();
        const cleanEmail = email.trim().toLowerCase();
        if (cleanName.length < 2 || cleanName.length > 80) {
            return res.status(400).json({ error: 'Your name must be between 2 and 80 characters.' });
        }
        if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
            return res.status(400).json({ error: 'Enter a valid email address.' });
        }
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({ error: 'Choose a password between 8 and 128 characters.' });
        }

        const passwordHash = await hashPassword(password);
        const result = db.prepare(`
            INSERT INTO users (display_name, email, password_hash)
            VALUES (?, ?, ?)
            ON CONFLICT(email) DO NOTHING
        `).run(cleanName, cleanEmail, passwordHash);
        if (result.changes === 0) {
            return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
        }

        const user = db.prepare('SELECT id, display_name, email FROM users WHERE id = ?').get(result.lastInsertRowid);
        const csrfToken = rotateSession(req, res, user.id);
        res.status(201).json({ user: publicUser(user), csrfToken });
    });

    app.post('/api/auth/login', authLimiter, requireCsrf, async (req, res) => {
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || typeof password !== 'string'
            || email.length > 254 || password.length > 128) {
            return res.status(400).json({ error: 'Enter a valid email and password.' });
        }

        const user = db.prepare('SELECT id, display_name, email, password_hash FROM users WHERE email = ?')
            .get(email.trim().toLowerCase());
        const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
        if (!user || !passwordMatches) {
            return res.status(401).json({ error: 'Email or password is incorrect.' });
        }

        const csrfToken = rotateSession(req, res, user.id);
        res.json({ user: publicUser(user), csrfToken });
    });

    app.post('/api/auth/logout', requireAuth, requireCsrf, (req, res) => {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.authSession.tokenHash);
        clearCookie(res);
        res.status(204).end();
    });

    app.get('/', (req, res) => res.redirect('/index.html'));

    app.use('/css', express.static(path.join(publicDir, 'css'), { fallthrough: false, index: false }));
    app.use('/images', express.static(path.join(publicDir, 'images'), { fallthrough: false, index: false }));
    app.use('/js', express.static(path.join(publicDir, 'js'), { fallthrough: false, index: false }));

    app.get('/index.html', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
    for (const page of protectedPages) {
        app.get(`/${page}`, requireAuth, (req, res) => res.sendFile(path.join(publicDir, page)));
    }

    app.use((req, res) => res.status(404).send('Not found'));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.status && error.status < 500) {
            return res.status(error.status).json({ error: 'The request could not be processed.' });
        }
        console.error('Request failed:', error);
        res.status(500).json({ error: 'A server error occurred. Please try again.' });
    });

    return {
        app,
        close: () => db.close()
    };
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scrypt(password, salt, PASSWORD_HASH_BYTES, PASSWORD_SCRYPT_OPTIONS);
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    const [algorithm, salt, expectedHex, extra] = storedHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !expectedHex || extra
        || !/^[a-f\d]{32}$/i.test(salt) || !/^[a-f\d]{128}$/i.test(expectedHex)) {
        return false;
    }
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await scrypt(password, salt, PASSWORD_HASH_BYTES, PASSWORD_SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(actual, expected);
}

if (require.main === module) {
    const { app, close } = createApplication();
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    const server = app.listen(port, host, () => {
        console.log(`Prabhat Vachan is available at http://localhost:${port}`);
    });

    const shutdown = () => {
        server.close(() => {
            close();
            process.exit(0);
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { createApplication };
