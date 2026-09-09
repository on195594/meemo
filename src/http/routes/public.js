'use strict';

var assert = require('assert'),
    logic = require('../../logic.js'),
    path = require('path'),
    rss = require('rss'),
    settings = require('../../database/settings.js'),
    users = require('../../users.js'),
    UserError = users.UserError,
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
    skip: validation.pagination.skip,
    limit: validation.pagination.limit
});

function getThing(req, res, next) {
    users.resolveUser(req.params.userId, function (error, targetUser) {
        if (error && error.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, error));
        var targetUserId = targetUser ? targetUser.id : req.params.userId;
        var targetUsername = targetUser ? targetUser.username : req.params.userId;

        logic.getPublic(targetUserId, req.params.thingId, function (error, result) {
            if (error && error.message === 'not found' && targetUsername && targetUsername !== targetUserId) {
                return logic.getPublic(targetUsername, req.params.thingId, handleResult);
            }
            handleResult(error, result);

            function handleResult(error, result) {
                if (error === 'not allowed') return next(new HttpError(403, 'not allowed'));
                if (error && error.message === 'not found') return next(new HttpError(404, 'not found'));
                if (error) return next(new HttpError(500, error));
                next(new HttpSuccess(200, { thing: result }));
            }
        });
    });
}

function getAll(req, res, next) {
    users.resolveUser(req.params.userId, function (error, targetUser) {
        if (error && error.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, error));
        var targetUserId = targetUser ? targetUser.id : req.params.userId;
        var targetUsername = targetUser ? targetUser.username : req.params.userId;
        var query = req.query.filter ? { $text: { $search: req.query.filter } } : {};

        logic.getAllPublic(targetUserId, query, req.query.skip, req.query.limit, function (error, result) {
            if (error && targetUsername && targetUsername !== targetUserId) {
                return logic.getAllPublic(targetUsername, query, req.query.skip, req.query.limit, function (fallbackError, fallbackResult) {
                    if (fallbackError) return next(new HttpError(500, fallbackError));
                    next(new HttpSuccess(200, { things: fallbackResult }));
                });
            }
            if (error) return next(new HttpError(500, error));
            next(new HttpSuccess(200, { things: result }));
        });
    });
}

function getFile(req, res, next) {
    next(new HttpError(404, 'not found'));
}

function listUsers(req, res, next) {
    users.list(function (error, result) {
        if (error && error.code === UserError.NOT_FOUND) return next(new HttpError(404, error.message));
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { users: result }));
    });
}

function profile(req, res, next) {
    users.resolveUser(req.params.userId, function (error, targetUser) {
        if (error && error.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, error));
        if (!targetUser) return next(new HttpError(404, 'not found'));

        var out = {
            id: targetUser.id,
            username: targetUser.username,
            displayName: targetUser.displayName
        };

        settings.get(targetUser.id, function (error, result) {
            if (error && targetUser.username !== targetUser.id) return settings.get(targetUser.username, handleSettings);
            handleSettings(error, result);

            function handleSettings(error, result) {
                if (error) return next(new HttpError(500, error));
                out.title = result.title;
                out.backgroundImageDataUrl = result.publicBackground ? result.backgroundImageDataUrl : undefined;
                next(new HttpSuccess(200, out));
            }
        });
    });
}

function getRSS(req, res, next) {
    assert.strictEqual(typeof req.params.userId, 'string');

    users.resolveUser(req.params.userId, function (error, targetUser) {
        if (error && error.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, error));
        if (!targetUser) return next(new HttpError(404, 'not found'));

        settings.get(targetUser.id, function (settingsError, cfg) {
            if (settingsError) return next(new HttpError(500, settingsError));

            logic.getAllPublic(targetUser.id, {}, 0, 50, function (error, result) {
                if (error && targetUser.username !== targetUser.id) {
                    return logic.getAllPublic(targetUser.username, {}, 0, 50, function (fallbackError, fallbackResult) {
                        if (fallbackError) return next(new HttpError(500, fallbackError));
                        buildFeed(cfg, fallbackResult);
                    });
                }
                if (error) return next(new HttpError(500, error));
                buildFeed(cfg, result);
            });
        });

        function buildFeed(cfg, result) {
            var webServer = process.env.APP_ORIGIN || 'http://localhost';
            var feed = new rss({
                title: (cfg && cfg.title) || 'Meemo',
                image_url: webServer + '/img/logo128.png',
                site_url: webServer
            });

            result.forEach(function (thing) {
                var title = thing.content.split('\n').filter(function (line) { return !!line.trim(); })[0];
                feed.item({
                    title: title,
                    url: webServer + '/blog/TODO',
                    author: targetUser.displayName + '( ' + targetUser.username + ' )',
                    date: new Date(thing.createdAt),
                    description: markdown.render(thing.richContent)
                });
            });

            res.type('application/rss+xml').status(200).send(feed.xml());
        }
    });
}

function streamPage(req, res) {
    res.sendFile(path.resolve(__dirname, '../../../public/stream.html'));
}

