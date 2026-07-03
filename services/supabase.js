const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

function getWebSocketTransport() {
  if (typeof WebSocket !== "undefined") {
    return WebSocket;
  }

  try {
    return require("ws");
  } catch (error) {
    return null;
  }
}

if (supabaseUrl && supabaseKey) {
  const transport = getWebSocketTransport();
  const options = transport
    ? {
        realtime: {
          transport,
        },
      }
    : undefined;

  supabase = createClient(supabaseUrl, supabaseKey, options);
}

module.exports = supabase;
