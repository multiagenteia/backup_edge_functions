// Edge Function: create-asaas-card-payment
// TODO: implementar lógica específica desta função

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((req) => {
  return new Response("Function create-asaas-card-payment is running!", { status: 200 });
});
