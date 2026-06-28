const APP_URL = () => process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

// Logo embebido como base64 para que sea visible en cualquier cliente de email
const LOGO_B64 = (() => {
  try {
    const path = require('path');
    const fs = require('fs');
    const buf = fs.readFileSync(path.join(__dirname, '../../public/Logo-M.png'));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
})();

const C = {
  brandDark:  '#004669',
  brand:      '#20759E',
  black:      '#231F20',
  grayDark:   '#939598',
  grayMid:    '#BCBEC0',
  grayLight:  '#E8E9EA',
  bg:         '#F5F6F7',
  white:      '#FFFFFF',
};

function brandedEmail({ title, preheader, content, showLogo = true }) {
  const appUrl = APP_URL();
  const logoUrl = LOGO_B64 || `${appUrl}/Logo-M.png`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
${preheader ? `<span style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</span>` : ''}
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:32px 16px">

  <!-- Container -->
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

    <!-- Header -->
    <tr>
      <td style="background:${C.brandDark};padding:24px 32px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${showLogo ? `<td style="width:40px;vertical-align:middle"><img src="${logoUrl}" alt="M" width="36" height="36" style="display:block;border-radius:6px;background:${C.white}"></td>` : ''}
            <td style="vertical-align:middle;${showLogo ? 'padding-left:14px' : ''}">
              <div style="color:${C.white};font-size:18px;font-weight:700;letter-spacing:0.3px">${title || 'MySelec CRM'}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Accent line -->
    <tr><td style="background:${C.brand};height:3px;font-size:0;line-height:0">&nbsp;</td></tr>

    <!-- Body -->
    <tr>
      <td style="background:${C.white};padding:28px 32px">
        ${content}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:${C.grayLight};padding:16px 32px;text-align:center">
        <div style="margin-bottom:10px">
          <a href="${appUrl}" style="display:inline-block;padding:8px 20px;background:${C.brandDark};color:${C.white};text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.2px">Ir al CRM</a>
        </div>
        <div style="font-size:11px;color:${C.grayDark};line-height:1.5">
          MySelec CRM
        </div>
      </td>
    </tr>

  </table>

</td></tr>
</table>
</body></html>`;
}

function emailButton(href, label) {
  return `<div style="text-align:center;margin:24px 0">
  <a href="${href}" style="display:inline-block;padding:13px 32px;background:${C.brand};color:${C.white};text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.2px">${label}</a>
</div>`;
}

function emailInfoBox(lines) {
  const rows = lines.map(l => `<div style="font-size:14px;color:${C.black};margin-top:2px">${l}</div>`).join('');
  return `<div style="background:${C.bg};border-radius:8px;padding:14px 16px;margin:16px 0">${rows}</div>`;
}

function emailWarning(title, text) {
  return `<div style="background:#FFF8F0;border:1px solid #F0C8A0;border-radius:8px;padding:12px 16px;margin:16px 0">
  <div style="font-size:12px;color:#8B4513;font-weight:600">${title}</div>
  ${text ? `<div style="font-size:12px;color:#8B4513;margin-top:4px">${text}</div>` : ''}
</div>`;
}

function emailParagraph(text) {
  return `<p style="color:${C.black};font-size:14px;line-height:1.6;margin:0 0 16px">${text}</p>`;
}

function quoteBodyToHtml(body) {
  const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.split('\n').map(line =>
    line.trim() === ''
      ? '<br>'
      : `<p style="color:${C.black};font-size:14px;line-height:1.6;margin:0 0 8px">${line}</p>`
  ).join('\n');
}

module.exports = { brandedEmail, emailButton, emailInfoBox, emailWarning, emailParagraph, quoteBodyToHtml, BRAND_COLORS: C };
