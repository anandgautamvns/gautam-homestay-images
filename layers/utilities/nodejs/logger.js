'use strict';

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const currentLevel = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function log(level, message, data = {}) {
  if (LEVELS[level] < currentLevel) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: process.env.AWS_LAMBDA_FUNCTION_NAME,
    stage: process.env.STAGE,
    message,
    ...data,
  };
  const output = JSON.stringify(entry);
  level === 'ERROR' ? console.error(output) : console.log(output);
}

module.exports = {
  debug: (msg, data) => log('DEBUG', msg, data),
  info:  (msg, data) => log('INFO',  msg, data),
  warn:  (msg, data) => log('WARN',  msg, data),
  error: (msg, data) => log('ERROR', msg, data),
};
