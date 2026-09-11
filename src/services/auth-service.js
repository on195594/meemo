'use strict';

var nodeify = require('../promise.js'),
    users = require('../users.js');

var loginAttempts = {};
var registrationRepository = new users.MongoUserRepository();

function serviceError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function pruneExpiredAttempts(now) {
    var keys = Object.keys(loginAttempts);
    if (keys.length > 50) {
        for (var i = 0; i < keys.length; i++) {
            if (now > loginAttempts[keys[i]].resetAt) {
                delete loginAttempts[keys[i]];
            }
        }
    }
}

function authenticate(username, password, ip, callback) {
    var promise = Promise.resolve().then(async function () {
        var now = Date.now();
        var windowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 60000;
        var maxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10;
        pruneExpiredAttempts(now);
        var record = loginAttempts[ip];
        if (!record || now > record.resetAt) record = loginAttempts[ip] = { count: 0, resetAt: now + windowMs };

        record.count++;
        if (record.count > maxAttempts) throw serviceError('rate_limit', 'Too many login attempts. Please try again later.');

        var user = await users.verify(username, password);
        delete loginAttempts[ip];
        return {
            id: (user && (user.id || user._id)) ? String(user.id || user._id) : username,
            username: (user && user.username) ? user.username : username
        };
    });
    return nodeify(promise, callback);
}

function register(data, callback) {
    var promise = Promise.resolve().then(async function () {
        var mode = process.env.REGISTRATION_MODE || (process.env.NODE_ENV === 'production' ? 'first-user' : 'open');
        if (mode === 'disabled') throw serviceError('registration_disabled', 'Registration is disabled');

        if (mode === 'first-user') {
            if (!await registrationRepository.claimFirstUserRegistration()) {
                throw serviceError('registration_closed', 'Registration is closed (first-user only)');
            }

            var count;
            try {
                count = await users.count();
            } catch (error) {
                await registrationRepository.releaseFirstUserRegistration();
                throw error;
            }
            if (count > 0) {
                throw serviceError('registration_closed', 'Registration is closed (first-user only)');
            }

            try {
                await users.create(data.username, data.email, data.displayName, data.password);
            } catch (error) {
                await registrationRepository.releaseFirstUserRegistration();
                throw error;
            }
            return;
        }

        await users.create(data.username, data.email, data.displayName, data.password);
    });
    return nodeify(promise, callback);
}

function profile(userId, callback) {
    return nodeify(users.profile(userId, false), callback);
}

function _resetRateLimits() {
    loginAttempts = {};
}

module.exports = {
    authenticate: authenticate,
    register: register,
    profile: profile,
    UserError: users.UserError,
    _resetRateLimits: _resetRateLimits
};
