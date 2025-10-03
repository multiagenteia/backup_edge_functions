#!/usr/bin/env bash
set -e

BASE_DIR="/root/backups/edge_functions"

# Lista de funções
FUNCS=(
  abacatepay-webhook
  asaas-webhook
  cleanup-failed-signup
  complete-signup
  create-abacatepay-payment
  create-asaas-card-payment
  create-asaas-customer
  create-asaas-payment
  create-auth-user
  delete-user
  generate-menu-pdf
  print-comanda
  process-referral-commission
  reset-user-password
  setup-delivery-account
  verify-abacatepay-payment
  verify-asaas-payment
  whatsapp-qrcode
  delete-company
  upload-doc-image
  get-menu-data
  generate-jwt
)

# Loop para criar arquivos em cada pasta
for fn in "${FUNCS[@]}"; do
  FN_DIR="$BASE_DIR/$fn"

  mkdir -p "$FN_DIR"

  # Cria um index.ts se não existir
  if [ ! -f "$FN_DIR/index.ts" ]; then
    cat <<EOF > "$FN_DIR/index.ts"
// Edge Function: $fn
// TODO: implementar lógica específica desta função

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((req) => {
  return new Response("Function $fn is running!", { status: 200 });
});
EOF
  fi

  # Cria um deno.json se não existir
  if [ ! -f "$FN_DIR/deno.json" ]; then
    cat <<EOF > "$FN_DIR/deno.json"
{
  "tasks": {
    "start": "deno run --allow-net --allow-env index.ts"
  }
}
EOF
  fi
done

echo "Arquivos criados/atualizados em $BASE_DIR"

