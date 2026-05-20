'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const res    = require('../utils/response');
const logger = require('/opt/nodejs/logger');

const client = new DynamoDBClient({});
const ddb    = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const TABLE  = process.env.ROOMS_TABLE;

function getClaims(event) { return event.requestContext?.authorizer?.jwt?.claims ?? {}; }
function isAdmin(claims) {
  const groups = claims['cognito:groups'];
  if (!groups) return false;
  const parsed = Array.isArray(groups) ? groups : JSON.parse(groups);
  return parsed.includes('admins');
}

const DEFAULT_ROOMS = [
  {
    roomId:       'standard-room',
    name:         'Standard Room',
    pricePerNight: 1200,
    currency:     'INR',
    description:  'Comfortable single or double occupancy with garden view and all essential amenities for a relaxing stay.',
    features:     ['Garden View', 'Wi-Fi', 'Hot Water', 'TV'],
    isPopular:    false,
    isActive:     true,
    displayOrder: 1,
  },
  {
    roomId:       'deluxe-room',
    name:         'Deluxe Room',
    pricePerNight: 1800,
    currency:     'INR',
    description:  'Spacious room with mountain-facing window, private balcony, and complimentary breakfast every morning.',
    features:     ['Mountain View', 'Balcony', 'Wi-Fi', 'Breakfast Included'],
    isPopular:    true,
    isActive:     true,
    displayOrder: 2,
  },
  {
    roomId:       'family-suite',
    name:         'Family Suite',
    pricePerNight: 2800,
    currency:     'INR',
    description:  'A large suite ideal for families — two bedrooms, a kitchenette, and a cozy living area for bonding.',
    features:     ['2 Bedrooms', 'Kitchenette', 'Living Area', 'All Meals'],
    isPopular:    false,
    isActive:     true,
    displayOrder: 3,
  },
];

async function seedRooms() {
  const now = new Date().toISOString();
  await Promise.all(DEFAULT_ROOMS.map(room =>
    ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { ...room, createdAt: now, updatedAt: now },
      ConditionExpression: 'attribute_not_exists(roomId)',
    })).catch(err => { if (err.name !== 'ConditionalCheckFailedException') throw err; })
  ));
}

// GET /rooms  (public)
exports.listRooms = async () => {
  try {
    const { Items } = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'isActive = :t',
      ExpressionAttributeValues: { ':t': true },
    }));

    if (!Items?.length) {
      await seedRooms();
      const now = new Date().toISOString();
      return res.ok({
        rooms: DEFAULT_ROOMS.map(r => ({ ...r, createdAt: now, updatedAt: now }))
          .sort((a, b) => a.displayOrder - b.displayOrder),
      });
    }

    return res.ok({
      rooms: Items.sort((a, b) => a.displayOrder - b.displayOrder),
    });
  } catch (err) {
    logger.error('listRooms error', { error: err.message });
    return res.serverError();
  }
};

// GET /rooms/{roomId}  (public)
exports.getRoom = async (event) => {
  const { roomId } = event.pathParameters || {};
  if (!roomId) return res.badRequest('roomId is required');

  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { roomId } }));
    if (!Item || !Item.isActive) return res.notFound('Room not found');
    return res.ok(Item);
  } catch (err) {
    logger.error('getRoom error', { error: err.message });
    return res.serverError();
  }
};

// POST /admin/rooms  (admin)
exports.createRoom = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { roomId, name, pricePerNight, description, features, isPopular, displayOrder } = body;
  if (!roomId?.trim())       return res.badRequest('roomId is required');
  if (!name?.trim())         return res.badRequest('name is required');
  if (!pricePerNight)        return res.badRequest('pricePerNight is required');
  if (!description?.trim())  return res.badRequest('description is required');
  if (!Array.isArray(features) || !features.length) return res.badRequest('features must be a non-empty array');

  const price = Number(pricePerNight);
  if (isNaN(price) || price <= 0) return res.badRequest('pricePerNight must be a positive number');

  const now = new Date().toISOString();
  const room = {
    roomId: roomId.trim().toLowerCase().replace(/\s+/g, '-'),
    name: name.trim(),
    pricePerNight: price,
    currency: 'INR',
    description: description.trim(),
    features,
    isPopular: isPopular === true,
    isActive: true,
    displayOrder: displayOrder ?? 99,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: room,
      ConditionExpression: 'attribute_not_exists(roomId)',
    }));
    logger.info('Room created', { roomId: room.roomId, by: claims.email });
    return res.created(room);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.conflict('Room with this ID already exists');
    logger.error('createRoom error', { error: err.message });
    return res.serverError();
  }
};

// PUT /admin/rooms/{roomId}  (admin)
exports.updateRoom = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { roomId } = event.pathParameters || {};
  if (!roomId) return res.badRequest('roomId is required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const allowed = ['name', 'pricePerNight', 'description', 'features', 'isPopular', 'isActive', 'displayOrder'];
  const updates = {};
  for (const k of allowed) { if (body[k] !== undefined) updates[k] = body[k]; }
  if (!Object.keys(updates).length) return res.badRequest('No valid fields to update');

  if (updates.pricePerNight !== undefined) {
    const price = Number(updates.pricePerNight);
    if (isNaN(price) || price <= 0) return res.badRequest('pricePerNight must be a positive number');
    updates.pricePerNight = price;
  }

  const now = new Date().toISOString();
  const keys = Object.keys(updates);
  const exprs    = keys.map((k, i) => `#k${i} = :v${i}`);
  const names    = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
  const values   = Object.fromEntries(keys.map((k, i) => [`:v${i}`, updates[k]]));
  values[':now'] = now;

  try {
    const { Attributes } = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { roomId },
      UpdateExpression: `SET ${exprs.join(', ')}, updatedAt = :now`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(roomId)',
      ReturnValues: 'ALL_NEW',
    }));
    logger.info('Room updated', { roomId, by: claims.email });
    return res.ok(Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.notFound('Room not found');
    logger.error('updateRoom error', { error: err.message });
    return res.serverError();
  }
};

// DELETE /admin/rooms/{roomId}  (admin)
exports.deleteRoom = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { roomId } = event.pathParameters || {};
  if (!roomId) return res.badRequest('roomId is required');

  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { roomId },
      ConditionExpression: 'attribute_exists(roomId)',
    }));
    logger.info('Room deleted', { roomId, by: claims.email });
    return res.noContent();
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.notFound('Room not found');
    logger.error('deleteRoom error', { error: err.message });
    return res.serverError();
  }
};
