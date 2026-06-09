// Vercel serverless function: exchanges a Strava OAuth code for tokens,
// or refreshes an expired access token. The client secret never leaves here.
//
// Env vars (set in Vercel project settings):
//   STRAVA_CLIENT_ID
//   STRAVA_CLIENT_SECRET

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res
      .status(500)
      .json({ error: "STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not configured" });
  }

  const body = req.body || {};
  const params = {
    client_id: clientId,
    client_secret: clientSecret,
  };

  if (body.code) {
    params.code = String(body.code);
    params.grant_type = "authorization_code";
  } else if (body.refresh_token) {
    params.refresh_token = String(body.refresh_token);
    params.grant_type = "refresh_token";
  } else {
    return res.status(400).json({ error: "Provide code or refresh_token" });
  }

  try {
    const stravaRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await stravaRes.json();

    if (!stravaRes.ok) {
      return res.status(stravaRes.status).json({
        error: data.message || "Strava token request failed",
        details: data.errors || null,
      });
    }

    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete_id: data.athlete ? data.athlete.id : null,
    });
  } catch (err) {
    return res.status(502).json({ error: `Strava request error: ${err.message || err}` });
  }
};
