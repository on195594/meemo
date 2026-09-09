/* jslint node:true */

'use strict';

exports = module.exports = {
    auth,
    login,
    logout,
    register,
    profile,
    getAll,
    get,
    add,
    put,
    del,
    getTags,
    settingsSave,
    settingsGet,
    exportThings,
    importThings,
    healthcheck,
    healthLive,
    healthReady,
    fileAdd,
    fileGet,
    detectImageType,
    HttpError: HttpError,

    public: {
        users: publicUsers,
        profile: publicProfile,
        getAll: publicGetAll,
        getThing: publicGetThing,
        getFile: publicGetFile,
        getRSS: publicGetRSS,
        streamPage: publicStreamPage
    }
};

var assert = require('assert'),
    config = require('./config.js'),
    crypto = require('crypto'),
    fs = require('fs'),
    logic = require('./logic.js'),
    mkdirp = require('mkdirp'),
    ObjectId = require('mongodb').ObjectId,
    path = require('path'),
    rss = require('rss'),
    settings = require('./database/settings.js'),
    tags = require('./database/tags.js'),
    tar = require('tar-fs'),
    users = require('./users.js'),
    UserError = users.UserError,
    HttpError = require('connect-lastmile').HttpError,
    HttpSuccess = require('connect-lastmile').HttpSuccess;

function healthLive(req, res, next) {
    next(new HttpSuccess(200, { status: 'ok' }));
}

function healthReady(req, res, next) {
    if (!config.db) {
        return next(new HttpError(503, 'Database not connected'));
    }

    config.db.command({ ping: 1 }, function (err) {
        if (err) return next(new HttpError(503, 'Database ping failed: ' + (err.message || err)));

        try {
            mkdirp.sync(config.attachmentDir);
            fs.accessSync(config.attachmentDir, fs.constants.R_OK | fs.constants.W_OK);
            next(new HttpSuccess(200, { status: 'ready' }));
        } catch (storageErr) {
            return next(new HttpError(503, 'Attachment directory not accessible: ' + storageErr.message));
        }
    });
}

function healthcheck(req, res, next) {
    res.setHeader('X-Deprecated', '/api/healthcheck is deprecated, use /api/health/live or /api/health/ready');
    next(new HttpSuccess(200, {}));
}

function auth(req, res, next) {
    if (!req.session || (!req.session.username && !req.session.userId)) {
        return next(new HttpError(401, 'Unauthorized'));
    }

    var userId = req.session.userId || req.session.username;
    var username = req.session.username || req.session.userId;

    req.user = {
        id: String(userId),
        username: String(username)
    };
    next();
}

var g_loginAttempts = {};

function checkLoginRateLimit(ip) {
    var now = Date.now();
    var windowMs = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 60000;
    var maxAttempts = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10;

    var record = g_loginAttempts[ip];
    if (!record || now > record.resetAt) {
        g_loginAttempts[ip] = { count: 1, resetAt: now + windowMs };
        return true;
    }

    record.count++;
    if (record.count > maxAttempts) {
        return false;
    }
    return true;
}

function resetLoginRateLimit(ip) {
    delete g_loginAttempts[ip];
}

function login(req, res, next) {
    if (!req.body || typeof req.body.username !== 'string' || typeof req.body.password !== 'string') {
        return next(new HttpError(400, 'missing username or password'));
    }

    var clientIp = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    if (!checkLoginRateLimit(clientIp)) {
        return next(new HttpError(429, 'Too many login attempts. Please try again later.'));
    }

    var username = req.body.username.trim().toLowerCase();
    var password = req.body.password;

    users.verify(username, password, function (error, user) {
        if (error && (error.code === UserError.NOT_FOUND || error.code === UserError.NOT_AUTHORIZED)) {
            return next(new HttpError(401, 'Invalid username or password'));
        }
        if (error) return next(new HttpError(500, error));

        resetLoginRateLimit(clientIp);

        var stableUserId = (user && (user.id || user._id)) ? String(user.id || user._id) : username;
        var canonicalUsername = (user && user.username) ? user.username : username;

        if (req.session && typeof req.session.regenerate === 'function') {
            req.session.regenerate(function (regenErr) {
                if (regenErr) return next(new HttpError(500, regenErr));
                req.session.userId = stableUserId;
                req.session.username = canonicalUsername;
                next(new HttpSuccess(200, {}));
            });
        } else {
            req.session.userId = stableUserId;
            req.session.username = canonicalUsername;
            next(new HttpSuccess(200, {}));
        }
    });
}

