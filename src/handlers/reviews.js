'use strict';

const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const res    = require('../utils/response');
const logger = require('/opt/nodejs/logger');

const client = new DynamoDBClient({});
const ddb    = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
const TABLE  = process.env.REVIEWS_TABLE;

function getClaims(event) { return event.requestContext?.authorizer?.jwt?.claims ?? {}; }
function isAdmin(claims) {
  const groups = claims['cognito:groups'];
  if (!groups) return false;
  const parsed = Array.isArray(groups) ? groups : JSON.parse(groups);
  return parsed.includes('admins');
}

// GET /reviews  — approved reviews only (public)
exports.listReviews = async (event) => {
  const qs    = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qs.limit || '50', 10), 100);

  try {
    const { Items } = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'isApproved = :t',
      ExpressionAttributeValues: { ':t': true },
      Limit: limit,
    }));

    const reviews = (Items || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.ok({ reviews, count: reviews.length });
  } catch (err) {
    logger.error('listReviews error', { error: err.message });
    return res.serverError();
  }
};

// POST /reviews  — submit a review (public)
exports.submitReview = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { guestName, city, rating, quote } = body;
  if (!guestName?.trim()) return res.badRequest('guestName is required');
  if (!quote?.trim())     return res.badRequest('quote is required');
  if (!rating)            return res.badRequest('rating is required');

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5)
    return res.badRequest('rating must be an integer between 1 and 5');

  if (quote.trim().length > 1000) return res.badRequest('quote must be 1000 characters or less');

  const reviewId = uuidv4();
  const now      = new Date().toISOString();

  const review = {
    reviewId,
    guestName:  guestName.trim(),
    city:       city?.trim() || null,
    rating:     ratingNum,
    quote:      quote.trim(),
    isApproved: false,
    createdAt:  now,
    updatedAt:  now,
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: review,
      ConditionExpression: 'attribute_not_exists(reviewId)',
    }));

    logger.info('Review submitted', { reviewId, guestName: review.guestName });
    return res.created({
      reviewId,
      message: 'Thank you for your review! It will be published after approval.',
    });
  } catch (err) {
    logger.error('submitReview error', { error: err.message });
    return res.serverError();
  }
};

// GET /admin/reviews?approved=true|false  — all reviews (admin)
exports.adminListReviews = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const qs       = event.queryStringParameters || {};
  const limit    = Math.min(parseInt(qs.limit || '50', 10), 100);
  const approved = qs.approved;

  try {
    const params = { TableName: TABLE, Limit: limit };

    if (approved !== undefined) {
      const flag = approved === 'true';
      params.FilterExpression = 'isApproved = :flag';
      params.ExpressionAttributeValues = { ':flag': flag };
    }

    const { Items } = await ddb.send(new ScanCommand(params));
    const reviews   = (Items || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.ok({ reviews, count: reviews.length });
  } catch (err) {
    logger.error('adminListReviews error', { error: err.message });
    return res.serverError();
  }
};

// PATCH /admin/reviews/{reviewId}/approve  (admin)
exports.approveReview = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { reviewId } = event.pathParameters || {};
  if (!reviewId) return res.badRequest('reviewId is required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const isApproved = body.isApproved !== false;

  try {
    const { Attributes } = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { reviewId },
      UpdateExpression: 'SET isApproved = :flag, updatedAt = :now',
      ExpressionAttributeValues: { ':flag': isApproved, ':now': new Date().toISOString() },
      ConditionExpression: 'attribute_exists(reviewId)',
      ReturnValues: 'ALL_NEW',
    }));

    logger.info('Review approval updated', { reviewId, isApproved, by: claims.email });
    return res.ok(Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return res.notFound('Review not found');
    logger.error('approveReview error', { error: err.message });
    return res.serverError();
  }
};

// DELETE /admin/reviews/{reviewId}  (admin)
exports.deleteReview = async (event) => {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return res.forbidden('Admin access required');

  const { reviewId } = event.pathParameters || {};
  if (!reviewId) return res.badRequest('reviewId is required');

  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { reviewId } }));
    if (!Item) return res.notFound('Review not found');

    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { reviewId } }));

    logger.info('Review deleted', { reviewId, by: claims.email });
    return res.noContent();
  } catch (err) {
    logger.error('deleteReview error', { error: err.message });
    return res.serverError();
  }
};
