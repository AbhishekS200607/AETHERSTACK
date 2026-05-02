require('dotenv').config();
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const transporter = nodemailer.createTransport({
  service: 'gmail', secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function sendTrialMail() {
  // Fetch real marketer data for this email
  const { data: marketer, error } = await supabase
    .from('marketers')
    .select('name, referral_code')
    .eq('email', 'asn69009@gmail.com')
    .maybeSingle();

  if (error || !marketer) {
    // Fallback: use a real marketer from DB to show real referral code
    const { data: any } = await supabase.from('marketers').select('name, referral_code').limit(1).single();
    if (!any) { console.error('No marketers found in DB'); return; }
    console.log('Using fallback marketer:', any.name, any.referral_code);
    return send(any.name, 'asn69009@gmail.com', any.referral_code);
  }

  console.log('Found marketer:', marketer.name, marketer.referral_code);
  return send(marketer.name, 'asn69009@gmail.com', marketer.referral_code);
}

async function send(name, email, referralCode) {
  const steps = [
    'Log in to your Marketer Dashboard at <a href="https://aetherstack.in/marketing-login.html" style="color:#C5A059;">aetherstack.in</a>.',
    'Navigate to the <strong>Profile</strong> tab.',
    'Click <strong>View Card</strong> to preview and download your Business Card (front &amp; back).',
    'Click <strong>View &amp; Download</strong> on the ID Card section to get your personalised digital ID.'
  ];

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">
<style>body,table,td,a{-webkit-text-size-adjust:100%}table{border-collapse:collapse!important}body{margin:0!important;padding:0!important}.premium-font{font-family:'Playfair Display',Georgia,serif!important}</style>
</head><body style="background-color:#FAFAFA;margin:0;padding:0;">
<table border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:60px 15px;">
<table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#fff;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,0.03);overflow:hidden;">
<tr><td style="height:4px;background:#C5A059;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:50px 40px 30px;">
  <p style="margin:0;font-size:28px;font-weight:700;color:#111;letter-spacing:-0.5px;">aetherstack</p>
  <p style="margin:6px 0 0;font-size:10px;color:#888;letter-spacing:4px;font-weight:600;text-transform:uppercase;">code smarter . ship faster</p>
</td></tr>
<tr><td align="left" style="padding:40px 50px 20px;color:#444;line-height:1.8;font-size:15px;font-weight:300;">
  <p style="margin-top:0;">Dear <strong>${name}</strong>,</p>
  <p class="premium-font" style="margin:0 0 25px;font-size:20px;color:#111;line-height:1.4;">Your official <i style="color:#C5A059;">Aetherstack Cards</i> are now ready.</p>
  <p>Your personalised <strong>Business Card</strong> and <strong>Digital ID Card</strong> are now available for download from your marketer profile.</p>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:40px 0;">
    <tr><td align="center" style="background:#FCFBF7;border:1px solid #EBE4D5;border-radius:4px;padding:35px 20px;">
      <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:2px;">Your Referral Code</p>
      <p class="premium-font" style="margin:0;font-size:28px;font-weight:500;color:#C5A059;letter-spacing:3px;">${referralCode}</p>
    </td></tr>
  </table>
  <p style="font-weight:600;color:#111;margin-bottom:20px;">How to download your cards:</p>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:40px;">
    ${steps.map(t => `
    <tr>
      <td width="32" valign="top" style="padding-bottom:18px;padding-top:1px;">
        <table border="0" cellpadding="0" cellspacing="0"><tr>
          <td style="width:22px;height:22px;background:#C5A059;border-radius:50%;text-align:center;vertical-align:middle;">
            <span style="font-size:13px;color:#fff;font-weight:700;line-height:22px;">&#10003;</span>
          </td>
        </tr></table>
      </td>
      <td valign="top" style="padding-bottom:18px;color:#555;">${t}</td>
    </tr>`).join('')}
  </table>
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:10px 0 40px;">
    <tr><td align="center">
      <a href="https://aetherstack.in/marketing-login.html" style="display:inline-block;background:#C5A059;color:#fff;font-size:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:16px 40px;border-radius:4px;">Go to My Profile</a>
    </td></tr>
  </table>
  <p>Keep up the great work — we are proud to have you on the team.</p>
</td></tr>
<tr><td align="left" style="padding:0 50px 50px;color:#444;font-size:15px;">
  <p style="margin:0;">Warmest regards,</p>
  <p style="margin:15px 0 0;">
    <span class="premium-font" style="font-size:22px;color:#111;display:block;margin-bottom:5px;">Marketing Team</span>
    <span style="color:#C5A059;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Aetherstack</span>
  </p>
</td></tr>
<tr><td align="center" style="padding:30px 40px;background:#FAFAFA;border-top:1px solid #EAEAEA;color:#999;font-size:11px;line-height:1.6;">
  <p style="margin:0;">&copy; 2026 Aetherstack. All rights reserved.<br>This communication is intended for registered team members.</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const info = await transporter.sendMail({
    from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Your Aetherstack ID & Business Card is Ready, ${name.split(' ')[0]}!`,
    html
  });
  console.log('✅ Trial email sent! Message ID:', info.messageId);
  console.log('   Name:', name, '| Referral Code:', referralCode);
}

sendTrialMail().catch(e => console.error('❌ Failed:', e.message));
