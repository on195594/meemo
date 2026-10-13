'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    fs = require('fs'),
    path = require('path');

describe('Service layer boundaries (RF-303)', function () {
    it('keeps database and filesystem dependencies out of HTTP routes', function () {
        var routesDirectory = path.join(__dirname, '../http/routes');

        fs.readdirSync(routesDirectory).forEach(function (file) {
            var source = fs.readFileSync(path.join(routesDirectory, file), 'utf8');
            expect(source).not.to.match(/require\(['"]fs['"]\)/);
            expect(source).not.to.match(/require\(['"].*database\//);
            expect(source).not.to.match(/require\(['"].*users\.js/);
        });
    });
});
