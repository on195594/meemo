'use strict';

var assert = require('assert'),
    path = require('path'),
    rss = require('rss'),
    sharing = require('../../services/sharing-service.js'),
    rssRenderer = require('../../services/rss-renderer.js'),
    things = require('../../services/thing-service.js'),
    UserError = sharing.UserError,
    asyncHandler = require('../middleware/async-handler.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var userParams = z.object({ userId: validation.safePathSegment });
var thingParams = userParams.extend({ thingId: validation.objectId });
var legacyFileParams = userParams.extend({ fileId: validation.safePathSegment });
var listQuery = z.object({
    filter: z.string().max(1000).optional(),
    mode: z.enum(['regex', 'text']).optional().default('regex'),
    skip: validation.pagination.skip,
    limit: validation.pagination.limit
});

async function getThing(req, res, next) {
    try {
        var result = await sharing.getThing(req.params.userId, req.params.thingId);
        next(new HttpSuccess(200, { thing: result }));
    } catch (error) {
        if (error === 'not allowed') throw new HttpError(403, 'not allowed');
        if (error && error.message === 'not found') throw new HttpError(404, 'not found');
        throw error;
    }
}

async function getAll(req, res, next) {
    var query = things.buildSearchFilter(req.query.filter, req.query.mode) || {};
    var result = await sharing.getAll(req.params.userId, query, req.query.skip, req.query.limit);
    next(new HttpSuccess(200, { things: result }));
}

function getFile(req, res, next) {
    next(new HttpError(404, 'not found'));
}

async function listUsers(req, res, next) {
    try {
        next(new HttpSuccess(200, { users: await sharing.listUsers() }));
    } catch (error) {
        if (error.code === UserError.NOT_FOUND) throw new HttpError(404, error.message);
        throw error;
    }
}

async function profile(req, res, next) {
    try {
        next(new HttpSuccess(200, { user: await sharing.profile(req.params.userId) }));
    } catch (error) {
        if (error.message === 'not found') throw new HttpError(404, 'not found');
        throw error;
    }
}

async function getRSS(req, res) {
    assert.strictEqual(typeof req.params.userId, 'string');

    var data;
    try {
        data = await sharing.feed(req.params.userId);
    } catch (error) {
        if (error.message === 'not found') throw new HttpError(404, 'not found');
        throw error;
    }

    var webServer = (process.env.APP_ORIGIN || 'http://localhost').replace(/\/+$/, '');
    var feed = new rss({
        title: (data.settings && data.settings.title) || 'Meemo',
        image_url: webServer + '/favicon.png',
        site_url: webServer
    });

    data.things.forEach(function (thing) {
        var content = thing.content || '';
        var title = content.split('\n').filter(function (line) { return !!line.trim(); })[0] || 'Untitled note';
        var itemUrl = webServer + '/shared/' + thing._id;
        var renderedDescription = rssRenderer.renderFeedHtml(thing.richContent || content, webServer);

        feed.item({
            title: title,
            url: itemUrl,
            guid: itemUrl,
            author: data.user.displayName + ' (' + data.user.username + ')',
            date: new Date(thing.createdAt),
            description: renderedDescription
        });
    });

    res.type('application/rss+xml').status(200).send(feed.xml());
}

function streamPage(req, res, next) {
    var indexPath = path.resolve(__dirname, '../../../public/index.html');
    res.sendFile(indexPath, function (err) {
        if (err) {
            if (err.code === 'ENOENT') {
                return res.status(200).send('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
            }
            if (next) return next(err);
            res.status(500).end();
        }
    });
}

function registerRoutes(router) {
    router.get('/api/public/:userId/files/:fileId', validate({ params: legacyFileParams }), getFile);
    router.get('/api/public/:userId/things', validate({ params: userParams, query: listQuery }), asyncHandler(getAll));
    router.get('/api/public/:userId/things/:thingId', validate({ params: thingParams }), asyncHandler(getThing));
    router.get('/api/rss/:userId', validate({ params: userParams }), asyncHandler(getRSS));
    router.get('/api/users', asyncHandler(listUsers));
    router.get('/api/users/:userId', validate({ params: userParams }), asyncHandler(profile));
    router.get('/public/:userId', validate({ params: userParams }), streamPage);
}

module.exports = {
    registerRoutes: registerRoutes,
    users: listUsers,
    profile: profile,
    getAll: getAll,
    getThing: getThing
};
