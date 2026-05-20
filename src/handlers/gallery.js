'use strict';

const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const res    = require('../utils/response');
const logger = require('/opt/nodejs/logger');

const client = new DynamoDBClient({});
const ddb    = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const s3     = new S3Client({});

const TABLE      = process.env.GALLERY_TABLE;
const BUCKET     = process.env.PROFILE_IMAGES_BUCKET;
const CF_DOMAIN  = process.env.CLOUDFRONT_DOMAIN;

const ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function getClaims(event) { return event.requestContext?.authorizer?.jwt?.claims ?? {}; }
function isAdmin(claims) {
  const groups = claims['cognito:groups'];
  if (!groups) return false;
  const parsed = Array.isArray(groups) ? groups : JSON.parse(groups);
  return parsed.includes('admins');
}

// GET /gallery  (public)
exports.listPhotos = async (event) => {
  const qs    = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qs.limit || '50', 10), 100);

  try {
    const { Items } = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'isActive = :t',
      ExpressionAttributeValues: { ':t': true },
      Limit: limit,
    }));

    const photos = (Items || []).sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99));
    return res.ok({ photos, count: photos.length });
  } catch (err) {
    logger.error('listPhotos error', { error: err.message });
    return res.serverError();
  }
};

// GET /admin/gallery/upload-url?contentType=image/jpeg  (admin)
exports.getUploadUrl = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const contentType = event.queryStringParameters?.contentType;
  if (!contentType) return res.badRequest('contentType query parameter is required');
  if (!ALLOWED_TYPES.includes(contentType)) return res.badRequest(`contentType must be one of: ${ALLOWED_TYPES.join(', ')}`);

  const photoId = uuidv4();
  const ext     = contentType.split('/')[1].replace('jpeg', 'jpg');
  const key     = `gallery/${photoId}.${ext}`;

  try {
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: MAX_SIZE_BYTES,
    }), { expiresIn: 300 });

    logger.info('Gallery upload URL generated', { photoId, by: claims.email });
    return res.ok({ uploadUrl, photoId, key, expiresIn: 300 });
  } catch (err) {
    logger.error('getGalleryUploadUrl error', { error: err.message });
    return res.serverError();
  }
};

// POST /admin/gallery  — save photo metadata after upload  (admin)
// Body: { photoId, key, title, displayOrder? }
exports.addPhoto = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { photoId, key, title, displayOrder } = body;
  if (!photoId?.trim()) return res.badRequest('photoId is required');
  if (!key?.trim())     return res.badRequest('key is required');
  if (!title?.trim())   return res.badRequest('title is required');
  if (!key.startsWith('gallery/')) return res.badRequest('key must be a gallery key');

  const imageUrl = `https://${CF_DOMAIN}/${key}`;
  const now      = new Date().toISOString();

  try {
    const photo = {
      photoId,
      title:        title.trim(),
      imageKey:     key,
      imageUrl,
      displayOrder: displayOrder ?? 99,
      isActive:     true,
      createdAt:    now,
      updatedAt:    now,
    };

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: photo,
      ConditionExpression: 'attribute_not_exists(photoId)',
    }));

    logger.info('Gallery photo added', { photoId, key, by: claims.email });
    return res.created(photo);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.conflict('Photo with this ID already exists');
    logger.error('addPhoto error', { error: err.message });
    return res.serverError();
  }
};

// PATCH /admin/gallery/{photoId}  — update title / displayOrder / isActive  (admin)
exports.updatePhoto = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { photoId } = event.pathParameters || {};
  if (!photoId) return res.badRequest('photoId is required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const updates = {};
  if (body.title        !== undefined) updates.title        = body.title;
  if (body.displayOrder !== undefined) updates.displayOrder = body.displayOrder;
  if (body.isActive     !== undefined) updates.isActive     = body.isActive;
  if (!Object.keys(updates).length) return res.badRequest('No valid fields to update');

  const now    = new Date().toISOString();
  const keys   = Object.keys(updates);
  const exprs  = keys.map((k, i) => `#k${i} = :v${i}`);
  const names  = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
  const values = Object.fromEntries(keys.map((k, i) => [`:v${i}`, updates[k]]));
  values[':now'] = now;

  try {
    const { Attributes } = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { photoId },
      UpdateExpression: `SET ${exprs.join(', ')}, updatedAt = :now`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(photoId)',
      ReturnValues: 'ALL_NEW',
    }));
    logger.info('Gallery photo updated', { photoId, by: claims.email });
    return res.ok(Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.notFound('Photo not found');
    logger.error('updatePhoto error', { error: err.message });
    return res.serverError();
  }
};

// DELETE /admin/gallery/{photoId}  (admin)
exports.deletePhoto = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { photoId } = event.pathParameters || {};
  if (!photoId) return res.badRequest('photoId is required');

  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { photoId } }));
    if (!Item) return res.notFound('Photo not found');

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: Item.imageKey }));

    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { photoId } }));

    logger.info('Gallery photo deleted', { photoId, key: Item.imageKey, by: claims.email });
    return res.noContent();
  } catch (err) {
    logger.error('deletePhoto error', { error: err.message });
    return res.serverError();
  }
};
