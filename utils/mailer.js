const nodemailer = require("nodemailer");

const port = Number(process.env.SMTP_PORT || 465);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465, // 465 = SSL, 587 = STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// server start aagumbodhe SMTP config sariya irukka nu check pannum
transporter.verify((err) => {
  if (err) console.error("SMTP config error:", err.message);
  else console.log("SMTP ready");
});

const sendMail = ({ to, subject, html, attachments }) =>
  transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || "Billing"}" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    attachments,
  });

module.exports = { sendMail };