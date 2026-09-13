'use strict';

var config = require('../config.js'),
    session = require('express-session'),
    MongoStore = require('connect-mongo');

function createSession(options) {
    options = options || {};
    var isProduction = options.isProduction !== undefined ? options.isProduction : (process.env.NODE_ENV === 'production');
    var sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;

    if (!sessionSecret) {
        if (isProduction) {
            throw new Error('FATAL: SESSION_SECRET is required when NODE_ENV=production');
        }
        sessionSecret = require('crypto').randomBytes(32).toString('hex');
        console.warn('SESSION_SECRET is not set. A random secret was generated for this process; existing sessions will be invalidated after restart.');
    }

    var sessionStore;
    if (options.sessionStore) {
        sessionStore = options.sessionStore;
    } else if (options.sessionMemory) {
        sessionStore = undefined;
    } else {
        sessionStore = MongoStore.create({ mongoUrl: options.databaseUrl || config.databaseUrl });
    }

    var secureCookie = isProduction && Boolean(process.env.APP_ORIGIN && process.env.APP_ORIGIN.indexOf('https://') === 0);
    return session({
        secret: sessionSecret,
        saveUninitialized: false,
        resave: false,
        cookie: {
            sameSite: 'strict',
            httpOnly: true,
            secure: secureCookie
        },
        store: sessionStore
    });
}

module.exports = createSession;
