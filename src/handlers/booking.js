'use strict';

const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const res = require('../utils/response');
const { sendUserConfirmationEmail, sendAdminNotificationEmail } = require('../utils/ses');
const { sendUserSms, sendAdminSms } = require('../utils/sns');
const logger = require('/opt/nodejs/logger');

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const BOOKINGS_TABLE = process.env.BOOKINGS_TABLE;

const VALID_ROOM_TYPES = ['Standard Room', 'Deluxe Room', 'Family Suite'];
const VALID_STATUSES   = ['pending', 'confirmed', 'cancelled'];

// POST /bookings  (public — no auth required)
exports.createBooking = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { firstName, lastName, email, phone, checkIn, checkOut, roomType, message } = body;

  if (!firstName?.trim())  return res.badRequest('firstName is required');
  if (!lastName?.trim())   return res.badRequest('lastName is required');
  if (!email?.trim())      return res.badRequest('email is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.badRequest('Invalid email address');
  if (!checkIn)            return res.badRequest('checkIn date is required');
  if (!checkOut)           return res.badRequest('checkOut date is required');
  if (!roomType)           return res.badRequest('roomType is required');
  if (!VALID_ROOM_TYPES.includes(roomType))
    return res.badRequest(`roomType must be one of: ${VALID_ROOM_TYPES.join(', ')}`);

  const checkInDate  = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  if (isNaN(checkInDate.getTime()))  return res.badRequest('Invalid checkIn date');
  if (isNaN(checkOutDate.getTime())) return res.badRequest('Invalid checkOut date');
  if (checkInDate < today)           return res.badRequest('checkIn date cannot be in the past');
  if (checkOutDate <= checkInDate)   return res.badRequest('checkOut must be after checkIn');

  const bookingId      = uuidv4();
  const confirmationId = `GH-${bookingId.slice(0, 8).toUpperCase()}`;
  const now            = new Date().toISOString();

  const booking = {
    bookingId,
    confirmationId,
    firstName:  firstName.trim(),
    lastName:   lastName.trim(),
    email:      email.trim().toLowerCase(),
    phone:      phone?.trim() || null,
    checkIn,
    checkOut,
    roomType,
    message:    message?.trim() || null,
    status:     'pending',
    createdAt:  now,
    updatedAt:  now,
  };

  try {
    await ddb.send(new PutCommand({
      TableName: BOOKINGS_TABLE,
      Item: booking,
      ConditionExpression: 'attribute_not_exists(bookingId)',
    }));

    logger.info('Booking created', { bookingId, confirmationId, email: booking.email, roomType });

    // Notifications are fire-and-forget — booking is already persisted
    const results = await Promise.allSettled([
      sendUserConfirmationEmail(booking),
      sendAdminNotificationEmail(booking),
      sendUserSms(booking.phone, booking),
      sendAdminSms(booking),
    ]);

    const labels = ['userEmail', 'adminEmail', 'userSms', 'adminSms'];
    results.forEach((r, i) => {
      if (r.status === 'rejected')
        logger.warn(`Notification failed: ${labels[i]}`, { error: r.reason?.message });
    });

    return res.created({
      bookingId,
      confirmationId,
      message: 'Booking request received. We will contact you shortly to confirm your reservation.',
      roomType,
      checkIn,
      checkOut,
    });
  } catch (err) {
    logger.error('createBooking error', { error: err.message });
    return res.serverError();
  }
};

// GET /admin/bookings  (admin only)
exports.listBookings = async (event) => {
  const qs     = event.queryStringParameters || {};
  const limit  = Math.min(parseInt(qs.limit || '50', 10), 100);
  const status = qs.status;
  const lastKey = qs.lastKey ? JSON.parse(decodeURIComponent(qs.lastKey)) : undefined;

  try {
    const params = { TableName: BOOKINGS_TABLE, Limit: limit };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    if (status) {
      if (!VALID_STATUSES.includes(status)) return res.badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);
      params.FilterExpression = '#s = :status';
      params.ExpressionAttributeNames  = { '#s': 'status' };
      params.ExpressionAttributeValues = { ':status': status };
    }

    const { Items, LastEvaluatedKey } = await ddb.send(new ScanCommand(params));
    return res.ok({
      bookings: Items || [],
      count:   Items?.length || 0,
      lastKey: LastEvaluatedKey ? encodeURIComponent(JSON.stringify(LastEvaluatedKey)) : null,
    });
  } catch (err) {
    logger.error('listBookings error', { error: err.message });
    return res.serverError();
  }
};

// GET /admin/bookings/{bookingId}  (admin only)
exports.getBooking = async (event) => {
  const { bookingId } = event.pathParameters || {};
  if (!bookingId) return res.badRequest('bookingId is required');

  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: BOOKINGS_TABLE, Key: { bookingId } }));
    if (!Item) return res.notFound('Booking not found');
    return res.ok(Item);
  } catch (err) {
    logger.error('getBooking error', { error: err.message });
    return res.serverError();
  }
};

// PATCH /admin/bookings/{bookingId}/status  (admin only)
exports.updateBookingStatus = async (event) => {
  const { bookingId } = event.pathParameters || {};
  if (!bookingId) return res.badRequest('bookingId is required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { status } = body;
  if (!status) return res.badRequest('status is required');
  if (!VALID_STATUSES.includes(status)) return res.badRequest(`status must be one of: ${VALID_STATUSES.join(', ')}`);

  try {
    const { Attributes } = await ddb.send(new UpdateCommand({
      TableName: BOOKINGS_TABLE,
      Key: { bookingId },
      UpdateExpression: 'SET #s = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames:  { '#s': 'status' },
      ExpressionAttributeValues: { ':status': status, ':updatedAt': new Date().toISOString() },
      ConditionExpression: 'attribute_exists(bookingId)',
      ReturnValues: 'ALL_NEW',
    }));
    logger.info('Booking status updated', { bookingId, status });
    return res.ok(Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.notFound('Booking not found');
    logger.error('updateBookingStatus error', { error: err.message });
    return res.serverError();
  }
};
