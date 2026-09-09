'use strict';

var assert = require('assert'),
    path = require('path'),
    rss = require('rss'),
    sharing = require('../../services/sharing-service.js'),
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
    var query = req.query.filter ? { $text: { $search: req.query.filter } } : {};
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
        next(new HttpSuccess(200, await sharing.profile(req.params.userId)));
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

    var webServer = process.env.APP_ORIGIN || 'http://localhost';
    var feed = new rss({
        title: (data.settings && data.settings.title) || 'Meemo',
        image_url: webServer + '/img/logo128.png',
        site_url: webServer
    });

    data.things.forEach(function (thing) {
        var title = thing.content.split('\n').filter(function (line) { return !!line.trim(); })[0];
        feed.item({
            title: title,
            url: webServer + '/blog/TODO',
            author: data.user.displayName + '( ' + data.user.username + ' )',
            date: new Date(thing.createdAt),
            description: markdown.render(thing.richContent)
        });
    });

    res.type('application/rss+xml').status(200).send(feed.xml());
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
    getThing: getThing,
    getFile: getFile,
    getRSS: getRSS,
    streamPage: streamPage
};