function logout(req, res, next) {
    if (!req.session) return next(new HttpSuccess(200, {}));

    req.session.destroy(function(err) {
        if (err) return next(new HttpError(500, err));
        res.clearCookie('connect.sid');
        next(new HttpSuccess(200, {}));
    });
}

function register(req, res, next) {
    var username = req.body.username;
    var password = req.body.password;
    var email = req.body.email;
    var displayName = req.body.displayName;

    if (typeof username !== 'string' || typeof password !== 'string' || typeof email !== 'string' || typeof displayName !== 'string') {
        return next(new HttpError(400, 'missing username, password, email or displayName'));
    }

    username = username.trim().toLowerCase();
    if (!/^[a-z0-9_\-]{3,32}$/.test(username)) {
        return next(new HttpError(400, 'username must be 3-32 characters and contain only letters, numbers, underscores, and hyphens'));
    }

    if (password.length < 8 || password.length > 128) {
        return next(new HttpError(400, 'password must be between 8 and 128 characters'));
    }

    email = email.trim();
    if (email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return next(new HttpError(400, 'invalid email address'));
    }

    displayName = displayName.trim();
    if (displayName.length < 1 || displayName.length > 64) {
        return next(new HttpError(400, 'displayName must be between 1 and 64 characters'));
    }

    var registrationMode = process.env.REGISTRATION_MODE || (process.env.NODE_ENV === 'production' ? 'first-user' : 'open');

    if (registrationMode === 'disabled') {
        return next(new HttpError(403, 'Registration is disabled'));
    }

    function doCreate() {
        users.create(username, email, displayName, password, function (error) {
            if (error && error.code === 'user exists') return next(new HttpError(409, error.message));
            if (error) return next(new HttpError(500, error));
            next(new HttpSuccess(201, {}));
        });
    }

    if (registrationMode === 'first-user') {
        users.count(function (error, count) {
            if (error) return next(new HttpError(500, error));
            if (count > 0) return next(new HttpError(403, 'Registration is closed (first-user only)'));
            doCreate();
        });
    } else {
        doCreate();
    }
}

function profile(req, res, next) {
    users.profile(req.user.id, false, function (error, result) {
        if (error && error.code === UserError.NOT_FOUND) return next(new HttpError(404, error.message));
        if (error) return next(new HttpError(500, error));

        var out = {
            user: result
        };

        next(new HttpSuccess(200, out));
    });
}

function getAll(req, res, next) {
    var query = { $or: [] };

    if (req.query.filter) {
        query.$or.push({
            $text: { $search: String(req.query.filter) }
        });
    } else {
        query.$or.push({ content: { $exists: true }});
    }

    if (req.query.sticky) {
        query.$or.push({ sticky: true });
    }

    var archiveQuery;
    if (req.query.archived) {
        archiveQuery = {
            archived: true
        };
    } else {
        archiveQuery = { $or: [{
            archived: false
        }, {
            archived: { $exists: false }
        }]};
    }

    var endQuery = { $and: [ archiveQuery, query ]};

    var skip = isNaN(parseInt(req.query.skip)) ? 0 : parseInt(req.query.skip);
    var limit = isNaN(parseInt(req.query.limit)) ? 10 : parseInt(req.query.limit);

    logic.getAll(req.user.id, endQuery, skip, limit, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { things: result }));
    });
}

function get(req, res, next) {
    logic.get(req.user.id, req.params.id, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { thing: result }));
    });
}

function add(req, res, next) {
    if (typeof req.body.content !== 'string' || !req.body.content) return next(new HttpError(400, 'content must be a string'));
    if (req.body.attachments && !Array.isArray(req.body.attachments)) return next(new HttpError(400, 'attachments must be an array'));

    if (!req.body.attachments) req.body.attachments = [];

    logic.add(req.user.id, req.body.content, req.body.attachments, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(201, { thing: result }));
    });
}

