/**
 * Minimal token service. Its only job: swap a short-lived Facebook user token
 * (from the browser login) for a long-lived (~60 day) one. That swap requires
 * the App Secret, which must never be shipped in browser code.
 * Page tokens fetched with the long-lived token do not expire on a timer.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');

const { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_API_VERSION = 'v19.0', PORT = 3000 } = process.env;
if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
  console.error('Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in server/.env');
  process.exit(1);
}

const app = express();
app.use(express.json());

app.post('/api/extend-token', async (req, res) => {
  const { userToken } = req.body || {};
  if (!userToken) return res.status(400).json({ error: 'Missing userToken.' });

  const url = new URL(`https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', FACEBOOK_APP_ID);
  url.searchParams.set('client_secret', FACEBOOK_APP_SECRET);
  url.searchParams.set('fb_exchange_token', userToken);

  try {
    const r = await fetch(url);
    const json = await r.json();
    if (!r.ok || json.error) {
      console.error('extend-token failed:', json.error?.message);
      return res.status(400).json({ error: json.error?.message || 'Token exchange failed.' });
    }
    console.log(`extend-token ok (expires_in=${json.expires_in ?? 'n/a'}s)`);
    res.json({ accessToken: json.access_token, expiresIn: json.expires_in ?? null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Local development only: listen on loopback so it isn't reachable from the network.
app.listen(PORT, '127.0.0.1', () => console.log(`Token service on http://localhost:${PORT}`));
