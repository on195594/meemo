'use strict';

var HttpError = require('../responses.js').HttpError;

function auth(req, res, next) {
    if (!req.session || (!req.session.username && !req.session.userId)) {
        return next(new HttpError(401, 'Unauthorized', 'authentication_required'));
    }

    var userId = req.session.userId || req.session.username;
    var username = req.session.username || req.session.userId;

    req.user = {
        id: String(userId),
        username: String(username)
    };
    next();
}

module.exports = auth;
