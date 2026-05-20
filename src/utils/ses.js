'use strict';

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const logger = require('/opt/nodejs/logger');

const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
const FROM_EMAIL  = process.env.FROM_EMAIL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

async function sendUserConfirmationEmail(booking) {
  const { firstName, lastName, email, checkIn, checkOut, roomType, confirmationId } = booking;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
      <div style="background:#b45309;padding:24px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:24px">Gautam Homestay</h1>
      </div>
      <div style="padding:32px">
        <h2 style="color:#b45309">Booking Request Received!</h2>
        <p>Dear ${firstName} ${lastName},</p>
        <p>Thank you for choosing Gautam Homestay. We have received your booking request and will confirm your reservation shortly.</p>
        <div style="background:#fef3c7;border-left:4px solid #b45309;padding:16px;margin:24px 0;border-radius:4px">
          <p style="margin:0;font-weight:bold;color:#b45309">Confirmation ID: ${confirmationId}</p>
        </div>
        <h3 style="color:#555;border-bottom:1px solid #eee;padding-bottom:8px">Booking Summary</h3>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#777;width:40%">Room Type</td><td style="padding:8px 0;font-weight:bold">${roomType}</td></tr>
          <tr><td style="padding:8px 0;color:#777">Check-in</td><td style="padding:8px 0;font-weight:bold">${checkIn}</td></tr>
          <tr><td style="padding:8px 0;color:#777">Check-out</td><td style="padding:8px 0;font-weight:bold">${checkOut}</td></tr>
        </table>
        <p style="margin-top:24px">We will contact you at <strong>${email}</strong> to confirm your booking and share payment details.</p>
        <p>For any queries, feel free to reply to this email.</p>
        <p style="margin-top:32px">Warm regards,<br><strong>Gautam Homestay Team</strong></p>
      </div>
      <div style="background:#f5f5f5;padding:16px;text-align:center;font-size:12px;color:#999">
        <p>Gautam Homestay &mdash; A peaceful retreat in the heart of nature</p>
      </div>
    </div>`;

  const text = `Dear ${firstName} ${lastName},

Thank you for your booking request at Gautam Homestay.

Confirmation ID: ${confirmationId}

Booking Summary:
  Room Type : ${roomType}
  Check-in  : ${checkIn}
  Check-out : ${checkOut}

We will contact you at ${email} to confirm your booking.

Warm regards,
Gautam Homestay Team`;

  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Booking Received — ${confirmationId} | Gautam Homestay` },
      Body: { Html: { Data: html }, Text: { Data: text } },
    },
  }));
  logger.info('User confirmation email sent', { email, confirmationId });
}

async function sendAdminNotificationEmail(booking) {
  const { firstName, lastName, email, phone, checkIn, checkOut, roomType, message, confirmationId } = booking;

  const messageBlock = message
    ? `<h3 style="color:#555;border-bottom:1px solid #eee;padding-bottom:8px;margin-top:24px">Guest Message</h3>
       <p style="background:#f9f9f9;padding:16px;border-radius:4px;margin:0">${message}</p>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
      <div style="background:#1c1917;padding:24px;text-align:center">
        <h1 style="color:#f59e0b;margin:0;font-size:24px">New Booking Request</h1>
        <p style="color:#a8a29e;margin:8px 0 0">Gautam Homestay Admin</p>
      </div>
      <div style="padding:32px">
        <div style="background:#fef3c7;border-left:4px solid #b45309;padding:16px;margin-bottom:24px;border-radius:4px">
          <p style="margin:0;font-weight:bold;color:#b45309">Booking ID: ${confirmationId}</p>
        </div>
        <h3 style="color:#555;border-bottom:1px solid #eee;padding-bottom:8px">Guest Details</h3>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#777;width:40%">Name</td><td style="padding:8px 0;font-weight:bold">${firstName} ${lastName}</td></tr>
          <tr><td style="padding:8px 0;color:#777">Email</td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding:8px 0;color:#777">Phone</td><td style="padding:8px 0">${phone || 'Not provided'}</td></tr>
        </table>
        <h3 style="color:#555;border-bottom:1px solid #eee;padding-bottom:8px;margin-top:24px">Booking Details</h3>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#777;width:40%">Room Type</td><td style="padding:8px 0;font-weight:bold">${roomType}</td></tr>
          <tr><td style="padding:8px 0;color:#777">Check-in</td><td style="padding:8px 0;font-weight:bold">${checkIn}</td></tr>
          <tr><td style="padding:8px 0;color:#777">Check-out</td><td style="padding:8px 0;font-weight:bold">${checkOut}</td></tr>
        </table>
        ${messageBlock}
        <p style="margin-top:24px;color:#777;font-size:13px">Received: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
      </div>
    </div>`;

  const text = `New Booking Request — Gautam Homestay

Booking ID: ${confirmationId}

Guest Details:
  Name  : ${firstName} ${lastName}
  Email : ${email}
  Phone : ${phone || 'Not provided'}

Booking Details:
  Room Type : ${roomType}
  Check-in  : ${checkIn}
  Check-out : ${checkOut}

${message ? `Guest Message:\n${message}` : ''}`;

  await ses.send(new SendEmailCommand({
    Source: FROM_EMAIL,
    Destination: { ToAddresses: [ADMIN_EMAIL] },
    Message: {
      Subject: { Data: `New Booking: ${firstName} ${lastName} — ${roomType} (${checkIn})` },
      Body: { Html: { Data: html }, Text: { Data: text } },
    },
  }));
  logger.info('Admin notification email sent', { adminEmail: ADMIN_EMAIL, confirmationId });
}

module.exports = { sendUserConfirmationEmail, sendAdminNotificationEmail };
