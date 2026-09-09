'use strict';

function nodeify(promise, callback) {
    if (typeof callback !== 'function') return promise;
    promise.then(function (result) {
        callback(null, result);
    }, callback);
}

module.exports = nodeify;
