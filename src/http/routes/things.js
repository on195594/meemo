'use strict';

var logic = require('../../logic.js'),
    tags = require('../../database/tags.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var attachment = z.union([
    validation.safePathSegment,
    z.object({
        identifier: validation.safePathSegment,
        fileName: z.string().min(1).max(255).optional(),
        type: z.string().min(1).max(64).optional()
    }).passthrough()
]);

var createBody = z.object({
    content: z.string({ required_error: 'content must be a string', invalid_type_error: 'content must be a string' })
        .min(1, 'content must be a string'),
    attachments: z.array(attachment, { invalid_type_error: 'attachments must be an array' }).default([])
});

var updateBody = createBody.extend({
    public: z.boolean({ invalid_type_error: 'public must be a boolean' }).default(false),
    shared: z.boolean({ invalid_type_error: 'shared must be a boolean' }).default(false),
    archived: z.boolean({ invalid_type_error: 'archived must be a boolean' }).default(false),
    sticky: z.boolean({ invalid_type_error: 'sticky must be a boolean' }).default(false)
});

var listQuery = z.object({
    filter: z.string().max(1000).optional(),
    sticky: validation.queryBoolean.optional().default(false),
    archived: validation.queryBoolean.optional().default(false),
    skip: validation.pagination.skip,
    limit: validation.pagination.limit
});

var idParams = z.object({ id: validation.objectId });

function getAll(req, res, next) {
    var query = { $or: [] };

    if (req.query.filter) {
        query.$or.push({ $text: { $search: req.query.filter } });
    } else {
        query.$or.push({ content: { $exists: true } });
    }

    if (req.query.sticky) query.$or.push({ sticky: true });

    var archiveQuery = req.query.archived ? { archived: true } : {
        $or: [{ archived: false }, { archived: { $exists: false } }]
    };

    logic.getAll(req.user.id, { $and: [archiveQuery, query] }, req.query.skip, req.query.limit, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { things: result }));
    });
}

function get(req, res, next) {
    logic.get(req.user.id, req.params.id, function (error, result) {
        if (error && error.message === 'not found') return next(new HttpError(404, 'not found'));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { thing: result }));
    });
}

function add(req, res, next) {
    logic.add(req.user.id, req.body.content, req.body.attachments, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(201, { thing: result }));
    });
}

function put(req, res, next) {
    logic.put(req.user.id, req.params.id, req.body.content, req.body.attachments,
        req.body.public, req.body.shared, req.body.archived, req.body.sticky, function (error, result) {
            if (error && error.message === 'not found') return next(new HttpError(404, 'not found'));
            if (error) return next(new HttpError(500, error));
            next(new HttpSuccess(201, { thing: result }));
        });
}

function del(req, res, next) {
    logic.del(req.user.id, req.params.id, function (error) {
        if (error && error.message === 'not found') return next(new HttpError(404, 'not found'));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, {}));
    });
}

function getTags(req, res, next) {
    tags.get(req.user.id, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { tags: result }));
    });
}

function registerRoutes(router, auth) {
    router.post('/api/things', auth, validate({ body: createBody }), add);
    router.get('/api/things', auth, validate({ query: listQuery }), getAll);
    router.get('/api/things/:id', auth, validate({ params: idParams }), get);
    router.put('/api/things/:id', auth, validate({ params: idParams, body: updateBody }), put);
    router.delete('/api/things/:id', auth, validate({ params: idParams }), del);
    router.get('/api/tags', auth, getTags);
}

module.exports = {
    registerRoutes: registerRoutes,
    getAll: getAll,
    get: get,
    add: add,
    put: put,
    del: del,
    getTags: getTags,
    schemas: {
        create: createBody,
        update: updateBody,
        list: listQuery,
        id: idParams
    }
};
