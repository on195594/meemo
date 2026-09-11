'use strict';

var expect = require('expect.js'),
    fs = require('fs'),
    module_ = require('module'),
    path = require('path');

function packageName(specifier) {
    return specifier[0] === '@'
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
}

describe('Test dependency declarations (RF-701)', function () {
    it('declares every package imported directly by backend tests', function () {
        var root = path.resolve(__dirname, '../..'),
            packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
            declared = Object.assign({}, packageJson.dependencies, packageJson.devDependencies),
            builtins = new Set(module_.builtinModules.concat(module_.builtinModules.map(function (name) {
                return 'node:' + name;
            }))),
            missing = [];

        fs.readdirSync(__dirname)
            .filter(function (file) { return /-test\.js$/.test(file); })
            .forEach(function (file) {
                var source = fs.readFileSync(path.join(__dirname, file), 'utf8'),
                    imports = source.matchAll(/(?:require\(\s*|from\s+)["']([^"']+)["']/g);

                Array.from(imports).forEach(function (match) {
                    var specifier = match[1],
                        dependency;

                    if (specifier[0] === '.' || specifier[0] === '/' || builtins.has(specifier)) {
                        return;
                    }

                    dependency = packageName(specifier);
                    if (!declared[dependency]) {
                        missing.push(file + ': ' + dependency);
                    }
                });
            });

        expect(missing).to.eql([]);
    });
});
