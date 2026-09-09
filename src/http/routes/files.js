'use strict';

var attachments = require('../../services/attachment-service.js'),
    asyncHandler = require('../middleware/async-handler.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var fileParams = z.object({
    userId: validation.safePathSegment,
    thingId: z.string().min(1),
    identifier: validation.safePathSegment
});

async function add(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.buffer) throw new HttpError(400, 'missing file');
    next(new HttpSuccess(201, await attachments.save(req.user.id, file)));
}

async function get(req, res, next) {
    var result;
    try {
        result = await attachments.authorize(req.params.userId, req.params.thingId, req.params.identifier, req.session);
    } catch (error) {
        if (error.code === 'not_found') throw new HttpError(404, error.message);
        if (error.code === 'forbidden') throw new HttpError(403, error.message);
        throw error;
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.attachment.type !== attachments.TYPE_IMAGE) {
        res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(result.attachment.fileName || 'attachment') + '"');
    }
    res.sendFile(req.params.identifier, { root: result.root }, function (error) {
        if (error && !res.headersSent) next(new HttpError(404, 'file not found'));
    });
}

function registerRoutes(router, auth, upload) {
    router.post('/api/files', auth, upload, asyncHandler(add));
    router.get('/api/files/:userId/:thingId/:identifier', validate({ params: fileParams }), asyncHandler(get));
}

module.exports = {
    registerRoutes: registerRoutes,
    add: add,
    get: get,
    detectImageType: attachments.detectImageType,
    schema: fileParams
};
