'use strict';

const { v4: uuidv4 } = require('uuid');
const res             = require('../utils/response');
const db              = require('../utils/dynamodb');
const cognito         = require('../utils/cognito');
const logger          = require('/opt/nodejs/logger');

// POST /auth/register  (Guest / Customer)
exports.register = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { email, password, name, phone, dateOfBirth, homeAddress } = body;
  if (!email || !password || !name || !phone) return res.badRequest('email, password, name, and phone are required');
  if (password.length < 8) return res.badRequest('Password must be at least 8 characters');

  try {
    const existing = await db.getUserByEmail(email.toLowerCase());
    if (existing) return res.conflict('An account with this email already exists');

    const cognitoSub = await cognito.signUp(email.toLowerCase(), password, name);
    const userId = uuidv4();
    const now = new Date().toISOString();

    await db.createUser({
      userId,
      cognitoSub,
      email: email.toLowerCase(),
      name,
      phone,
      ...(dateOfBirth  && { dateOfBirth }),
      ...(homeAddress  && { homeAddress }),
      role: 'user',
      profilePictureKey: null,
      profilePictureUrl: null,
      createdAt: now,
      updatedAt: now,
    });

    await cognito.addToGroup(email.toLowerCase(), 'users');

    logger.info('User registered', { userId, email: email.toLowerCase() });
    return res.created({ message: 'Registration successful. Please verify your email.', userId });
  } catch (err) {
    if (err.name === 'UsernameExistsException') return res.conflict('An account with this email already exists');
    if (err.name === 'InvalidPasswordException') return res.badRequest(err.message);
    logger.error('register error', { error: err.message });
    return res.serverError();
  }
};

// POST /auth/register/owner  (Property Owner)
exports.registerOwner = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { email, password, name, phone, propertyName, propertyAddress, numberOfRooms, gstNumber } = body;
  if (!email || !password || !name || !phone || !propertyName || !propertyAddress || !numberOfRooms) {
    return res.badRequest('email, password, name, phone, propertyName, propertyAddress, and numberOfRooms are required');
  }
  if (password.length < 8) return res.badRequest('Password must be at least 8 characters');

  const rooms = parseInt(numberOfRooms, 10);
  if (isNaN(rooms) || rooms < 1) return res.badRequest('numberOfRooms must be a positive integer');

  try {
    const existing = await db.getUserByEmail(email.toLowerCase());
    if (existing) return res.conflict('An account with this email already exists');

    const cognitoSub = await cognito.signUp(email.toLowerCase(), password, name);
    const userId = uuidv4();
    const now = new Date().toISOString();

    await db.createUser({
      userId,
      cognitoSub,
      email: email.toLowerCase(),
      name,
      phone,
      propertyName,
      propertyAddress,
      numberOfRooms: rooms,
      ...(gstNumber && { gstNumber }),
      role: 'admin',
      profilePictureKey: null,
      profilePictureUrl: null,
      createdAt: now,
      updatedAt: now,
    });

    await cognito.addToGroup(email.toLowerCase(), 'admins');

    logger.info('Owner registered', { userId, email: email.toLowerCase() });
    return res.created({ message: 'Registration successful. Please verify your email.', userId });
  } catch (err) {
    if (err.name === 'UsernameExistsException') return res.conflict('An account with this email already exists');
    if (err.name === 'InvalidPasswordException') return res.badRequest(err.message);
    logger.error('registerOwner error', { error: err.message });
    return res.serverError();
  }
};

// POST /auth/confirm
exports.confirmAccount = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { email, code } = body;
  if (!email || !code) return res.badRequest('email and code are required');

  try {
    await cognito.confirmSignUp(email.toLowerCase(), code);
    logger.info('Account confirmed', { email });
    return res.ok({ message: 'Account confirmed. You can now log in.' });
  } catch (err) {
    if (err.name === 'CodeMismatchException')    return res.badRequest('Invalid confirmation code');
    if (err.name === 'ExpiredCodeException')     return res.badRequest('Confirmation code has expired');
    if (err.name === 'NotAuthorizedException')   return res.badRequest('Account is already confirmed');
    logger.error('confirmAccount error', { error: err.message });
    return res.serverError();
  }
};

