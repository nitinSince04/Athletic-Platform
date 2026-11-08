const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

async function sendPasswordResetEmail({ email, name, resetUrl }) {
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    throw new Error('Password reset email service is not configured');
  }
  const safeName = escapeHtml(name || 'there');
  const safeUrl = escapeHtml(resetUrl);
  const text = `Hi ${name || 'there'},\n\nUse this link to reset your FieldSignal password: ${resetUrl}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#08090b;color:#f3f5f7;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#101317;border:1px solid #2c313a;border-radius:14px"><tr><td style="padding:36px"><p style="color:#4fe0c4;font-size:13px;font-weight:bold;letter-spacing:2px;margin:0 0 24px">FIELDSIGNAL</p><h1 style="font-size:25px;margin:0 0 18px">Reset your password</h1><p style="color:#c2c9d2;line-height:1.6">Hi ${safeName}, we received a request to reset your FieldSignal password.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Reset Password</a></p><p style="color:#c2c9d2;line-height:1.6">This link expires in 30 minutes and can only be used once.</p><p style="color:#9aa3b2;line-height:1.6;font-size:13px">If the button does not work, copy this URL into your browser:<br><a href="${safeUrl}" style="color:#4fe0c4;word-break:break-all">${safeUrl}</a></p><p style="color:#9aa3b2;line-height:1.6;font-size:13px">If you did not request a password reset, you can safely ignore this email.</p></td></tr></table></td></tr></table></body></html>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: 'Reset Your FieldSignal Password', html, text }),
  });
  if (!response.ok) throw new Error(`Email provider returned status ${response.status}`);
}

module.exports = { sendPasswordResetEmail };
