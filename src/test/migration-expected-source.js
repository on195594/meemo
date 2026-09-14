'use strict';

var crypto = require('crypto'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    EJSON = require('mongodb').BSON.EJSON;

function sortFields(value) {
    if (Array.isArray(value)) return value.map(sortFields);
    if (!value || typeof value !== 'object') return value;
    if (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) return value;
    var sorted = {};
    Object.keys(value).sort().forEach(function (key) { sorted[key] = sortFields(value[key]); });
    return sorted;
}

function canonicalJson(value) {
    return EJSON.stringify(sortFields(value), { relaxed: false });
}

function fingerprint(records) {
    records = records.slice().sort(function (left, right) {
        var leftRecord = canonicalJson(left);
        var rightRecord = canonicalJson(right);
        return leftRecord < rightRecord ? -1 : (leftRecord > rightRecord ? 1 : 0);
    });
    return crypto.createHash('sha256').update(canonicalJson(records)).digest('hex');
}

function expectedSource(namespaceDocuments, ownerMapDigest, database) {
    return {
        version: 2,
        migration: 'schema-v2',
        database: database,
        ownerMapDigest: ownerMapDigest || 'no-owner-map',
        namespaces: Object.keys(namespaceDocuments).sort().map(function (name) {
            var documents = namespaceDocuments[name];
            return { name: name, count: documents.length, fingerprint: fingerprint(documents) };
        })
    };
}

function digest(expectation) {
    return fingerprint([expectation]);
}

function writeArtifact(expectation) {
    var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-expected-source-'));
    var artifactPath = path.join(directory, 'source.json');
    fs.writeFileSync(artifactPath, JSON.stringify(expectation), { mode: 0o600 });
    fs.chmodSync(artifactPath, 0o400);
    return artifactPath;
}

function removeArtifact(artifactPath) {
    if (artifactPath) fs.rmSync(path.dirname(artifactPath), { recursive: true, force: true });
}

module.exports = {
    expectedSource: expectedSource,
    digest: digest,
    writeArtifact: writeArtifact,
    removeArtifact: removeArtifact
};
