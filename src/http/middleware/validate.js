'use strict';

var path = require('path'),
    z = require('zod').z,
    HttpError = require('../responses.js').HttpError;

function validate(schemas) {
    return function (req, res, next) {
        var locations = Object.keys(schemas);

        for (var i = 0; i < locations.length; i++) {
            var location = locations[i];
            var result = schemas[location].safeParse(req[location] || {});

            if (!result.success) {
                return next(new HttpError(400, result.error.issues[0].message, 'invalid_request'));
            }

            req[location] = result.data;
        }

        next();
    };
}

var objectId = z.string().refine(function (value) {
    return /^[0-9a-f]{24}$/i.test(value);
}, 'invalid id');

var safePathSegment = z.string().min(1).refine(function (value) {
    return path.basename(value) === value && value !== '.' && value !== '..';
}, 'invalid path segment');

var queryBoolean = z.preprocess(function (value) {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return value;
}, z.boolean());

var pagination = {
    skip: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(10)
};

module.exports = {
    validate: validate,
    z: z,
    objectId: objectId,
    safePathSegment: safePathSegment,
    queryBoolean: queryBoolean,
    pagination: pagination
};
