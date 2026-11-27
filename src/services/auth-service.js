'use strict';

var users = require('../users.js');

var loginAttempts = new Map();
var MAX_TRACKED_LOGIN_IPS = 2000;
var fallbackRegistrationRepo = new users.MongoUserRepository();

function getRegistrationRepository() {
    var repo = users.getRepository();
    return repo && typeof repo.claimFirstUserRegistration === 'function' ? repo : fallbackRegistrationRepo;
}

function serviceError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function pruneExpiredAttempts(now, activeIp) {
    if (loginAttempts.size > 50) {
        for (var entry of loginAttempts.entries()) {
            if (now > entry[1].resetAt) {
                loginAttempts.delete(entry[0]);
            }
        }
    }
    if (!loginAttempts.has(activeIp)) {
        while (loginAttempts.size >= MAX_TRACKED_LOGIN_IPS) {
            var oldest = loginAttempts.keys().next().value;
            if (oldest === undefined) break;
            loginAttempts.delete(oldest);
        }
    }
}

async function authenticate(username, password, ip) {
    var now = Date.now();
    var windowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 60000;
    var maxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10;
    pruneExpiredAttempts(now, ip);
    var record = loginAttempts.get(ip);
    if (!record || now > record.resetAt) {
        record = { count: 0, resetAt: now + windowMs };
        loginAttempts.set(ip, record);
    }

    record.count++;
    if (record.count > maxAttempts) throw serviceError('rate_limit', 'Too many login attempts. Please try again later.');

    var user = await users.verify(username, password);
    loginAttempts.delete(ip);
    return {
        id: (user && (user.id || user._id)) ? String(user.id || user._id) : username,
        username: (user && user.username) ? user.username : username
    };
}

async function register(data) {
    var mode = process.env.REGISTRATION_MODE || (process.env.NODE_ENV === 'production' ? 'first-user' : 'open');
    if (mode === 'disabled') throw serviceError('registration_disabled', 'Registration is disabled');

    if (mode === 'first-user') {
        var registrationRepository = getRegistrationRepository();
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
}

async function profile(userId) {
    return users.profile(userId, false);
}

function _resetRateLimits() {
    loginAttempts.clear();
}

module.exports = {
    authenticate: authenticate,
    register: register,
    profile: profile,
    UserError: users.UserError,
    _resetRateLimits: _resetRateLimits
};
