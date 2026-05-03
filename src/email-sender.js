/**
 * Email-sender léger : utilise Resend HTTP API directement (pas de SDK).
 *
 * - No-op gracieux si RESEND_API_KEY n'est pas défini (log warning, pas d'erreur)
 * - Templates fixes : signup_success, signup_cancelled, provisioning_error
 * - Sender FROM doit être un domaine vérifié dans Resend (ex: hello@monsitehq.com)
 *
 * Pour activer :
 *   1. https://resend.com/api-keys → créer une clé restricted "Sending access"
 *   2. https://resend.com/domains → ajouter monsitehq.com + DKIM via API Cloudflare
 *   3. Set env vars sur Coolify :
 *        RESEND_API_KEY=re_xxx
 *        RESEND_FROM_EMAIL=hello@monsitehq.com
 *        RESEND_REPLY_TO=johann.metagora@gmail.com
 */

const RESEND_API = 'https://api.resend.com/emails';

function isEnabled() {
  return !!process.env.RESEND_API_KEY;
}

function getFrom() {
  return process.env.RESEND_FROM_EMAIL || 'noreply@monsitehq.com';
}
function getReplyTo() {
  return process.env.RESEND_REPLY_TO || null;
}

async function sendRaw({ to, subject, html, text }) {
  if (!isEnabled()) {
    console.log(`[email-sender] RESEND_API_KEY missing — skip email to ${to} subject="${subject}"`);
    return { ok: false, reason: 'no_api_key' };
  }
  if (!to || !subject || (!html && !text)) {
    return { ok: false, reason: 'missing_fields' };
  }

  const body = {
    from: getFrom(),
    to: Array.isArray(to) ? to : [to],
    subject,
    html: html || undefined,
    text: text || undefined,
  };
  const replyTo = getReplyTo();
  if (replyTo) body.reply_to = replyTo;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[email-sender] Resend error:', data);
      return { ok: false, reason: 'api_error', details: data };
    }
    console.log(`[email-sender] Sent to ${to} id=${data.id} subject="${subject}"`);
    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[email-sender] Network error:', err.message);
    return { ok: false, reason: 'network_error', error: err.message };
  }
}

// === Templates ============================================================

function escapeHtml(s) {
  return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * Email envoyé après que le site est passé LIVE (provisioning OK).
 */
export async function sendSignupSuccessEmail({ to, salonName, liveHostname, plan, slug }) {
  const planLabels = { TWO_YEAR: '9,90 € TTC/mois (24 mois)', ONE_YEAR: '17,90 € TTC/mois (12 mois)', FLEX: '29 € TTC/mois (sans engagement)' };
  const planLabel = planLabels[plan] || plan;
  const liveUrl = `https://${liveHostname}`;
  const adminUrl = `https://monsitehq.com/admin/${slug}`;

  const subject = `${salonName} — votre site est en ligne sur ${liveHostname} 🎉`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 30px; color: #1a1a1a;">
  <h1 style="font-size: 24px; margin: 0 0 16px;">Bonjour ${escapeHtml(salonName)},</h1>
  <p style="font-size: 16px; line-height: 1.5; color: #4b5563;">
    Votre site est maintenant <strong>en ligne</strong> à l'adresse :
  </p>
  <p style="margin: 24px 0; text-align: center;">
    <a href="${liveUrl}" style="display: inline-block; background: #0a0a0a; color: white; padding: 12px 28px; text-decoration: none; border-radius: 999px; font-weight: 600;">Voir mon site →</a>
  </p>
  <p style="font-size: 14px; color: #6b7280;">
    URL : <a href="${liveUrl}" style="color: #0a0a0a;">${escapeHtml(liveHostname)}</a><br>
    Plan : ${escapeHtml(planLabel)}<br>
    Modifier le contenu : <a href="${adminUrl}" style="color: #0a0a0a;">Espace admin</a>
  </p>
  <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 32px 0;">
  <p style="font-size: 13px; color: #9ca3af; line-height: 1.5;">
    Une question ? Répondez à cet email.<br>
    L'équipe MonQuickSite
  </p>
</body></html>`;

  const text = `Bonjour ${salonName},

Votre site est maintenant en ligne à l'adresse :
  ${liveUrl}

Plan : ${planLabel}
Modifier le contenu : ${adminUrl}

Une question ? Répondez à cet email.
L'équipe MonQuickSite`;

  return sendRaw({ to, subject, html, text });
}

/**
 * Email envoyé si le provisioning échoue (admin alerte).
 */
export async function sendProvisioningErrorEmail({ adminEmail, salonName, slug, hostname, errorMessage }) {
  const subject = `[ALERTE] Provisioning échoué pour ${salonName} (${hostname})`;
  const adminUrl = `https://outil.monsitehq.com/admin/salons/${slug}`;
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 30px;">
  <h1 style="color: #b91c1c;">⚠ Provisioning échoué</h1>
  <p><strong>Salon :</strong> ${escapeHtml(salonName)} (slug ${escapeHtml(slug)})</p>
  <p><strong>Domaine cible :</strong> ${escapeHtml(hostname)}</p>
  <p><strong>Erreur :</strong></p>
  <pre style="background: #fef2f2; padding: 12px; border-radius: 6px; color: #991b1b; font-size: 13px;">${escapeHtml(errorMessage)}</pre>
  <p>Action : connectez-vous à l'admin et utilisez "Retry provisioning".</p>
  <p><a href="${adminUrl}">${adminUrl}</a></p>
</body></html>`;
  return sendRaw({ to: adminEmail, subject, html });
}

export default {
  isEnabled,
  sendSignupSuccessEmail,
  sendProvisioningErrorEmail,
};
