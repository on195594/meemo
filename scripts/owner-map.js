'use strict';

var crypto = require('crypto'),
    fs = require('fs');

var NO_OWNER_MAP = 'no-owner-map';

function load(filePath) {
    if (!filePath) {
        return { map: Object.create(null), digest: NO_OWNER_MAP, count: 0 };
    }

    var raw;
    var parsed;
    try {
        raw = fs.readFileSync(filePath);
    } catch (ignore) {
        throw new Error('Owner map could not be read');
    }
    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch (ignore) {
        throw new Error('Owner map must contain valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
            Object.getPrototypeOf(parsed) !== Object.prototype) {
        throw new Error('Owner map must contain a plain JSON object');
    }

    var map = Object.create(null);
    Object.keys(parsed).forEach(function (prefix) {
        if (typeof prefix !== 'string' || !prefix.trim() ||
                typeof parsed[prefix] !== 'string' || !parsed[prefix].trim()) {
            throw new Error('Owner map keys and values must be nonempty strings');
        }
        map[prefix] = parsed[prefix];
    });
    return {
        map: map,
        digest: crypto.createHash('sha256').update(raw).digest('hex'),
        count: Object.keys(map).length
    };
}

function validatePrefixes(ownerMap, prefixes) {
    var known = Object.create(null);
    prefixes.forEach(function (prefix) { known[prefix] = true; });
    var extras = Object.keys(ownerMap).filter(function (prefix) { return !known[prefix]; });
    if (extras.length) throw new Error('Owner map contains ' + extras.length + ' unknown legacy prefix(es)');
}

function has(ownerMap, prefix) {
    return Object.prototype.hasOwnProperty.call(ownerMap, prefix);
}

module.exports = {
    NO_OWNER_MAP: NO_OWNER_MAP,
    load: load,
    validatePrefixes: validatePrefixes,
    has: has
};
