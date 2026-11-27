'use strict';

var HttpError = require('../responses.js').HttpError;

function auth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return next(new HttpError(401, 'Unauthorized', 'authentication_required'));
    }

    var userId = String(req.session.userId);
    req.user = {
        id: userId,
        username: String(req.session.username || userId)
    };
    next();
}

module.exports = auth;
