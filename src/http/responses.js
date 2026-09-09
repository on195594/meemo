'use strict';

var http = require('http'),
    lastmile = require('connect-lastmile'),
    BaseHttpError = lastmile.HttpError,
    HttpSuccess = lastmile.HttpSuccess;

var ERROR_CODES = {
    400: 'invalid_request',
    401: 'authentication_required',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    413: 'payload_too_large',
    429: 'too_many_requests',
    500: 'internal_error',
    503: 'service_unavailable'
};

function HttpError(status, errorOrMessage, code) {
    var error = errorOrMessage instanceof Error ? errorOrMessage : new Error(errorOrMessage);
    error.details = { code: code || ERROR_CODES[status] || 'request_failed' };
    return new BaseHttpError(status, error);
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    if (error instanceof HttpSuccess) {
        if (error.body) return res.status(error.status).send(error.body);
        return res.status(error.status).end();
    }

    var status = 500;
    var code = ERROR_CODES[500];
    var message = 'Internal server error';

    if (error instanceof BaseHttpError) {
        status = error.status || 500;
        code = (error.details && error.details.code) || ERROR_CODES[status] || 'request_failed';
        message = status === 500 ? message : error.message;
    } else if (error && error.type === 'entity.parse.failed') {
        status = 400;
        code = ERROR_CODES[400];
        message = 'Failed to parse body';
    } else if (error && error.type === 'entity.too.large') {
        status = 413;
        code = ERROR_CODES[413];
        message = 'Request body limit exceeded';
    }

    if (status === 500) console.error(error);

    res.status(status).send({
        status: http.STATUS_CODES[status] || 'Error',
        code: code,
        message: message
    });
}

module.exports = {
    HttpError: HttpError,
    HttpSuccess: HttpSuccess,
    errorHandler: errorHandler
};
