'use strict';

const headers = {
  'Content-Type': 'application/json',
};

function ok(body) {
  return { statusCode: 200, headers, body: JSON.stringify(body) };
}

function created(body) {
  return { statusCode: 201, headers, body: JSON.stringify(body) };
}

function noContent() {
  return { statusCode: 204, headers, body: '' };
}

function badRequest(message = 'Bad request') {
  return { statusCode: 400, headers, body: JSON.stringify({ error: message }) };
}

function unauthorized(message = 'Unauthorized') {
  return { statusCode: 401, headers, body: JSON.stringify({ error: message }) };
}

function forbidden(message = 'Forbidden') {
  return { statusCode: 403, headers, body: JSON.stringify({ error: message }) };
}

function notFound(message = 'Not found') {
  return { statusCode: 404, headers, body: JSON.stringify({ error: message }) };
}

function conflict(message = 'Conflict') {
  return { statusCode: 409, headers, body: JSON.stringify({ error: message }) };
}

function tooManyRequests(message = 'Too many requests') {
  return { statusCode: 429, headers, body: JSON.stringify({ error: message }) };
}

function serverError(message = 'Internal server error') {
  return { statusCode: 500, headers, body: JSON.stringify({ error: message }) };
}

module.exports = { ok, created, noContent, badRequest, unauthorized, forbidden, notFound, conflict, tooManyRequests, serverError };
