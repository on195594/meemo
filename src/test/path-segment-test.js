'use strict';

/* global describe:false, it:false */

var assert = require('assert'),
    validation = require('../http/middleware/validate.js'),
    thingSchemas = require('../http/routes/things.js').schemas,
    validateImport = require('../services/import-export-service.js').validateThingsData;

describe('Attachment path segment boundaries', function () {
    ['', '.', '..', '../file', 'dir/file', '/file', 'bad\0key'].forEach(function (segment) {
        it('rejects unsafe HTTP and imported attachment identifiers: ' + JSON.stringify(segment), function () {
            assert.strictEqual(validation.safePathSegment.safeParse(segment).success, false);
            [segment, { identifier: segment }].forEach(function (attachment) {
                var body = { content: 'note', attachments: [attachment] };
                assert.strictEqual(thingSchemas.create.safeParse(body).success, false);
                assert.strictEqual(thingSchemas.update.safeParse(body).success, false);
                assert.strictEqual(typeof validateImport({ things: [body] }), 'string');
            });
        });
    });

    ['file.bin', 'uuid-key.png', '报告.pdf'].forEach(function (segment) {
        it('accepts safe HTTP and imported attachment identifiers: ' + segment, function () {
            assert.strictEqual(validation.safePathSegment.safeParse(segment).success, true);
            [segment, { identifier: segment }].forEach(function (attachment) {
                var body = { content: 'note', attachments: [attachment] };
                assert.strictEqual(thingSchemas.create.safeParse(body).success, true);
                assert.strictEqual(validateImport({ things: [body] }), null);
            });
        });
    });
});
