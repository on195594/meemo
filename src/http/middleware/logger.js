'use strict';

var crypto = require('crypto');

var SENSITIVE_KEY_PATTERN = /^(password|passwordhash|secret|token|authorization|cookie|session|key)$/i;

function generateRequestId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function sanitizeValue(key, value) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
        return '[REDACTED]';
    }
    return value;
}

function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeObject);

    var clean = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (SENSITIVE_KEY_PATTERN.test(k)) {
            clean[k] = '[REDACTED]';
        } else if (typeof obj[k] === 'object' && obj[k] !== null) {
            clean[k] = sanitizeObject(obj[k]);
        } else {
            clean[k] = obj[k];
        }
    }
    return clean;
}

function createLogger(options) {
    options = options || {};
    var outputStream = options.stream || process.stdout;
    var isEnabled = options.enabled !== undefined ? options.enabled : (process.env.NODE_ENV !== 'test' || Boolean(options.forceEnable));

    function write(record) {
        if (!isEnabled) return;
        var entry = Object.assign({ timestamp: new Date().toISOString() }, record);
        try {
            if (typeof outputStream.write === 'function') {
                outputStream.write(JSON.stringify(entry) + '\n');
            } else if (typeof outputStream === 'function') {
                outputStream(entry);
            }
        } catch (e) {
            // Ignore logging serialization failures
        }
    }

    function logError(error, req) {
        if (!isEnabled) return;
        var requestId = req ? (req.id || req.requestId) : undefined;
        var message = error instanceof Error ? error.message : String(error);
        var stack = error instanceof Error ? error.stack : undefined;

        write({
            level: 'error',
            requestId: requestId,
            error: {
                name: (error && error.name) || 'Error',
                message: message,
                code: (error && error.code) || (error && error.details && error.details.code) || 'internal_error',
                stack: stack
            }
        });
    }

    function middleware(req, res, next) {
        var incomingId = req.headers['x-request-id'];
        var requestId = (typeof incomingId === 'string' && incomingId.trim() && incomingId.length <= 128)
            ? incomingId.trim()
            : generateRequestId();

        req.id = requestId;
        req.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        var startTime = process.hrtime();

        res.on('finish', function () {
            var diff = process.hrtime(startTime);
            var durationMs = (diff[0] * 1e3) + (diff[1] * 1e-6);
            var status = res.statusCode;

            var level = 'info';
            if (status >= 500) {
                level = 'error';
            } else if (status >= 400) {
                level = 'warn';
            }

            var userId;
            if (req.session && req.session.userId) {
                userId = req.session.userId;
            } else if (req.user && req.user.id) {
                userId = req.user.id;
            }

            var errorCode;
            if (res.locals && res.locals.errorCode) {
                errorCode = res.locals.errorCode;
            }

            var logEntry = {
                level: level,
                requestId: requestId,
                method: req.method,
                path: req.baseUrl ? (req.baseUrl + req.path) : req.path,
                status: status,
                durationMs: Math.round(durationMs * 100) / 100
            };

            if (userId) logEntry.userId = userId;
            if (errorCode) logEntry.errorCode = errorCode;

            write(logEntry);
        });

        next();
    }

    return {
        middleware: middleware,
        logError: logError,
        write: write,
        sanitizeObject: sanitizeObject
    };
}

var defaultLogger = createLogger();

module.exports = {
    createLogger: createLogger,
    generateRequestId: generateRequestId,
    sanitizeObject: sanitizeObject,
    defaultLogger: defaultLogger,
    middleware: defaultLogger.middleware,
    logError: defaultLogger.logError
};
