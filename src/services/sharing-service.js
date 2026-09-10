'use strict';

var nodeify = require('../promise.js'),
    settings = require('./settings-service.js'),
    things = require('./thing-service.js'),
    users = require('../users.js'),
    UserError = users.UserError;

function notFound() {
    var error = new Error('not found');
    error.code = 'not_found';
    return error;
}

async function resolve(rawUserId) {
    try {
        var user = await users.resolveUser(rawUserId);
        return { user: user, id: user.id, username: user.username };
    } catch (error) {
        if (error.code !== UserError.NOT_FOUND) throw error;
        return { user: null, id: rawUserId, username: rawUserId };
    }
}

function getThing(rawUserId, thingId, callback) {
    var promise = resolve(rawUserId).then(async function (target) {
        try {
            return await things.getPublic(target.id, thingId);
        } catch (error) {
            if (error && error.message === 'not found' && target.username !== target.id) {
                return things.getPublic(target.username, thingId);
            }
            throw error;
        }
    });
    return nodeify(promise, callback);
}

function getAll(rawUserId, query, skip, limit, callback) {
    var promise = resolve(rawUserId).then(async function (target) {
        try {
            return await things.getAllPublic(target.id, query, skip, limit);
        } catch (error) {
            if (target.username !== target.id) return things.getAllPublic(target.username, query, skip, limit);
            throw error;
        }
    });
    return nodeify(promise, callback);
}

function listUsers(callback) {
    return nodeify(users.list(), callback);
}

function profile(rawUserId, callback) {
    var promise = resolve(rawUserId).then(function (target) {
        if (!target.user) throw notFound();
        return {
            id: target.user.id,
            username: target.user.username,
            displayName: target.user.displayName
        };
    });
    return nodeify(promise, callback);
}

function feed(rawUserId, callback) {
    var promise = resolve(rawUserId).then(async function (target) {
        if (!target.user) throw notFound();
        var config = await settings.get(target.id);
        var result;
        try {
            result = await things.getAllPublic(target.id, {}, 0, 50);
        } catch (error) {
            if (target.username === target.id) throw error;
            result = await things.getAllPublic(target.username, {}, 0, 50);
        }
        return { user: target.user, settings: config, things: result };
    });
    return nodeify(promise, callback);
}

module.exports = {
    getThing: getThing,
    getAll: getAll,
    listUsers: listUsers,
    profile: profile,
    feed: feed,
    UserError: UserError
};
