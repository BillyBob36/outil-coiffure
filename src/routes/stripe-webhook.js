/**
 * Webhook Stripe : reçoit les events post-paiement et déclenche
 * l'orchestrator (achat domaine OVH + DNS + Cloudflare for SaaS).
 *
 * Idempotency : on stocke chaque event.id en DB (table stripe_events) pour
 * éviter de traiter 2× le même event si Stripe retry.
 *
 * Important : ce router DOIT être monté AVANT les middlewares JSON globaux
 * (sinon req.body est parsé et la signature Stripe ne match plus).
 */

import express from 'express';
import Stripe from 'stripe';
import db from '../db.js';
import { startProvisioning } from '../provisioning-worker.js';

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET non configuré');
    return res.status(500).send('webhook secret missing');
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).send('stripe secret missing');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verif failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // === Idempotency : skip si déjà traité ===
  const existing = db.prepare('SELECT id FROM stripe_events WHERE id = ?').get(event.id);
  if (existing) {
    console.log('[stripe-webhook] Already processed:', event.id);
    return res.json({ received: true, duplicate: true });
  }
  db.prepare('INSERT INTO stripe_events (id, type, payload) VALUES (?, ?, ?)').run(
    event.id, event.type, JSON.stringify(event.data?.object || {}).slice(0, 5000)
  );

  // === Dispatch ===
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await onCheckoutCompleted(session);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await onSubscriptionUpdate(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await onSubscriptionDeleted(sub);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        await onPaymentFailed(inv);
        break;
      }
      default:
        console.log('[stripe-webhook] Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err);
    // On a déjà inséré l'event en DB → on retourne 200 quand même pour éviter
    // les retries Stripe (le job est dans la queue, on traitera à part).
  }

  res.json({ received: true });
});

async function onCheckoutCompleted(session) {
  // session.metadata = { slug, hostname, plan, supplementEurTtc }
  const slug = session.metadata?.slug;
  if (!slug) {
    console.error('[stripe-webhook] checkout.session.completed sans slug en metadata', session.id);
    return;
  }
  // Update DB : marquer le salon comme "payment_received"
  db.prepare(`
    UPDATE salons
    SET stripe_customer_id = ?, stripe_subscription_id = ?,
        subscription_status = 'provisioning',
        signed_up_at = datetime('now'), updated_at = datetime('now')
    WHERE slug = ?
  `).run(session.customer, session.subscription, slug);

  // Lance l'orchestrator (worker async, ne bloque pas la réponse webhook)
  startProvisioning({
    slug,
    hostname: session.metadata.hostname,
    planKey: session.metadata.plan,
    domainYears: parseInt(session.metadata.domain_years || '1', 10),
    customerEmail: session.customer_email || session.customer_details?.email,
    stripeCustomerId: session.customer,
    stripeSubscriptionId: session.subscription,
  }).catch(err => {
    console.error('[stripe-webhook] startProvisioning failed:', err);
    // On marque le salon en error
    db.prepare(`UPDATE salons SET subscription_status='error', updated_at=datetime('now') WHERE slug=?`).run(slug);
  });
}

async function onSubscriptionUpdate(sub) {
  // sub.metadata = { slug, hostname, plan, commitment_months }
  const slug = sub.metadata?.slug;
  if (!slug) return;
  const status = sub.status; // 'active' | 'trialing' | 'past_due' | 'canceled' | ...
  db.prepare(`
    UPDATE salons SET subscription_status = ?, stripe_subscription_id = ?, updated_at = datetime('now')
    WHERE slug = ?
  `).run(status === 'active' || status === 'trialing' ? 'active' : status, sub.id, slug);
}

async function onSubscriptionDeleted(sub) {
  const slug = sub.metadata?.slug;
  if (!slug) return;
  db.prepare(`
    UPDATE salons
    SET subscription_status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
    WHERE slug = ?
  `).run(slug);
}

async function onPaymentFailed(invoice) {
  // invoice.subscription_details?.metadata may have slug
  const subId = invoice.subscription;
  if (!subId) return;
  db.prepare(`
    UPDATE salons SET subscription_status = 'past_due', updated_at = datetime('now')
    WHERE stripe_subscription_id = ?
  `).run(subId);
}

export default router;
