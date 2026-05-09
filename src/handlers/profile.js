'use strict';

const res    = require('../utils/response');
const db     = require('../utils/dynamodb');
const s3     = require('../utils/s3');
const logger = require('/opt/nodejs/logger');

function getClaims(event) {
  return event.requestContext?.authorizer?.jwt?.claims ?? {};
}

function getUserIdFromClaims(claims) {
  // Cognito sub is the unique identifier; we look up our DynamoDB userId by email
  return claims.sub;
}

// GET /profile
exports.getProfile = async (event) => {
  const claims = getClaims(event);
  const email  = claims.email;
  if (!email) return res.unauthorized();

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Profile not found');

    logger.info('getProfile', { userId: user.userId });
    return res.ok(sanitizeUser(user));
  } catch (err) {
    logger.error('getProfile error', { error: err.message });
    return res.serverError();
  }
};

// PUT /profile
exports.updateProfile = async (event) => {
  const claims = getClaims(event);
  const email  = claims.email;
  if (!email) return res.unauthorized();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { name, phone, bio } = body;
  const updates = {};
  if (name  !== undefined) updates.name  = name;
  if (phone !== undefined) updates.phone = phone;
  if (bio   !== undefined) updates.bio   = bio;

  if (!Object.keys(updates).length) return res.badRequest('No updatable fields provided');

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Profile not found');

    const updated = await db.updateUser(user.userId, updates);
    logger.info('updateProfile', { userId: user.userId });
    return res.ok(sanitizeUser(updated));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.notFound('Profile not found');
    logger.error('updateProfile error', { error: err.message });
    return res.serverError();
  }
};

// GET /profile/picture/upload-url  ?contentType=image/jpeg
exports.getUploadUrl = async (event) => {
  const claims      = getClaims(event);
  const email       = claims.email;
  if (!email) return res.unauthorized();

  const contentType = event.queryStringParameters?.contentType;
  if (!contentType) return res.badRequest('contentType query parameter is required (image/jpeg | image/png | image/webp)');

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Profile not found');

    const result = await s3.getUploadPresignedUrl(user.userId, user.role, contentType);
    logger.info('getUploadUrl', { userId: user.userId });
    return res.ok(result);
  } catch (err) {
    if (err.code === 'INVALID_CONTENT_TYPE') return res.badRequest(err.message);
    logger.error('getUploadUrl error', { error: err.message });
    return res.serverError();
  }
};

// PATCH /profile/picture/confirm  { "key": "profiles/user/<id>.jpg" }
exports.confirmPicture = async (event) => {
  const claims = getClaims(event);
  const email  = claims.email;
  if (!email) return res.unauthorized();

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { key } = body;
  if (!key) return res.badRequest('key is required');

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Profile not found');

    // Ensure the key belongs to this user
    if (!key.includes(user.userId)) return res.forbidden('Key does not belong to your profile');

    const profilePictureUrl = s3.buildCloudfrontUrl(key);
    const updated = await db.updateUser(user.userId, {
      profilePictureKey: key,
      profilePictureUrl,
    });

    logger.info('confirmPicture', { userId: user.userId, key });
    return res.ok({ profilePictureUrl: updated.profilePictureUrl });
  } catch (err) {
    logger.error('confirmPicture error', { error: err.message });
    return res.serverError();
  }
};

// DELETE /profile/picture
exports.deletePicture = async (event) => {
  const claims = getClaims(event);
  const email  = claims.email;
  if (!email) return res.unauthorized();

  try {
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) return res.notFound('Profile not found');
    if (!user.profilePictureKey) return res.notFound('No profile picture to delete');

    await s3.deleteObject(user.profilePictureKey);
    await db.updateUser(user.userId, { profilePictureKey: null, profilePictureUrl: null });

    logger.info('deletePicture', { userId: user.userId });
    return res.noContent();
  } catch (err) {
    logger.error('deletePicture error', { error: err.message });
    return res.serverError();
  }
};

function sanitizeUser(user) {
  const { userId, email, name, role, phone, bio, profilePictureUrl, createdAt, updatedAt } = user;
  return { userId, email, name, role, phone, bio, profilePictureUrl, createdAt, updatedAt };
}
