'use strict';

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});
const BUCKET = process.env.PROFILE_IMAGES_BUCKET;
const CF_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function buildKey(userId, role) {
  // profiles/<role>/<userId>/picture.<ext> stored as temp until confirmed
  return `profiles/${role}/${userId}`;
}

function buildCloudfrontUrl(key) {
  return `https://${CF_DOMAIN}/${key}`;
}

async function getUploadPresignedUrl(userId, role, contentType) {
  if (!ALLOWED_TYPES.includes(contentType)) {
    throw Object.assign(new Error('Unsupported content type'), { code: 'INVALID_CONTENT_TYPE' });
  }

  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const key = `${buildKey(userId, role)}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLengthRange: [1, MAX_SIZE_BYTES],
    Metadata: { userId, role },
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
  return { uploadUrl, key, expiresIn: 300 };
}

async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { getUploadPresignedUrl, deleteObject, buildCloudfrontUrl };