// POST /auth/login
exports.login = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { email, password } = body;
  if (!email || !password) return res.badRequest('email and password are required');

  try {
    const tokens = await cognito.initiateAuth(email.toLowerCase(), password);
    const user   = await db.getUserByEmail(email.toLowerCase());

    logger.info('User logged in', { email, userId: user?.userId });
    return res.ok({
      accessToken:  tokens.AccessToken,
      idToken:      tokens.IdToken,
      refreshToken: tokens.RefreshToken,
      expiresIn:    tokens.ExpiresIn,
      user: user ? sanitizeUser(user) : null,
    });
  } catch (err) {
    if (err.name === 'NotAuthorizedException')  return res.unauthorized('Invalid email or password');
    if (err.name === 'UserNotConfirmedException') return res.unauthorized('Please verify your email before logging in');
    if (err.name === 'UserNotFoundException')   return res.unauthorized('Invalid email or password');
    logger.error('login error', { error: err.message });
    return res.serverError();
  }
};

// POST /auth/refresh
exports.refreshToken = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { refreshToken } = body;
  if (!refreshToken) return res.badRequest('refreshToken is required');

  try {
    const tokens = await cognito.refreshAuth(refreshToken);
    return res.ok({
      accessToken: tokens.AccessToken,
      idToken:     tokens.IdToken,
      expiresIn:   tokens.ExpiresIn,
    });
  } catch (err) {
    if (err.name === 'NotAuthorizedException') return res.unauthorized('Invalid or expired refresh token');
    logger.error('refreshToken error', { error: err.message });
    return res.serverError();
  }
};

// POST /auth/forgot-password
exports.forgotPassword = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { email } = body;
  if (!email) return res.badRequest('email is required');

  try {
    await cognito.forgotPassword(email.toLowerCase());
    logger.info('Forgot password initiated', { email });
    return res.ok({ message: 'If an account with that email exists, a reset code has been sent.' });
  } catch (err) {
    if (err.name === 'UserNotFoundException')     return res.ok({ message: 'If an account with that email exists, a reset code has been sent.' });
    if (err.name === 'InvalidParameterException') return res.badRequest('Account email is not verified');
    if (err.name === 'LimitExceededException')    return res.tooManyRequests('Too many requests. Please try again later.');
    logger.error('forgotPassword error', { error: err.message });
    return res.serverError();
  }
};

// POST /auth/reset-password
exports.resetPassword = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return res.badRequest('Invalid JSON'); }

  const { email, code, newPassword } = body;
  if (!email || !code || !newPassword) return res.badRequest('email, code, and newPassword are required');
  if (newPassword.length < 8) return res.badRequest('Password must be at least 8 characters');

  try {
    await cognito.confirmForgotPassword(email.toLowerCase(), code, newPassword);
    logger.info('Password reset successful', { email });
    return res.ok({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    if (err.name === 'CodeMismatchException')     return res.badRequest('Invalid reset code');
    if (err.name === 'ExpiredCodeException')      return res.badRequest('Reset code has expired. Please request a new one.');
    if (err.name === 'UserNotFoundException')     return res.badRequest('Invalid reset code');
    if (err.name === 'InvalidPasswordException')  return res.badRequest(err.message);
    if (err.name === 'LimitExceededException')    return res.tooManyRequests('Too many requests. Please try again later.');
    logger.error('resetPassword error', { error: err.message });
    return res.serverError();
  }
};

function sanitizeUser(user) {
  const { userId, email, name, role, phone, dateOfBirth, homeAddress, propertyName, propertyAddress, numberOfRooms, gstNumber, profilePictureUrl, createdAt } = user;
  return { userId, email, name, role, phone, dateOfBirth, homeAddress, propertyName, propertyAddress, numberOfRooms, gstNumber, profilePictureUrl, createdAt };
}
