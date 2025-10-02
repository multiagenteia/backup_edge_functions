import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  console.log('=== WEBHOOK SECRET VALIDATION ===');
  // Verifica o segredo do webhook
  const url = new URL(req.url);
  const receivedSecret = url.searchParams.get("webhookSecret") || url.searchParams.get("secret") || req.headers.get("x-webhook-secret");
  console.log('URL completa:', req.url);
  console.log('Query params:', Object.fromEntries(url.searchParams));
  console.log('Headers relevantes:', {
    'x-webhook-secret': req.headers.get("x-webhook-secret"),
    'authorization': req.headers.get("authorization") ? 'Present' : 'Missing'
  });
  console.log('Received secret:', receivedSecret ? `Present (length: ${receivedSecret.length})` : 'Missing');
  if (!receivedSecret) {
    console.log('❌ No webhook secret received in request');
    return new Response(JSON.stringify({
      code: 401,
      message: "Missing webhook secret in request"
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 401
    });
  }
  // Initialize Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);
  // Buscar o webhook secret da configuração do sistema
  console.log('Buscando webhook secret da configuração do sistema...');
  const { data: webhookSecretConfig, error: secretError } = await supabase.from('delivery_config_sys').select('config_value').eq('config_key', 'abacatepay_webhook_secret').single();
  console.log('Resultado da busca do webhook secret:', {
    webhookSecretConfig,
    secretError
  });
  let expectedSecret = null;
  if (webhookSecretConfig && webhookSecretConfig.config_value) {
    try {
      expectedSecret = JSON.parse(webhookSecretConfig.config_value);
    } catch  {
      expectedSecret = webhookSecretConfig.config_value;
    }
    console.log('Expected secret from config:', expectedSecret ? `Present (length: ${expectedSecret.length})` : 'Missing');
  }
  // Fallback para a variável de ambiente se não encontrar na config
  if (!expectedSecret) {
    console.log('Fallback: tentando buscar da variável de ambiente...');
    const envSecret = Deno.env.get("ABACATEPAY_WEBHOOK_SECRET");
    if (envSecret && envSecret !== "ABACATEPAY_WEBHOOK_SECRET") {
      expectedSecret = envSecret.trim().replace(/[\r\n]/g, '');
      console.log('Expected secret from env:', expectedSecret ? `Present (length: ${expectedSecret.length})` : 'Missing');
    }
  }
  if (!expectedSecret) {
    console.log('❌ ABACATEPAY_WEBHOOK_SECRET not found in system config or environment');
    return new Response(JSON.stringify({
      code: 500,
      message: "Webhook secret not configured on server"
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
  // Limpar o secret recebido
  const cleanReceivedSecret = receivedSecret.trim().replace(/[\r\n]/g, '');
  if (cleanReceivedSecret !== expectedSecret) {
    console.log('❌ Webhook secret validation failed - secrets do not match');
    console.log('Expected length:', expectedSecret.length);
    console.log('Received length:', cleanReceivedSecret.length);
    console.log('Expected first 10 chars:', expectedSecret.substring(0, 10));
    console.log('Received first 10 chars:', cleanReceivedSecret.substring(0, 10));
    return new Response(JSON.stringify({
      code: 401,
      message: "invalid webhook secret"
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 401
    });
  }
  console.log('✅ Webhook secret validation passed');
  // Verifica se o corpo é JSON
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return new Response(JSON.stringify({
      error: "Invalid content-type"
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
  let webhookData;
  try {
    webhookData = await req.json();
  } catch (err) {
    console.error('Error parsing JSON:', err);
    return new Response(JSON.stringify({
      error: "Invalid JSON body"
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
  try {
    console.log('=== ABACATEPAY WEBHOOK RECEIVED ===');
    console.log('Full webhook data:', JSON.stringify(webhookData, null, 2));
    const eventType = webhookData.event || webhookData.type;
    const payment = webhookData.payment || webhookData.data?.pixQrCode || webhookData.data?.payment;
    const paymentId = payment?.id;
    const paymentStatus = payment?.status;
    const paymentValue = payment?.amount ? payment.amount / 100 : 0;
    console.log('Event Type:', eventType);
    console.log('Payment ID:', paymentId);
    console.log('Payment Status:', paymentStatus);
    console.log('Payment Value:', paymentValue);
    if (!paymentId) {
      console.log('No payment ID found in webhook');
      return new Response(JSON.stringify({
        error: 'No payment ID found'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 400
      });
    }
    console.log('=== SEARCHING FOR TRANSACTION ===');
    console.log('Looking for abacatepay_payment_id:', paymentId);
    // Find the transaction
    let { data: transaction, error: searchError } = await supabase.from('delivery_credit_transactions').select('*').eq('abacatepay_payment_id', paymentId).single();
    console.log('Transaction search result:', {
      transaction,
      error: searchError
    });
    if (searchError || !transaction) {
      console.log('Transaction not found by payment ID, searching by value and recent timestamp...');
      // Fallback: search by value and recent timestamp
      const { data: fallbackTransactions, error: fallbackError } = await supabase.from('delivery_credit_transactions').select('*').eq('valor', paymentValue).eq('status', 'pendente').eq('gateway_usado', 'abacatepay').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
      .order('created_at', {
        ascending: false
      });
      console.log('Fallback search result:', {
        fallbackTransactions,
        fallbackError
      });
      if (fallbackError || !fallbackTransactions || fallbackTransactions.length === 0) {
        console.error('Transaction not found even with fallback search');
        return new Response(JSON.stringify({
          error: 'Transaction not found'
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
          status: 404
        });
      }
      // Use the most recent transaction
      transaction = fallbackTransactions[0];
      // Update the transaction with the correct payment ID
      const { error: updateIdError } = await supabase.from('delivery_credit_transactions').update({
        abacatepay_payment_id: paymentId
      }).eq('id', transaction.id);
      if (updateIdError) {
        console.error('Error updating transaction with payment ID:', updateIdError);
      } else {
        console.log('Transaction updated with payment ID:', paymentId);
      }
    }
    // Only process if payment is approved/paid
    if (eventType === 'billing.paid' || eventType === 'PAYMENT_APPROVED' || eventType === 'payment.paid' || paymentStatus === 'PAID' || paymentStatus === 'CONFIRMED' || paymentStatus === 'paid' || paymentStatus === 'approved') {
      console.log('=== PROCESSING PAYMENT ===');
      const clientId = transaction.id_cliente;
      const value = transaction.valor;
      console.log('Client ID:', clientId);
      console.log('Value:', value);
      // Get pricing range for this value
      const { data: pricingRange, error: pricingError } = await supabase.from('delivery_precos_credito').select('*').lte('faixa_min', value).gte('faixa_max', value).eq('ativo', true).single();
      console.log('Pricing range search:', {
        pricingRange,
        pricingError,
        searchValue: value
      });
      if (pricingError || !pricingRange) {
        console.error('Pricing range not found for value:', value);
        return new Response(JSON.stringify({
          error: 'Pricing range not found',
          value: value,
          pricingError: pricingError?.message
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
          status: 400
        });
      }
      // Create credit lote
      const { data: lote, error: loteError } = await supabase.from('delivery_credit_lotes').insert({
        id_cliente: clientId,
        valor_reais: value,
        saldo_reais: value,
        valor_unitario_sem_voz: pricingRange.valor_unitario_sem_voz,
        valor_unitario_com_voz: pricingRange.valor_unitario_com_voz,
        origem_transacao: transaction.id,
        ativo: true
      }).select().single();
      if (loteError) {
        console.error('Error creating credit lote:', loteError);
        return new Response(JSON.stringify({
          error: 'Failed to create credit lote'
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
          status: 500
        });
      }
      console.log('Credit lote created:', lote);
      // Create credit log
      const { error: logError } = await supabase.from('delivery_credit_logs').insert({
        id_cliente: clientId,
        id_lote: lote.id,
        valor: value,
        tipo: 'recarga'
      });
      if (logError) {
        console.error('Error creating credit log:', logError);
      }
      // Update transaction status
      const { error: updateError } = await supabase.from('delivery_credit_transactions').update({
        status: 'pago'
      }).eq('id', transaction.id);
      if (updateError) {
        console.error('Error updating transaction status:', updateError);
        return new Response(JSON.stringify({
          error: 'Failed to update transaction'
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
          status: 500
        });
      }
      console.log('Transaction updated to paid status');
      console.log('=== CHECKING AGENT REACTIVATION ===');
      // Update agent_bloqueado_manual to false after successful payment
      const { error: agentUpdateError } = await supabase.from('delivery_config_demo').update({
        agent_bloqueado_manual: false
      }).eq('id_cliente', clientId);
      if (agentUpdateError) {
        console.error('Error updating agent status:', agentUpdateError);
      } else {
        console.log('Agent unblocked for client:', clientId);
      }
      return new Response(JSON.stringify({
        success: true,
        message: 'Payment processed successfully',
        loteId: lote.id,
        creditValue: value
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    console.log('Payment not in approved status, ignoring webhook');
    return new Response(JSON.stringify({
      message: 'Webhook received but not processed'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error processing AbacatePay webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({
      error: errorMessage
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});

