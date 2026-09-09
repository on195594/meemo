'use strict';

var settings = require('./settings-service.js'),
    things = require('./thing-service.js'),
    users = require('../users.js'),
    UserError = users.UserError;

function notFound() {
    var error = new Error('not found');
    error.code = 'not_found';
    return error;
}

function resolve(rawUserId, callback) {
    users.resolveUser(rawUserId, function (error, user) {
        if (error && error.code !== UserError.NOT_FOUND) return callback(error);
        callback(null, user, user ? user.id : rawUserId, user ? user.username : rawUserId);
    });
}

function getThing(rawUserId, thingId, callback) {
    resolve(rawUserId, function (error, user, userId, username) {
        if (error) return callback(error);

        things.getPublic(userId, thingId, function (error, result) {
            if (error && error.message === 'not found' && username !== userId) {
                return things.getPublic(username, thingId, callback);
            }
            callback(error, result);
        });
    });
}

function getAll(rawUserId, query, skip, limit, callback) {
    resolve(rawUserId, function (error, user, userId, username) {
        if (error) return callback(error);

        things.getAllPublic(userId, query, skip, limit, function (error, result) {
            if (error && username !== userId) return things.getAllPublic(username, query, skip, limit, callback);
            callback(error, result);
        });
    });
}

function listUsers(callback) {
    users.list(callback);
}

function profile(rawUserId, callback) {
    resolve(rawUserId, function (error, user) {
        if (error) return callback(error);
        if (!user) return callback(notFound());

        settings.get(user.id, function (error, result) {
            if (error && user.username !== user.id) return settings.get(user.username, handleSettings);
            handleSettings(error, result);

            function handleSettings(error, result) {
                if (error) return callback(error);
                callback(null, {
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    title: result.title,
                    backgroundImageDataUrl: result.publicBackground ? result.backgroundImageDataUrl : undefined
                });
            }
        });
    });
}

function feed(rawUserId, callback) {
    resolve(rawUserId, function (error, user) {
        if (error) return callback(error);
        if (!user) return callback(notFound());

        settings.get(user.id, function (error, config) {
            if (error) return callback(error);
            things.getAllPublic(user.id, {}, 0, 50, function (error, result) {
                if (error && user.username !== user.id) {
                    return things.getAllPublic(user.username, {}, 0, 50, function (fallbackError, fallbackResult) {
                        if (fallbackError) return callback(fallbackError);
                        callback(null, { user: user, settings: config, things: fallbackResult });
                    });
                }
                if (error) return callback(error);
                callback(null, { user: user, settings: config, things: result });
            });
        });
    });
}

module.exports = {
    getThing: getThing,
    getAll: getAll,
    listUsers: listUsers,
    profile: profile,
    feed: feed,
    UserError: UserError
};
