import nodemailer from 'nodemailer';

// Server-only: uses a Gmail account + App Password (no custom domain needed). Never import from client code.
function getTransporter(gmailUser?: string, gmailAppPassword?: string) {
  const user = gmailUser || process.env.GMAIL_USER;
  const pass = gmailAppPassword || process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD no están configurados');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

export async function sendTicketEmail(params: {
  to: string;
  playerName: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  ticketCode: string;
  ticketUrl: string;
  gmailUser?: string;
  gmailAppPassword?: string;
}): Promise<void> {
  const { to, playerName, eventName, eventDate, eventLocation, ticketCode, ticketUrl, gmailUser, gmailAppPassword } = params;
  const transporter = getTransporter(gmailUser, gmailAppPassword);
  await transporter.sendMail({
    from: `"Meeple Loop" <${gmailUser || process.env.GMAIL_USER}>`,
    to,
    subject: `Tu código para ${eventName}`,
    text: `Hola ${playerName}!\n\n` +
      `Tu código de inscripción a "${eventName}" (${eventDate} · ${eventLocation}) es:\n\n` +
      `${ticketCode}\n\n` +
      `Guardalo para ver tus mesas y actualizar tu wishlist:\n${ticketUrl}\n\n` +
      `¡Nos vemos ahí!`,
    html: `
      <p>Hola <strong>${playerName}</strong>!</p>
      <p>Tu código de inscripción a <strong>${eventName}</strong> (${eventDate} · ${eventLocation}) es:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px;font-family:monospace;">${ticketCode}</p>
      <p>Guardalo para ver tus mesas y actualizar tu wishlist:<br/><a href="${ticketUrl}">${ticketUrl}</a></p>
      <p>¡Nos vemos ahí!</p>
    `,
  });
}
