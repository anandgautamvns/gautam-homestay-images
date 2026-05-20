'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const logger = require('/opt/nodejs/logger');

const sns = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ADMIN_PHONE = process.env.ADMIN_PHONE;

async function sendUserSms(phone, booking) {
  if (!phone) return;
  const { firstName, confirmationId, roomType, checkIn, checkOut } = booking;
  const message =
    `Hi ${firstName}! Gautam Homestay booking received. ID: ${confirmationId}. ` +
    `Room: ${roomType}, ${checkIn} to ${checkOut}. We'll contact you shortly.`;

  await sns.send(new PublishCommand({
    PhoneNumber: phone,
    Message: message,
    MessageAttributes: {
      'AWS.SNS.SMS.SMSType':  { DataType: 'String', StringValue: 'Transactional' },
      'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'GHStay' },
    },
  }));
  logger.info('User SMS sent', { maskedPhone: phone.replace(/.(?=.{4})/g, '*'), confirmationId });
}

async function sendAdminSms(booking) {
  if (!ADMIN_PHONE) return;
  const { firstName, lastName, email, roomType, checkIn, checkOut, confirmationId } = booking;
  const message =
    `[GH] New booking ${confirmationId}: ${firstName} ${lastName} (${email}) — ` +
    `${roomType}, ${checkIn} to ${checkOut}.`;

  await sns.send(new PublishCommand({
    PhoneNumber: ADMIN_PHONE,
    Message: message,
    MessageAttributes: {
      'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    },
  }));
  logger.info('Admin SMS sent', { confirmationId });
}

module.exports = { sendUserSms, sendAdminSms };
