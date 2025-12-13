import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,      // mail.acre.mx
  port: Number(process.env.SMTP_PORT), // 587
  secure: false, // ⚠️ CLAVE (NO true)
  auth: {
    user: process.env.SMTP_USER, // intranet@acre.mx
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false, // 🔑 evita problemas de certificado en cPanel
  },
});
