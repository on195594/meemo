'use strict';

var config = require('../config.js');

// These collections contain credentials or consent data; never expose raw documents.
function createRepository() {
    var indexedDb;
    var ready;

    async function collection(name) {
        var db = config.db;
        if (!db) throw new Error('Database unavailable');
        if (indexedDb !== db) {
            indexedDb = db;
            ready = Promise.all(['clients', 'requests', 'codes', 'grants', 'tokens'].map(function (suffix) {
                return db.collection('mcp_' + suffix).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
            }).concat([
                db.collection('mcp_grants').createIndex({ userId: 1, createdAt: -1, _id: -1 }),
                db.collection('mcp_requests').createIndex({ clientId: 1, expiresAt: 1 })
            ])).catch(function (error) {
                indexedDb = undefined;
                throw error;
            });
        }
        await ready;
        return db.collection('mcp_' + name);
    }

    return {
        insert: async function (name, doc) {
            await (await collection(name)).insertOne(doc);
            return doc;
        },
        get: async function (name, id) {
            return (await collection(name)).findOne({ _id: id, expiresAt: { $gt: new Date() } }, { maxTimeMS: 3000 });
        },
        count: async function (name, query) {
            return (await collection(name)).countDocuments(Object.assign({}, query, { expiresAt: { $gt: new Date() } }), { maxTimeMS: 3000 });
        },
        claimRequest: async function (id, userId) {
            return (await collection('requests')).findOneAndUpdate({
                _id: id, expiresAt: { $gt: new Date() }, $or: [{ userId: { $exists: false } }, { userId: userId }]
            }, { $set: { userId: userId } }, { returnDocument: 'after', includeResultMetadata: false, maxTimeMS: 3000 });
        },
        consume: async function (name, query) {
            return (await collection(name)).findOneAndDelete(Object.assign({}, query, { expiresAt: { $gt: new Date() } }), { maxTimeMS: 3000 });
        },
        listGrants: async function (userId) {
            return (await collection('grants')).find({ userId: userId, revoked: { $ne: true }, expiresAt: { $gt: new Date() } })
                .sort({ createdAt: -1, _id: -1 }).limit(50).maxTimeMS(3000).toArray();
        },
        revokeGrant: async function (userId, grantId) {
            await (await collection('grants')).updateOne({ _id: grantId, userId: userId }, { $set: { revoked: true } });
        },
        revokeToken: async function (clientId, tokenHash) {
            await (await collection('tokens')).deleteOne({ _id: tokenHash, clientId: clientId });
        }
    };
}

module.exports = createRepository;
