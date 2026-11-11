'use strict';

var path = require('path');

/**
 * Validate a single local attachment path segment at HTTP, import and storage boundaries.
 * Not a validator for complete paths; invalid or non-string input returns false.
 * @param {unknown} segment
 * @returns {boolean}
 */
function isSafePathSegment(segment) {
    return typeof segment === 'string' && segment.length > 0 &&
        path.basename(segment) === segment && segment !== '.' && segment !== '..' &&
        segment.indexOf('\0') === -1;
}

module.exports = isSafePathSegment;
