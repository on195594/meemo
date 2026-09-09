'use strict';

var authService = require('../../services/auth-service.js'),
    UserError = authService.UserError,
    asyncHandler = require('../middleware/async-handler.js'),
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

async function login(req, res, next) {
    var clientIp = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    var user;
    try {
        user = await authService.authenticate(req.body.username, req.body.password, clientIp);
    } catch (error) {
        if (error.code === 'rate_limit') throw new HttpError(429, error.message);
        if (error.code === UserError.NOT_FOUND || error.code === UserError.NOT_AUTHORIZED) {
            throw new HttpError(401, 'Invalid username or password', 'invalid_credentials');
        }
        throw new HttpError(500, error);
    }

    await new Promise(function (resolve, reject) {
        req.session.regenerate(function (error) { if (error) reject(error); else resolve(); });
    });
    req.session.userId = user.id;
    req.session.username = user.username;
    next(new HttpSuccess(200, {}));
}

async function logout(req, res, next) {
    if (!req.session) return next(new HttpSuccess(200, {}));
    await new Promise(function (resolve, reject) {
        req.session.destroy(function (error) { if (error) reject(error); else resolve(); });
    });
    res.clearCookie('connect.sid');
    next(new HttpSuccess(200, {}));
}

async function register(req, res, next) {
    try {
        await authService.register(req.body);
    } catch (error) {
        if (error.code === 'registration_disabled' || error.code === 'registration_closed') throw new HttpError(403, error.message);
        if (error.code === 'user exists') throw new HttpError(409, error.message);
        throw new HttpError(500, error);
    }
    next(new HttpSuccess(201, {}));
}

async function profile(req, res, next) {
    try {
        next(new HttpSuccess(200, { user: await authService.profile(req.user.id) }));
    } catch (error) {
        if (error.code === UserError.NOT_FOUND) throw new HttpError(404, error.message);
        throw new HttpError(500, error);
    }
}

function registerRoutes(router, auth) {
    router.post('/api/register', validate({ body: registerBody }), asyncHandler(register));
    router.post('/api/login', validate({ body: loginBody }), asyncHandler(login));
    router.post('/api/logout', asyncHandler(logout));
    router.get('/api/profile', auth, asyncHandler(profile));
}

module.exports = {
    registerRoutes: registerRoutes,
    login: login,
    logout: logout,
    register: register,
    profile: profile,
    schemas: { login: loginBody, register: registerBody }
};
