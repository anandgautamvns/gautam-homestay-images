'use strict';

const res     = require('../utils/response');
const db      = require('../utils/dynamodb');
const s3      = require('../utils/s3');
const cognito = require('../utils/cognito');
const logger  = require('/opt/nodejs/logger');

function getClaims(event) {
  return event.requestContext?.authorizer?.jwt?.claims ?? {};
}

function isAdmin(claims) {
  const groups = claims['cognito:groups'];
  if (!groups) return false;
  const parsed = Array.isArray(groups) ? groups : JSON.parse(groups);
  return parsed.includes('admins');
}

// GET /admin/users?limit=50&lastKey=<base64>
exports.listUsers = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const limit   = Math.min(parseInt(event.queryStringParameters?.limit || '50', 10), 100);
  const rawKey  = event.queryStringParameters?.lastKey;
  const lastKey = rawKey ? JSON.parse(Buffer.from(rawKey, 'base64').toString()) : undefined;

  try {
    const { items, lastKey: nextKey } = await db.listUsers(limit, lastKey);
    const nextToken = nextKey ? Buffer.from(JSON.stringify(nextKey)).toString('base64') : null;

    logger.info('adminListUsers', { count: items.length, requestedBy: claims.email });
    return res.ok({
      users: items.map(sanitizeUser),
      nextToken,
      count: items.length,
    });
  } catch (err) {
    logger.error('adminListUsers error', { error: err.message });
    return res.serverError();
  }
};

// GET /admin/users/{userId}
exports.getUser = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { userId } = event.pathParameters || {};
  if (!userId) return res.badRequest('userId path parameter is required');

  try {
    const user = await db.getUser(userId);
    if (!user) return res.notFound('User not found');

    logger.info('adminGetUser', { targetUserId: userId, requestedBy: claims.email });
    return res.ok(sanitizeUser(user));
  } catch (err) {
    logger.error('adminGetUser error', { error: err.message });
    return res.serverError();
  }
};

// DELETE /admin/users/{userId}
exports.deleteUser = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { userId } = event.pathParameters || {};
  if (!userId) return res.badRequest('userId path parameter is required');

  try {
    const user = await db.getUser(userId);
    if (!user) return res.notFound('User not found');

    // Delete profile picture from S3 if present
    if (user.profilePictureKey) {
      await s3.deleteObject(user.profilePictureKey);
    }

    // Delete from Cognito and DynamoDB
    await cognito.adminDeleteUser(user.email);
    await db.deleteUser(userId);

    logger.info('adminDeleteUser', { targetUserId: userId, requestedBy: claims.email });
    return res.noContent();
  } catch (err) {
    if (err.name === 'UserNotFoundException') {
      // Cognito user already gone — still remove from DynamoDB
      await db.deleteUser(userId).catch(() => {});
      return res.noContent();
    }
    logger.error('adminDeleteUser error', { error: err.message });
    return res.serverError();
  }
};

// GET /admin/profile/picture/upload-url?contentType=image/jpeg
// Allows admin to upload their OWN admin profile picture
exports.getUploadUrl = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const contentType = event.queryStringParameters?.contentType;
  if (!contentType) return res.badRequest('contentType query parameter is required');

  const email = claims.email;

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Admin profile not found');

    const result = await s3.getUploadPresignedUrl(user.userId, 'admin', contentType);
    logger.info('adminGetUploadUrl', { userId: user.userId });
    return res.ok(result);
  } catch (err) {
    if (err.code === 'INVALID_CONTENT_TYPE') return res.badRequest(err.message);
    logger.error('adminGetUploadUrl error', { error: err.message });
    return res.serverError();
  }
};

// PATCH /admin/profile/picture/confirm  { "key": "profiles/admin/<id>.jpg" }
exports.confirmPicture = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { key } = body;
  if (!key) return res.badRequest('key is required');

  const email = claims.email;

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Admin profile not found');

    if (!key.includes(user.userId)) return res.forbidden('Key does not belong to your profile');

    const profilePictureUrl = s3.buildCloudfrontUrl(key);
    const updated = await db.updateUser(user.userId, {
      profilePictureKey: key,
      profilePictureUrl,
    });

    logger.info('adminConfirmPicture', { userId: user.userId, key });
    return res.ok({ profilePictureUrl: updated.profilePictureUrl });
  } catch (err) {
    logger.error('adminConfirmPicture error', { error: err.message });
    return res.serverError();
  }
};

function sanitizeUser(user) {
  const { userId, email, name, role, phone, bio, dateOfBirth, homeAddress, propertyName, propertyAddress, numberOfRooms, gstNumber, profilePictureUrl, createdAt, updatedAt } = user;
  return { userId, email, name, role, phone, bio, dateOfBirth, homeAddress, propertyName, propertyAddress, numberOfRooms, gstNumber, profilePictureUrl, createdAt, updatedAt };
}
