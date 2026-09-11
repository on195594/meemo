'use strict';

var things = require('../../services/thing-service.js'),
    asyncHandler = require('../middleware/async-handler.js'),
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

async function getAll(req, res, next) {
    var andList = [];

    var archiveQuery = req.query.archived ? { archived: true } : {
        $or: [{ archived: false }, { archived: { $exists: false } }]
    };
    andList.push(archiveQuery);

    var searchCondition = things.buildSearchFilter(req.query.filter);
    if (searchCondition) {
        andList.push(searchCondition);
    }

    if (req.query.sticky) {
        andList.push({ sticky: true });
    }

    var query = andList.length === 1 ? andList[0] : { $and: andList };

    var result = await things.getAll(req.user.id, query, req.query.skip, req.query.limit);
    next(new HttpSuccess(200, { things: result }));
}

async function get(req, res, next) {
    try {
        next(new HttpSuccess(200, { thing: await things.get(req.user.id, req.params.id) }));
    } catch (error) {
        if (error.message === 'not found') throw new HttpError(404, 'not found');
        throw error;
    }
}

async function add(req, res, next) {
    var result = await things.add(req.user.id, req.body.content, req.body.attachments);
    next(new HttpSuccess(201, { thing: result }));
}

async function put(req, res, next) {
    try {
        var result = await things.put(req.user.id, req.params.id, req.body.content, req.body.attachments,
            req.body.public, req.body.shared, req.body.archived, req.body.sticky);
        next(new HttpSuccess(201, { thing: result }));
    } catch (error) {
        if (error.message === 'not found') throw new HttpError(404, 'not found');
        throw error;
    }
}

async function del(req, res, next) {
    try {
        await things.del(req.user.id, req.params.id);
        next(new HttpSuccess(200, {}));
    } catch (error) {
        if (error.message === 'not found') throw new HttpError(404, 'not found');
        throw error;
    }
}

async function getTags(req, res, next) {
    next(new HttpSuccess(200, { tags: await things.getTags(req.user.id) }));
}

function registerRoutes(router, auth) {
    router.post('/api/things', auth, validate({ body: createBody }), asyncHandler(add));
    router.get('/api/things', auth, validate({ query: listQuery }), asyncHandler(getAll));
    router.get('/api/things/:id', auth, validate({ params: idParams }), asyncHandler(get));
    router.put('/api/things/:id', auth, validate({ params: idParams, body: updateBody }), asyncHandler(put));
    router.delete('/api/things/:id', auth, validate({ params: idParams }), asyncHandler(del));
    router.get('/api/tags', auth, asyncHandler(getTags));
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
