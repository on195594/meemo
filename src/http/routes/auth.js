'use strict';

var users = require('../../users.js'),
    UserError = users.UserError,
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var missingRegistrationField = 'missing username, password, email or displayName';
var registerBody = z.object({
    username: z.string({ required_error: missingRegistrationField, invalid_type_error: missingRegistrationField })
        .trim().toLowerCase().regex(/^[a-z0-9_\-]{3,32}$/, 'username must be 3-32 characters and contain only letters, numbers, underscores, and hyphens'),
    password: z.string({ required_error: missingRegistrationField, invalid_type_error: missingRegistrationField })
        .min(8, 'password must be between 8 and 128 characters')
        .max(128, 'password must be between 8 and 128 characters'),
    email: z.string({ required_error: missingRegistrationField, invalid_type_error: missingRegistrationField })
        .trim().max(128, 'invalid email address').email('invalid email address'),
    displayName: z.string({ required_error: missingRegistrationField, invalid_type_error: missingRegistrationField })
        .trim().min(1, 'displayName must be between 1 and 64 characters')
        .max(64, 'displayName must be between 1 and 64 characters')
});

var loginBody = z.object({
    username: z.string({ required_error: 'missing username or password', invalid_type_error: 'missing username or password' })
        .trim().min(1, 'missing username or password').toLowerCase(),
    password: z.string({ required_error: 'missing username or password', invalid_type_error: 'missing username or password' })
});

var loginAttempts = {};

function checkLoginRateLimit(ip) {
    var now = Date.now();
    var windowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 60000;
    var maxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10;
    var record = loginAttempts[ip];

    if (!record || now > record.resetAt) {
        loginAttempts[ip] = { count: 1, resetAt: now + windowMs };
        return true;
    }

    record.count++;
    return record.count <= maxAttempts;
}

function login(req, res, next) {
    var clientIp = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    if (!checkLoginRateLimit(clientIp)) {
        return next(new HttpError(429, 'Too many login attempts. Please try again later.'));
    }

    users.verify(req.body.username, req.body.password, function (error, user) {
        if (error && (error.code === UserError.NOT_FOUND || error.code === UserError.NOT_AUTHORIZED)) {
            return next(new HttpError(401, 'Invalid username or password', 'invalid_credentials'));
        }
        if (error) return next(new HttpError(500, error));

        delete loginAttempts[clientIp];

        var stableUserId = (user && (user.id || user._id)) ? String(user.id || user._id) : req.body.username;
        var canonicalUsername = (user && user.username) ? user.username : req.body.username;

        req.session.regenerate(function (regenErr) {
            if (regenErr) return next(new HttpError(500, regenErr));
            req.session.userId = stableUserId;
            req.session.username = canonicalUsername;
            next(new HttpSuccess(200, {}));
        });
    });
}

function logout(req, res, next) {
    if (!req.session) return next(new HttpSuccess(200, {}));

    req.session.destroy(function (error) {
        if (error) return next(new HttpError(500, error));
        res.clearCookie('connect.sid');
        next(new HttpSuccess(200, {}));
    });
}

function register(req, res, next) {
    var registrationMode = process.env.REGISTRATION_MODE || (process.env.NODE_ENV === 'production' ? 'first-user' : 'open');

    if (registrationMode === 'disabled') {
        return next(new HttpError(403, 'Registration is disabled'));
    }

    function createUser() {
        users.create(req.body.username, req.body.email, req.body.displayName, req.body.password, function (error) {
            if (error && error.code === 'user exists') return next(new HttpError(409, error.message));
            if (error) return next(new HttpError(500, error));
            next(new HttpSuccess(201, {}));
        });
    }

    if (registrationMode !== 'first-user') return createUser();

    users.count(function (error, count) {
        if (error) return next(new HttpError(500, error));
        if (count > 0) return next(new HttpError(403, 'Registration is closed (first-user only)'));
        createUser();
    });
}

function profile(req, res, next) {
    users.profile(req.user.id, false, function (error, result) {
        if (error && error.code === UserError.NOT_FOUND) return next(new HttpError(404, error.message));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { user: result }));
    });
}

function registerRoutes(router, auth) {
    router.post('/api/register', validate({ body: registerBody }), register);
    router.post('/api/login', validate({ body: loginBody }), login);
    router.post('/api/logout', logout);
    router.get('/api/profile', auth, profile);
}

module.exports = {
    registerRoutes: registerRoutes,
    login: login,
    logout: logout,
    register: register,
    profile: profile,
    schemas: {
        login: loginBody,
        register: registerBody
    }
};
