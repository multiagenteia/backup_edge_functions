// Edge Function: reset-user-password
// TODO: implementar lógica específica desta função

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((req) => {
  return new Response("Function reset-user-password is running!", { status: 200 });
});