function put(req, res, next) {
    if (typeof req.body.content !== 'string' || !req.body.content) return next(new HttpError(400, 'content must be a string'));
    if (req.body.attachments && !Array.isArray(req.body.attachments)) return next(new HttpError(400, 'attachments must be an array'));
    if (req.body.public && typeof req.body.public !== 'boolean') return next(new HttpError(400, 'public must be a boolean'));
    if (req.body.shared && typeof req.body.shared !== 'boolean') return next(new HttpError(400, 'shared must be a boolean'));
    if (req.body.archived && typeof req.body.archived !== 'boolean') return next(new HttpError(400, 'archived must be a boolean'));
    if (req.body.sticky && typeof req.body.sticky !== 'boolean') return next(new HttpError(400, 'sticky must be a boolean'));

    if (!req.body.attachments) req.body.attachments = [];

    req.body.public = !!req.body.public;
    req.body.shared = !!req.body.shared;
    req.body.archived = !!req.body.archived;
    req.body.sticky = !!req.body.sticky;

    logic.put(req.user.id, req.params.id, req.body.content, req.body.attachments, req.body.public, req.body.shared, req.body.archived, req.body.sticky, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(201, { thing: result }));
    });
}

function del(req, res, next) {
    logic.del(req.user.id, req.params.id, function (error) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, {}));
    });
}

function getTags(req, res, next) {
    tags.get(req.user.id, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { tags: result }));
    });
}

function settingsSave(req, res, next) {
    settings.put(req.user.id, req.body.settings, function (error) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(202, {}));
    });
}

function settingsGet(req, res, next) {
    settings.get(req.user.id, function (error, result) {
        if (error) return next(new HttpError(500, error));
        next(new HttpSuccess(200, { settings: result }));
    });
}

function exportThings(req, res, next) {
    var userId = req.user.id;
    var username = req.user.username;

    // Check stable userId folder first, fallback to legacy username folder if needed
    var attachmentFolder = path.join(config.attachmentDir, userId);
    if (!fs.existsSync(attachmentFolder) && username && username !== userId && fs.existsSync(path.join(config.attachmentDir, username))) {
        attachmentFolder = path.join(config.attachmentDir, username);
    }
    mkdirp.sync(attachmentFolder);

    logic.exp(userId, function (error, result) {
        if (error && username && username !== userId) {
            return logic.exp(username, onExpResult);
        }
        onExpResult(error, result);

        function onExpResult(error, result) {
            if (error) return next(new HttpError(500, error));

            var out = tar.pack(attachmentFolder, {
                map: function (header) {
                    header.name = 'attachments/' + header.name;
                    return header;
                }
            });

            // add the db dump
            out.entry({ name: 'things.json' }, JSON.stringify(result, null, 4));

            res.attachment('meemo-export.tar');
            out.pipe(res);
        }
    });
}

function importThings(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.path) return next(new HttpError(400, 'missing file'));

    var tempFilePath = file.path;

    function cleanupTemp() {
        if (fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
        }
    }

    logic.importThings(req.user.id, tempFilePath, function (error, stats) {
        cleanupTemp();

        if (error) return next(new HttpError(400, typeof error === 'string' ? error : (error.message || 'Import failed')));

        next(new HttpSuccess(200, stats || {}));
    });
}

function detectImageType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'image/png';
    }
    // GIF: GIF87a or GIF89a (47 49 46 38)
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
        return 'image/gif';
    }
    // WEBP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'image/webp';
    }
    return null;
}

function getSafeExtension(detectedType) {
    if (detectedType === 'image/jpeg') return '.jpg';
    if (detectedType === 'image/png') return '.png';
    if (detectedType === 'image/gif') return '.gif';
    if (detectedType === 'image/webp') return '.webp';
    return '.bin';
}

