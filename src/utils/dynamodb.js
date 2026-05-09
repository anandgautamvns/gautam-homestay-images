'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE = process.env.USERS_TABLE;

async function getUser(userId) {
  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
  return Item || null;
}

async function getUserByEmail(email) {
  const { Items } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': email },
    Limit: 1,
  }));
  return Items?.[0] || null;
}

async function createUser(user) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: user,
    ConditionExpression: 'attribute_not_exists(userId)',
  }));
  return user;
}

async function updateUser(userId, updates) {
  const now = new Date().toISOString();
  const keys = Object.keys(updates);
  if (!keys.length) return getUser(userId);

  const expressions = keys.map((k, i) => `#k${i} = :v${i}`);
  const names = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
  const values = Object.fromEntries(keys.map((k, i) => [`:v${i}`, updates[k]]));
  values[':updatedAt'] = now;

  const { Attributes } = await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { userId },
    UpdateExpression: `SET ${expressions.join(', ')}, updatedAt = :updatedAt`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(userId)',
    ReturnValues: 'ALL_NEW',
  }));
  return Attributes;
}

async function deleteUser(userId) {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { userId } }));
}

async function listUsers(limit = 50, lastKey) {
  const params = { TableName: TABLE, Limit: limit };
  if (lastKey) params.ExclusiveStartKey = lastKey;
  const { Items, LastEvaluatedKey } = await ddb.send(new ScanCommand(params));
  return { items: Items || [], lastKey: LastEvaluatedKey };
}

module.exports = { getUser, getUserByEmail, createUser, updateUser, deleteUser, listUsers };
