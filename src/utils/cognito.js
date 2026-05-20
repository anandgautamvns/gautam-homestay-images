'use strict';

const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID   = process.env.USER_POOL_CLIENT_ID;

async function signUp(email, password, name) {
  const { UserSub } = await cognito.send(new SignUpCommand({
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'name',  Value: name  },
    ],
  }));
  return UserSub;
}

async function confirmSignUp(email, code) {
  await cognito.send(new ConfirmSignUpCommand({
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
  }));
}

async function initiateAuth(email, password) {
  const { AuthenticationResult } = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  }));
  return AuthenticationResult;
}

async function refreshAuth(refreshToken) {
  const { AuthenticationResult } = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  }));
  return AuthenticationResult;
}

async function addToGroup(email, groupName) {
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    GroupName: groupName,
  }));
}

async function adminGetUser(email) {
  return cognito.send(new AdminGetUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
  }));
}

async function adminDeleteUser(email) {
  await cognito.send(new AdminDeleteUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
  }));
}

async function listCognitoUsers(limit = 50, paginationToken) {
  const params = { UserPoolId: USER_POOL_ID, Limit: limit };
  if (paginationToken) params.PaginationToken = paginationToken;
  const { Users, PaginationToken } = await cognito.send(new ListUsersCommand(params));
  return { users: Users || [], paginationToken: PaginationToken };
}

async function forgotPassword(email) {
  await cognito.send(new ForgotPasswordCommand({
    ClientId: CLIENT_ID,
    Username: email,
  }));
}

async function confirmForgotPassword(email, code, newPassword) {
  await cognito.send(new ConfirmForgotPasswordCommand({
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  }));
}

module.exports = { signUp, confirmSignUp, initiateAuth, refreshAuth, addToGroup, adminGetUser, adminDeleteUser, listCognitoUsers, forgotPassword, confirmForgotPassword };