function fileAdd(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.buffer) return next(new HttpError(400, 'missing file'));

    var detectedType = detectImageType(file.buffer);
    var isImage = Boolean(detectedType && file.mimetype && file.mimetype.indexOf('image/') === 0);
    var type = isImage ? logic.TYPE_IMAGE : logic.TYPE_UNKNOWN;

    // Server-generated opaque UUID storage key - original filename never participates in storage path
    var safeExt = getSafeExtension(detectedType);
    var storageKey = crypto.randomUUID() + safeExt;

    var attachmentFolder = path.join(config.attachmentDir, req.user.id);
    mkdirp.sync(attachmentFolder);

    var targetFilePath = path.join(attachmentFolder, storageKey);

    fs.writeFile(targetFilePath, file.buffer, function (error) {
        if (error) {
            fs.unlink(targetFilePath, function () {});
            return next(new HttpError(500, error));
        }

        // Sanitized original filename for display only
        var displayName = path.basename(file.originalname || 'attachment');

        next(new HttpSuccess(201, {
            identifier: storageKey,
            fileName: displayName,
            type: type
        }));
    });
}

function isSafePathSegment(segment) {
    if (typeof segment !== 'string' || !segment) return false;
    if (path.basename(segment) !== segment) return false;
    if (segment === '.' || segment === '..') return false;
    return true;
}

function fileGet(req, res, next) {
    var rawUserId = req.params.userId;
    var thingId = req.params.thingId;
    var identifier = req.params.identifier;

    if (!isSafePathSegment(rawUserId) || !isSafePathSegment(identifier)) {
        return next(new HttpError(400, 'invalid parameters'));
    }

    if (!ObjectId.isValid(thingId)) {
        return next(new HttpError(404, 'not found'));
    }

    users.resolveUser(rawUserId, function (resolveErr, targetUser) {
        if (resolveErr && resolveErr.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, resolveErr));

        var targetUserId = targetUser ? targetUser.id : rawUserId;
        var targetUsername = targetUser ? targetUser.username : rawUserId;

        logic.get(targetUserId, thingId, function (error, thing) {
            if (error && error.message === 'not found' && targetUsername && targetUsername !== targetUserId) {
                return logic.get(targetUsername, thingId, onGotThing);
            }
            onGotThing(error, thing);

            function onGotThing(error, thing) {
                if (error) {
                    if (error.message === 'not found') return next(new HttpError(404, 'not found'));
                    return next(new HttpError(500, error));
                }

                if (!thing) {
                    return next(new HttpError(404, 'not found'));
                }

                var attachments = Array.isArray(thing.attachments) ? thing.attachments : [];
                var attachment = attachments.find(function (att) {
                    return att && att.identifier === identifier;
                });

                if (!attachment) {
                    return next(new HttpError(404, 'attachment not found'));
                }

                var isOwner = req.session && (
                    (req.session.userId && (req.session.userId === targetUserId || req.session.userId === rawUserId)) ||
                    (req.session.username && (req.session.username === targetUsername || req.session.username === rawUserId))
                );
                var isPublicOrShared = Boolean(thing.public || thing.shared);

                if (!isOwner && !isPublicOrShared) {
                    return next(new HttpError(403, 'not allowed'));
                }

                var userRoot = path.join(config.attachmentDir, targetUserId);
                var filePath = path.join(userRoot, identifier);

                if (!fs.existsSync(filePath) && targetUsername && targetUsername !== targetUserId) {
                    var legacyRoot = path.join(config.attachmentDir, targetUsername);
                    var legacyPath = path.join(legacyRoot, identifier);
                    if (fs.existsSync(legacyPath)) {
                        userRoot = legacyRoot;
                    }
                }

                res.setHeader('X-Content-Type-Options', 'nosniff');
                if (attachment.type !== logic.TYPE_IMAGE) {
                    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(attachment.fileName || 'attachment') + '"');
                }
                res.sendFile(identifier, { root: userRoot }, function (sendError) {
                    if (sendError) {
                        if (!res.headersSent) {
                            return next(new HttpError(404, 'file not found'));
                        }
                    }
                });
            }
        });
    });
}

