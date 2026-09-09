'use strict';

var attachments = require('../../services/attachment-service.js'),
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

function add(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.buffer) return next(new HttpError(400, 'missing file'));

    attachments.save(req.user.id, file, function (error, metadata) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(201, metadata));
    });
}

function get(req, res, next) {
    attachments.authorize(req.params.userId, req.params.thingId, req.params.identifier, req.session, function (error, result) {
        if (error && error.code === 'not_found') return next(new HttpError(404, error.message));
        if (error && error.code === 'forbidden') return next(new HttpError(403, error.message));
        if (error) return next(new HttpError(500, error));

        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (result.attachment.type !== attachments.TYPE_IMAGE) {
            res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(result.attachment.fileName || 'attachment') + '"');
        }
        res.sendFile(req.params.identifier, { root: result.root }, function (sendError) {
            if (sendError && !res.headersSent) return next(new HttpError(404, 'file not found'));
        });
    });
}

function registerRoutes(router, auth, upload) {
    router.post('/api/files', auth, upload, add);
    router.get('/api/files/:userId/:thingId/:identifier', validate({ params: fileParams }), get);
}

module.exports = {
    registerRoutes: registerRoutes,
    add: add,
    get: get,
    detectImageType: attachments.detectImageType,
    schema: fileParams
};
