'use strict';

var settings = require('../../services/settings-service.js'),
    asyncHandler = require('../middleware/async-handler.js'),
    responses = require('../responses.js'),
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var settingsBody = z.object({
    settings: z.record(z.unknown(), { required_error: 'settings must be an object', invalid_type_error: 'settings must be an object' })
});

async function save(req, res, next) {
    await settings.save(req.user.id, req.body.settings);
    next(new HttpSuccess(202, {}));
}

async function get(req, res, next) {
    next(new HttpSuccess(200, { settings: await settings.get(req.user.id) }));
}

function registerRoutes(router, auth) {
    router.post('/api/settings', auth, validate({ body: settingsBody }), asyncHandler(save));
    router.get('/api/settings', auth, asyncHandler(get));
}

module.exports = {
    registerRoutes: registerRoutes,
    save: save,
    get: get,
    schema: settingsBody
};