function publicGetThing(req, res, next) {
    users.resolveUser(req.params.userId, function (err, targetUser) {
        if (err && err.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, err));
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

function publicGetAll(req, res, next) {
    users.resolveUser(req.params.userId, function (err, targetUser) {
        if (err && err.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, err));
        var targetUserId = targetUser ? targetUser.id : req.params.userId;
        var targetUsername = targetUser ? targetUser.username : req.params.userId;

        var query = {};
        if (req.query && req.query.filter) {
            query = {
                $text: { $search: String(req.query.filter) }
            };
        }

        var skip = isNaN(parseInt(req.query.skip)) ? 0 : parseInt(req.query.skip);
        var limit = isNaN(parseInt(req.query.limit)) ? 10 : parseInt(req.query.limit);

        logic.getAllPublic(targetUserId, query, skip, limit, function (error, result) {
            if (error && targetUsername && targetUsername !== targetUserId) {
                return logic.getAllPublic(targetUsername, query, skip, limit, function (fallbackErr, fallbackResult) {
                    if (fallbackErr) return next(new HttpError(500, fallbackErr));
                    next(new HttpSuccess(200, { things: fallbackResult }));
                });
            }
            if (error) return next(new HttpError(500, error));
            next(new HttpSuccess(200, { things: result }));
        });
    });
}

function publicGetFile(req, res, next) {
    return next(new HttpError(404, 'not found'));
}

function publicUsers(req, res, next) {
    users.list(function (error, result) {
        if (error && error.code === UserError.NOT_FOUND) return next(new HttpError(404, error.message));
        if (error) return next(new HttpError(500, error));

        next(new HttpSuccess(200, { users: result }));
    });
}

function publicProfile(req, res, next) {
    users.resolveUser(req.params.userId, function (err, targetUser) {
        if (err && err.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, err));
        if (!targetUser) return next(new HttpError(404, 'not found'));

        var targetUserId = targetUser.id;
        var targetUsername = targetUser.username;

        var out = {
            id: targetUserId,
            username: targetUsername,
            displayName: targetUser.displayName
        };

        settings.get(targetUserId, function (error, result) {
            if (error && targetUsername && targetUsername !== targetUserId) {
                return settings.get(targetUsername, handleSettings);
            }
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

function publicGetRSS(req, res, next) {
    assert.strictEqual(typeof req.params.userId, 'string');

    users.resolveUser(req.params.userId, function (err, targetUser) {
        if (err && err.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, err));
        if (!targetUser) return next(new HttpError(404, 'not found'));

        var targetUserId = targetUser.id;
        var targetUsername = targetUser.username;

        settings.get(targetUserId, function (error, cfg) {
            logic.getAllPublic(targetUserId, {}, 0, 50, function (error, result) {
                if (error && targetUsername && targetUsername !== targetUserId) {
                    return logic.getAllPublic(targetUsername, {}, 0, 50, function (fallbackErr, fallbackResult) {
                        if (fallbackErr) return next(new HttpError(500, fallbackErr));
                        buildFeed(cfg, fallbackResult);
                    });
                }
                if (error) return next(new HttpError(500, error));
                buildFeed(cfg, result);

                function buildFeed(cfg, result) {
                    var webServer = process.env.APP_ORIGIN || 'http://localhost';

                    var feed = new rss({
                        title: (cfg && cfg.title) || 'Meemo',
                        image_url: webServer + '/img/logo128.png',
                        site_url: webServer
                    });

                    result.forEach(function (r) {
                        var title = r.content.split('\n').filter(function (l) { return !!l.trim(); })[0];

                        feed.item({
                            title: title,
                            url: webServer + '/blog/' + 'TODO',
                            author: targetUser.displayName + '( ' + targetUser.username + ' )',
                            date: new Date(r.createdAt),
                            description: md.render(r.richContent)
                        });
                    });

                    res.type('application/rss+xml').status(200).send(feed.xml());
                }
            });
        });
    });
}

function publicStreamPage(req, res) {
    assert.strictEqual(typeof req.params.userId, 'string');

    res.sendFile(path.resolve(__dirname, '../public/stream.html'));
}


// THIS DOES NOT BELONG HERE

function markdownTargetBlank(md) {
    // stash the default renderer
    var defaultRender = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        var href = tokens[idx].attrs[tokens[idx].attrIndex('href')][1];

        if (href.indexOf('https://') === 0 || href.indexOf('http://') === 0) {
            // in case another plugin added that attribute already
            var aIndex = tokens[idx].attrIndex('target');

            if (aIndex < 0) {
                tokens[idx].attrPush(['target', '_blank']); // add new attribute
            } else {
                tokens[idx].attrs[aIndex][1] = '_blank';    // replace value of existing attr
            }
        }

        return defaultRender(tokens, idx, options, env, self);
    };
}

function colorizeIt(md/*, options*/) {
    var regexp = /\:([#\w\-]+)\:/;

    function isColor(color) {
        // https://developer.mozilla.org/en-US/docs/Web/CSS/color_value
        var colors = [
            'clear',
            'aliceblue', 'lightsalmon', 'antiquewhite', 'lightseagreen', 'aqua', 'lightskyblue', 'aquamarine', 'lightslategray', 'azure', 'lightsteelblue', 'beige', 'lightyellow', 'bisque', 'lime', 'black', 'limegreen', 'blanchedalmond', 'linen', 'blue', 'magenta', 'blueviolet', 'maroon', 'brown', 'mediumaquamarine', 'burlywood', 'mediumblue', 'cadetblue', 'mediumorchid', 'chartreuse', 'mediumpurple', 'chocolate', 'mediumseagreen', 'coral', 'mediumslateblue', 'cornflowerblue', 'mediumspringgreen', 'cornsilk', 'mediumturquoise', 'crimson', 'mediumvioletred', 'cyan', 'midnightblue', 'darkblue', 'mintcream', 'darkcyan', 'mistyrose', 'darkgoldenrod', 'moccasin', 'darkgray', 'navajowhite', 'darkgreen', 'navy', 'darkkhaki', 'oldlace', 'darkmagenta', 'olive', 'darkolivegreen', 'olivedrab', 'darkorange', 'orange', 'darkorchid', 'orangered', 'darkred', 'orchid', 'darksalmon', 'palegoldenrod', 'darkseagreen', 'palegreen', 'darkslateblue', 'paleturquoise', 'darkslategray', 'palevioletred', 'darkturquoise', 'papayawhip', 'darkviolet', 'peachpuff', 'deeppink', 'peru', 'deepskyblue', 'pink', 'dimgray', 'plum', 'dodgerblue', 'powderblue', 'firebrick', 'purple', 'floralwhite', 'red', 'forestgreen', 'rosybrown', 'fuchsia', 'royalblue', 'gainsboro', 'saddlebrown', 'ghostwhite', 'salmon', 'gold', 'sandybrown', 'goldenrod', 'seagreen', 'gray', 'seashell', 'green', 'sienna', 'greenyellow', 'silver', 'honeydew', 'skyblue', 'hotpink', 'slateblue', 'indianred', 'slategray', 'indigo', 'snow', 'ivory', 'springgreen', 'khaki', 'steelblue', 'lavender', 'tan', 'lavenderblush', 'teal', 'lawngreen', 'thistle', 'lemonchiffon', 'tomato', 'lightblue', 'turquoise', 'lightcoral', 'violet', 'lightcyan', 'wheat', 'lightgoldenrodyellow', 'white', 'lightgreen', 'whitesmoke', 'lightgrey', 'yellow', 'lightpink', 'yellowgreen'
        ];

        if (color[0] === '#') return true;

        return colors.indexOf(color) !== -1;
    }

    md.inline.ruler.push('colorizeIt', function (state, silent) {
        // slowwww... maybe use an advanced regexp engine for this
        var match = regexp.exec(state.src.slice(state.pos));
        if (!match) return false;
        if (!isColor(match[1])) return false;

        // valid match found, now we need to advance cursor
        state.pos += match[0].length;

        // don't insert any tokens in silent mode
        if (silent) return true;

        var token = state.push('colorizeIt', '', 0);
        token.meta = { color: match[1] };

        return true;
    });

    md.renderer.rules.colorizeIt = function (tokens, id/*, options, env*/) {
        if (tokens[id].meta.color === 'clear') {
            return '</span>';
        } else {
            return '<span style="color: ' + tokens[id].meta.color + ';">';
        }
    };
}

var md = require('markdown-it')({
    breaks: true,
    html: true,
    linkify: true
})
.use(require('markdown-it-emoji'))
.use(colorizeIt)
.use(require('markdown-it-checkbox'))
.use(markdownTargetBlank);

md.renderer.rules.emoji = function(token, idx) {
    return require('twemoji').parse(token[idx].content);
};
