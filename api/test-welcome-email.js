'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendWelcomeEmail(name, email, referralCode) {
  const firstName = name.split(' ')[0];
  const listItems = [
    'Share your referral code seamlessly with your professional network.',
    'Invite individuals, startups, or established businesses seeking bespoke project development.',
    'Promote our digital services and connect high-value clients with our team.'
  ];

  await transporter.sendMail({
    from: `"Aetherstack" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Welcome to the Aetherstack Marketing Team, ${firstName}!`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap" rel="stylesheet">
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    table{border-collapse:collapse!important}
    body{height:100%!important;margin:0!important;padding:0!important;width:100%!important}
    .premium-font{font-family:'Playfair Display',Georgia,serif!important}
    .body-font{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif!important}
  </style>
</head>
<body style="background-color:#FAFAFA;margin:0!important;padding:0!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding:60px 15px;">

        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:4px;box-shadow:0 10px 30px rgba(0,0,0,0.03);overflow:hidden;">

          <!-- Gold accent line -->
          <tr>
            <td style="height:4px;background-color:#C5A059;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td align="center" style="padding:50px 40px 30px;background-color:#ffffff;">
              <p style="margin:0;font-size:28px;font-weight:700;color:#111111;letter-spacing:-0.5px;">aetherstack</p>
              <p class="body-font" style="margin:6px 0 0;font-size:10px;color:#888888;letter-spacing:4px;font-weight:600;text-transform:uppercase;">code smarter . ship faster</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td align="center" style="padding:0 40px;">
              <table border="0" cellpadding="0" cellspacing="0" width="40" style="border-top:1px solid #EAEAEA;">
                <tr><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td align="left" class="body-font" style="padding:40px 50px 20px;color:#444444;line-height:1.8;font-size:15px;font-weight:300;">

              <p style="margin-top:0;">Dear <strong>${name}</strong>,</p>

              <!-- Welcome line -->
              <p class="premium-font" style="margin:0 0 25px;font-size:20px;color:#111111;line-height:1.4;">
                Welcome to the <i style="color:#C5A059;">Marketing Team</i> at Aetherstack.
              </p>

              <p style="margin-bottom:20px;">We are thrilled to have you onboard and look forward to your contributions in expanding our reach and cultivating new opportunities.</p>

              <p>As an integral part of your role, we are introducing our <strong>Referral Program</strong>. You have been assigned a unique referral code to invite prospective clients for project collaborations.</p>

              <!-- Referral Code Box -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:40px 0;">
                <tr>
                  <td align="center" style="background-color:#FCFBF7;border:1px solid #EBE4D5;border-radius:4px;padding:35px 20px;">
                    <p class="body-font" style="margin:0 0 12px;font-size:11px;color:#888888;text-transform:uppercase;letter-spacing:2px;">Your Exclusive Referral Code</p>
                    <p class="premium-font" style="margin:0;font-size:28px;font-weight:500;color:#C5A059;letter-spacing:3px;">${referralCode}</p>
                  </td>
                </tr>
              </table>

              <p style="margin-bottom:25px;font-weight:600;color:#111111;">You are encouraged to:</p>

              <!-- List items with tick circles -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:40px;">
                ${listItems.map(text => `
                <tr>
                  <td width="32" valign="top" style="padding-bottom:18px;padding-top:1px;">
                    <table border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:22px;height:22px;background-color:#C5A059;border-radius:50%;text-align:center;vertical-align:middle;">
                          <span style="font-size:13px;color:#ffffff;font-weight:700;line-height:22px;">&#10003;</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="left" valign="top" class="body-font" style="padding-bottom:18px;color:#555555;">${text}</td>
                </tr>`).join('')}
              </table>

              <!-- Benefit callout -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:30px 0;">
                <tr>
                  <td align="left" style="background-color:#ffffff;border:1px solid #EAEAEA;border-left:3px solid #C5A059;padding:25px;">
                    <p class="premium-font" style="margin:0 0 10px;color:#C5A059;font-weight:500;font-size:18px;font-style:italic;">The Referral Benefit</p>
                    <p class="body-font" style="margin:0;font-size:15px;color:#444444;line-height:1.6;">For every successful project acquired through your referral code, you will be rewarded with <strong>7% to 10% of the project's total profit</strong>.</p>
                  </td>
                </tr>
              </table>

              <p style="margin-top:30px;">This presents an exceptional opportunity to accelerate your professional growth while earning performance-based incentives.</p>
              <p>Should you require any strategic support or have questions regarding client outreach, our leadership team is always available to assist you.</p>
              <p style="margin-top:30px;">Once again, welcome. We are excited to build and achieve great success together.</p>

            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td align="left" class="body-font" style="padding:0 50px 50px;color:#444444;line-height:1.8;font-size:15px;">
              <p style="margin:0;">Warmest regards,</p>
              <p style="margin:15px 0 0;">
                <span class="premium-font" style="font-size:22px;color:#111111;display:block;margin-bottom:5px;">Marketing Team</span>
                <span style="color:#C5A059;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Aetherstack</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" class="body-font" style="padding:30px 40px;background-color:#FAFAFA;border-top:1px solid #EAEAEA;color:#999999;font-size:11px;line-height:1.6;letter-spacing:0.5px;">
              <p style="margin:0;">&copy; 2026 Aetherstack. All rights reserved.<br>This communication is intended for registered team members.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  });
}

(async () => {
  try {
    console.log('Sending test welcome email...');
    await sendWelcomeEmail('VINAYAK V', 'vinayakv1881@gmail.com', 'W6ET');
    console.log('✅ Email sent successfully to vinayakv1881@gmail.com');
  } catch (err) {
    console.error('❌ Failed to send email:', err.message);
  }
})();
