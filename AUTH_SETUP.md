# Authentication setup

1. Install Node.js 22.13 or newer.
2. Run `npm install`, then `npm start` in this folder.
3. Open `http://localhost:3000` and create an account from the login screen. Do not open `index.html` directly or use a static preview such as Live Server; signup and login require the Node.js API.
4. Run `npm test` to verify the authentication flow.

The SQLite database is created automatically at `data/prabhat-vachan.sqlite`. Set `DATABASE_PATH` to use another location.

For production, set a private `SESSION_SECRET` containing at least 32 characters, set `NODE_ENV=production`, configure `HOST` for your deployment, and use HTTPS. The database and secret must not be exposed or committed.
