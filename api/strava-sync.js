// Fetches recent Strava activities and returns them as session objects for the app
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: row, error } = await sb.from('moe_app_state').select('data').eq('id', 'moe').single();
  if (error || !row) return res.status(500).json({ error: 'Could not load state from Supabase' });

  let strava = row.data?.strava;
  if (!strava?.access_token) return res.status(401).json({ error: 'not_connected' });

  // Refresh access token if it expires within 5 minutes
  if (Date.now() / 1000 > strava.expires_at - 300) {
    const r = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: strava.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    const refreshed = await r.json();
    if (!refreshed.access_token) return res.status(401).json({ error: 'token_refresh_failed' });
    strava = { ...strava, access_token: refreshed.access_token, expires_at: refreshed.expires_at };
    await sb.from('moe_app_state').update({
      data: { ...row.data, strava },
    }).eq('id', 'moe');
  }

  // Fetch the 50 most recent activities from Strava
  const activitiesRes = await fetch(
    'https://www.strava.com/api/v3/athlete/activities?per_page=50',
    { headers: { Authorization: `Bearer ${strava.access_token}` } }
  );
  if (!activitiesRes.ok) return res.status(502).json({ error: 'Strava API error', status: activitiesRes.status });

  const activities = await activitiesRes.json();

  const sessions = activities
    .filter(a => a.type === 'Run' || a.sport_type === 'Run' || a.type === 'TrailRun' || a.sport_type === 'TrailRun')
    .map(a => ({
      id: `strava_${a.id}`,
      type: 'run',
      date: a.start_date_local.slice(0, 10),
      title: a.name,
      distance: Math.round(a.distance / 10) / 100,          // metres → km (1 dp)
      duration: Math.round(a.moving_time / 60),              // seconds → minutes
      pace: formatPace(a.moving_time / (a.distance / 1000)), // → M:SS per km
      hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      elevation: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null,
      source: 'strava',
    }));

  res.json({ sessions });
};

function formatPace(secsPerKm) {
  if (!secsPerKm || !isFinite(secsPerKm)) return null;
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