function markdownTargetBlank(md) {
    var defaultRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        var href = tokens[idx].attrs[tokens[idx].attrIndex('href')][1];
        if (href.indexOf('https://') === 0 || href.indexOf('http://') === 0) {
            var targetIndex = tokens[idx].attrIndex('target');
            if (targetIndex < 0) tokens[idx].attrPush(['target', '_blank']);
            else tokens[idx].attrs[targetIndex][1] = '_blank';
        }
        return defaultRender(tokens, idx, options, env, self);
    };
}

function colorizeIt(md) {
    var regexp = /\:([#\w\-]+)\:/;
    var colors = [
        'clear', 'aliceblue', 'lightsalmon', 'antiquewhite', 'lightseagreen', 'aqua', 'lightskyblue', 'aquamarine', 'lightslategray', 'azure', 'lightsteelblue', 'beige', 'lightyellow', 'bisque', 'lime', 'black', 'limegreen', 'blanchedalmond', 'linen', 'blue', 'magenta', 'blueviolet', 'maroon', 'brown', 'mediumaquamarine', 'burlywood', 'mediumblue', 'cadetblue', 'mediumorchid', 'chartreuse', 'mediumpurple', 'chocolate', 'mediumseagreen', 'coral', 'mediumslateblue', 'cornflowerblue', 'mediumspringgreen', 'cornsilk', 'mediumturquoise', 'crimson', 'mediumvioletred', 'cyan', 'midnightblue', 'darkblue', 'mintcream', 'darkcyan', 'mistyrose', 'darkgoldenrod', 'moccasin', 'darkgray', 'navajowhite', 'darkgreen', 'navy', 'darkkhaki', 'oldlace', 'darkmagenta', 'olive', 'darkolivegreen', 'olivedrab', 'darkorange', 'orange', 'darkorchid', 'orangered', 'darkred', 'orchid', 'darksalmon', 'palegoldenrod', 'darkseagreen', 'palegreen', 'darkslateblue', 'paleturquoise', 'darkslategray', 'palevioletred', 'darkturquoise', 'papayawhip', 'darkviolet', 'peachpuff', 'deeppink', 'peru', 'deepskyblue', 'pink', 'dimgray', 'plum', 'dodgerblue', 'powderblue', 'firebrick', 'purple', 'floralwhite', 'red', 'forestgreen', 'rosybrown', 'fuchsia', 'royalblue', 'gainsboro', 'saddlebrown', 'ghostwhite', 'salmon', 'gold', 'sandybrown', 'goldenrod', 'seagreen', 'gray', 'seashell', 'green', 'sienna', 'greenyellow', 'silver', 'honeydew', 'skyblue', 'hotpink', 'slateblue', 'indianred', 'slategray', 'indigo', 'snow', 'ivory', 'springgreen', 'khaki', 'steelblue', 'lavender', 'tan', 'lavenderblush', 'teal', 'lawngreen', 'thistle', 'lemonchiffon', 'tomato', 'lightblue', 'turquoise', 'lightcoral', 'violet', 'lightcyan', 'wheat', 'lightgoldenrodyellow', 'white', 'lightgreen', 'whitesmoke', 'lightgrey', 'yellow', 'lightpink', 'yellowgreen'
    ];

    md.inline.ruler.push('colorizeIt', function (state, silent) {
        var match = regexp.exec(state.src.slice(state.pos));
        if (!match || (match[1][0] !== '#' && colors.indexOf(match[1]) === -1)) return false;
        state.pos += match[0].length;
        if (silent) return true;
        var token = state.push('colorizeIt', '', 0);
        token.meta = { color: match[1] };
        return true;
    });

    md.renderer.rules.colorizeIt = function (tokens, id) {
        if (tokens[id].meta.color === 'clear') return '</span>';
        return '<span style="color: ' + tokens[id].meta.color + ';">';
    };
}

var markdown = require('markdown-it')({ breaks: true, html: true, linkify: true })
    .use(require('markdown-it-emoji'))
    .use(colorizeIt)
    .use(require('markdown-it-checkbox'))
    .use(markdownTargetBlank);

markdown.renderer.rules.emoji = function (token, idx) {
    return require('twemoji').parse(token[idx].content);
};

function registerRoutes(router) {
    router.get('/api/public/:userId/files/:fileId', validate({ params: legacyFileParams }), getFile);
    router.get('/api/public/:userId/things', validate({ params: userParams, query: listQuery }), getAll);
    router.get('/api/public/:userId/things/:thingId', validate({ params: thingParams }), getThing);
    router.get('/api/rss/:userId', validate({ params: userParams }), getRSS);
    router.get('/api/users', listUsers);
    router.get('/api/users/:userId', validate({ params: userParams }), profile);
    router.get('/public/:userId', validate({ params: userParams }), streamPage);
}

module.exports = {
    registerRoutes: registerRoutes,
    users: listUsers,
    profile: profile,
    getAll: getAll,
    getThing: getThing,
    getFile: getFile,
    getRSS: getRSS,
    streamPage: streamPage
};
