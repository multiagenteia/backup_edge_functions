// Edge Function: process-referral-commission
// TODO: implementar lógica específica desta função

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((req) => {
  return new Response("Function process-referral-commission is running!", { status: 200 });
});
