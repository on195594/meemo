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

async function resolve(rawUserId) {
    try {
        var user = await users.resolveUser(rawUserId);
        return { user: user, id: user.id, username: user.username };
    } catch (error) {
        if (error.code !== UserError.NOT_FOUND) throw error;
        return { user: null, id: rawUserId, username: rawUserId };
    }
}

async function getThing(rawUserId, thingId) {
    if (rawUserId === 'shared') {
        return await things.getPublicShared(thingId);
    }
    var target = await resolve(rawUserId);
    try {
        return await things.getPublic(target.id, thingId);
    } catch (error) {
        if (error && error.message === 'not found' && target.username !== target.id) {
            return things.getPublic(target.username, thingId);
        }
        throw error;
    }
}

async function getAll(rawUserId, query, skip, limit) {
    var target = await resolve(rawUserId);
    return things.getAllPublic(target.id, query, skip, limit);
}

async function listUsers() {
    return users.list();
}

async function profile(rawUserId) {
    return resolve(rawUserId).then(function (target) {
        if (!target.user) throw notFound();
        return {
            id: target.user.id,
            username: target.user.username,
            displayName: target.user.displayName
        };
    });
}

async function feed(rawUserId) {
    var target = await resolve(rawUserId);
    if (!target.user) throw notFound();
    var config = await settings.get(target.id);
    var result = await things.getAllPublic(target.id, {}, 0, 50);
    return { user: target.user, settings: config, things: result };
}

module.exports = {
    getThing: getThing,
    getAll: getAll,
    listUsers: listUsers,
    profile: profile,
    feed: feed,
    UserError: UserError
};
