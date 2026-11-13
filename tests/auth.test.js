const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('../server');

const sessionSecret = 'test-session-secret-with-at-least-32-characters';

async function startTestServer(t, databasePath = ':memory:') {
    const application = createApplication({
        databasePath,
        sessionSecret,
        secureCookies: false
    });
    const server = application.app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });

    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        if (server.listening) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
            });
        }
        application.close();
    };
    t.after(close);

    let cookie = '';
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close,
        get cookie() {
            return cookie;
        },
        set cookie(value) {
            cookie = value;
        },
        request: async (route, options = {}) => {
            const headers = new Headers(options.headers || {});
            if (cookie) headers.set('Cookie', cookie);
            const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
                ...options,
                headers
            });
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) cookie = setCookie.split(';', 1)[0];
            return response;
        }
    };
}

async function readCsrfToken(client) {
    const response = await client.request('/api/auth/me');
    assert.equal(response.status, 200);
    return (await response.json()).csrfToken;
}

async function postJson(client, route, csrfToken, payload) {
    return client.request(route, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(payload)
    });
}

test('signup, login, protected pages, and logout use a real session', async t => {
    const client = await startTestServer(t);
    const anonymousPage = await client.request('/reader.html', { redirect: 'manual' });
    assert.equal(anonymousPage.status, 302);
    assert.match(anonymousPage.headers.get('location'), /index\.html\?returnTo=%2Freader\.html/);

    const csrfResponse = await client.request('/api/auth/me');
    const csrfCookie = csrfResponse.headers.get('set-cookie');
    assert.match(csrfCookie, /HttpOnly/i);
    assert.match(csrfCookie, /SameSite=Lax/i);
    const csrfToken = (await csrfResponse.json()).csrfToken;
    const registration = await postJson(client, '/api/auth/register', csrfToken, {
        displayName: 'Prabhat Reader',
        email: 'reader@example.com',
        password: 'secure-password-123'
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    assert.equal(registered.user.displayName, 'Prabhat Reader');
    assert.equal(registered.user.email, 'reader@example.com');
    assert.equal(Object.hasOwn(registered.user, 'password'), false);

    const protectedPages = [
        'dashboard.html',
        'reader.html',
        'character.html',
        'shop.html',
        'subscribe.html',
        'angular-reviews.html',
        'react-recommendations.html'
    ];
    for (const page of protectedPages) {
        const response = await client.request(`/${page}`);
        assert.equal(response.status, 200, `${page} should be available to authenticated users`);
        await response.text();
    }

    const duplicate = await postJson(client, '/api/auth/register', registered.csrfToken, {
        displayName: 'Another Reader',
        email: 'READER@example.com',
        password: 'secure-password-123'
    });
    assert.equal(duplicate.status, 409);

    const logout = await postJson(client, '/api/auth/logout', registered.csrfToken, {});
    assert.equal(logout.status, 204);
    const signedOutPage = await client.request('/dashboard.html', { redirect: 'manual' });
    assert.equal(signedOutPage.status, 302);

    const loginCsrf = await readCsrfToken(client);
    const wrongPassword = await postJson(client, '/api/auth/login', loginCsrf, {
        email: 'reader@example.com',
        password: 'wrong-password'
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal((await wrongPassword.json()).error, 'Email or password is incorrect.');

    const login = await postJson(client, '/api/auth/login', loginCsrf, {
        email: 'reader@example.com',
        password: 'secure-password-123'
    });
    assert.equal(login.status, 200);
    assert.equal((await client.request('/reader.html')).status, 200);

    const finalLogout = await postJson(client, '/api/auth/logout', (await login.json()).csrfToken, {});
    assert.equal(finalLogout.status, 204);
});

test('users and authenticated sessions persist in SQLite across server restarts', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prabhat-vachan-auth-'));
    const databasePath = path.join(directory, 'auth.sqlite');
    const firstServer = await startTestServer(t, databasePath);
    let secondServer;
    try {
        const csrfToken = await readCsrfToken(firstServer);
        const registration = await postJson(firstServer, '/api/auth/register', csrfToken, {
            displayName: 'Persistent Reader',
            email: 'persistent@example.com',
            password: 'another-secure-password'
        });
        assert.equal(registration.status, 201);
        await registration.json();
        const authenticatedCookie = firstServer.cookie;
        await firstServer.close();

        secondServer = await startTestServer(t, databasePath);
        secondServer.cookie = authenticatedCookie;
        const protectedPage = await secondServer.request('/reader.html');
        assert.equal(protectedPage.status, 200);
        assert.match(await protectedPage.text(), /Book Reader/);
    } finally {
        if (secondServer) await secondServer.close();
        await firstServer.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('registration validates input and authentication requires a CSRF token', async t => {
    const client = await startTestServer(t);
    const csrfToken = await readCsrfToken(client);

    const missingCsrf = await postJson(client, '/api/auth/register', 'invalid-token', {
        displayName: 'Reader',
        email: 'reader@example.com',
        password: 'secure-password-123'
    });
    assert.equal(missingCsrf.status, 403);

    const shortPassword = await postJson(client, '/api/auth/register', csrfToken, {
        displayName: 'Reader',
        email: 'reader@example.com',
        password: 'short'
    });
    assert.equal(shortPassword.status, 400);
});
