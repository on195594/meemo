'use strict';

var users = require('../users.js');

var loginAttempts = {};

function serviceError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function authenticate(username, password, ip, callback) {
    var now = Date.now();
    var windowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 60000;
    var maxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10;
    var record = loginAttempts[ip];

    if (!record || now > record.resetAt) {
        record = loginAttempts[ip] = { count: 0, resetAt: now + windowMs };
    }

    record.count++;
    if (record.count > maxAttempts) {
        return callback(serviceError('rate_limit', 'Too many login attempts. Please try again later.'));
    }

    users.verify(username, password, function (error, user) {
        if (error) return callback(error);
        delete loginAttempts[ip];
        callback(null, {
            id: (user && (user.id || user._id)) ? String(user.id || user._id) : username,
            username: (user && user.username) ? user.username : username
        });
    });
}

function register(data, callback) {
    var mode = process.env.REGISTRATION_MODE || (process.env.NODE_ENV === 'production' ? 'first-user' : 'open');
    if (mode === 'disabled') return callback(serviceError('registration_disabled', 'Registration is disabled'));

    function createUser() {
        users.create(data.username, data.email, data.displayName, data.password, callback);
    }

    if (mode !== 'first-user') return createUser();

    users.count(function (error, count) {
        if (error) return callback(error);
        if (count > 0) return callback(serviceError('registration_closed', 'Registration is closed (first-user only)'));
        createUser();
    });
}

function profile(userId, callback) {
    users.profile(userId, false, callback);
}

module.exports = {
    authenticate: authenticate,
    register: register,
    profile: profile,
    UserError: users.UserError
};
