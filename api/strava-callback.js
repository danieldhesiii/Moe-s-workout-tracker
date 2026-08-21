// Handles Strava OAuth callback — exchanges code for tokens, stores in Supabase
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  const { code, error } = req.query;

  if (error) return res.redirect(302, '/?strava=denied');
  if (!code) return res.status(400).json({ error: 'No code provided' });

  // Exchange authorisation code for access + refresh tokens
  const tokenRes = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return res.status(400).json({ error: 'Token exchange failed', detail: tokens });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Fetch current row so we only update the strava sub-key, not overwrite everything
  const { data: row } = await sb.from('moe_app_state').select('data').eq('id', 'moe').single();
  const current = row?.data || {};

  await sb.from('moe_app_state').update({
    data: {
      ...current,
      strava: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
        athlete_id: tokens.athlete?.id,
      },
    },
  }).eq('id', 'moe');

  res.redirect(302, '/?strava=connected');
};
