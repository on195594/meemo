'use strict';

var settings = require('../../services/settings-service.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var settingsBody = z.object({
    settings: z.record(z.unknown(), { required_error: 'settings must be an object', invalid_type_error: 'settings must be an object' })
});

function save(req, res, next) {
    settings.save(req.user.id, req.body.settings, function (error) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(202, {}));
    });
}

function get(req, res, next) {
    settings.get(req.user.id, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { settings: result }));
    });
}

function registerRoutes(router, auth) {
    router.post('/api/settings', auth, validate({ body: settingsBody }), save);
    router.get('/api/settings', auth, get);
}

module.exports = {
    registerRoutes: registerRoutes,
    save: save,
    get: get,
    schema: settingsBody
};
