'use strict';

/* global it:false */
/* global describe:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    config = require('../config.js'),
    users = require('../users.js'),
    attachments = require('../services/attachment-service.js'),
    gcCli = require('../../scripts/gc-attachments.js');

function fakeDb(collections, failure) {
    return {
        listCollections: function () {
            return {
                toArray: function () {
                    if (failure === 'listCollections') return Promise.reject(new Error('database scan failed'));
                    return Promise.resolve(Object.keys(collections).map(function (name) { return { name: name }; }));
                }
            };
        },
        collection: function (name) {
            return {
                find: function () {
                    return {
                        toArray: function () {
                            if (failure === name) return Promise.reject(new Error('database scan failed'));
                            return Promise.resolve(collections[name] || []);
                        }
                    };
                }
            };
        }
    };
}

function writeFile(root, userRoot, identifier, modifiedAt) {
    var directory = path.join(root, userRoot);
    fs.mkdirSync(directory, { recursive: true });
    var file = path.join(directory, identifier);
    fs.writeFileSync(file, identifier);
    fs.utimesSync(file, modifiedAt / 1000, modifiedAt / 1000);
    return file;
}

describe('Attachment orphan GC (RF-711)', function () {
    var originalDb;
    var originalAttachmentDir;
    var originalRepository;
    var originalListAttachments;
    var tempDir;
    var now = Date.UTC(2026, 0, 2);
    var old = now - (25 * 60 * 60 * 1000);
    var recent = now - (23 * 60 * 60 * 1000);

    beforeEach(function () {
        originalDb = config.db;
        originalAttachmentDir = config.attachmentDir;
        originalRepository = users.getRepository();
        originalListAttachments = require('../storage/local-storage.js').listAttachments;
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-attachment-gc-'));
        config.attachmentDir = tempDir;
        users.setRepository({
            list: function () {
                return Promise.resolve([{ id: 'alice-id', username: 'alice' }]);
            }
        });
    });

    afterEach(function () {
        config.db = originalDb;
        config.attachmentDir = originalAttachmentDir;
        users.setRepository(originalRepository);
        require('../storage/local-storage.js').listAttachments = originalListAttachments;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('detects per-user current and legacy orphans, honors grace, and deletes only eligible orphans', async function () {
        config.db = fakeDb({
            things: [{
                ownerId: 'alice-id',
                attachments: [{ identifier: 'current-reference.bin' }]
            }],
            alice_things: [{ attachments: ['legacy-reference.bin'] }]
        });

        var currentReference = writeFile(tempDir, 'alice-id', 'current-reference.bin', old);
        var currentOrphan = writeFile(tempDir, 'alice-id', 'current-orphan.bin', old);
        var recentOrphan = writeFile(tempDir, 'alice-id', 'recent-orphan.bin', recent);
        var legacyReference = writeFile(tempDir, 'alice', 'legacy-reference.bin', old);
        var legacyOrphan = writeFile(tempDir, 'alice', 'legacy-orphan.bin', old);
        var otherUserSameName = writeFile(tempDir, 'bob', 'current-reference.bin', old);

        var dryRun = await attachments.garbageCollect({ now: now });
        expect(dryRun.mode).to.equal('dry-run');
        expect(dryRun.filesScanned).to.equal(6);
        expect(dryRun.orphansFound).to.equal(3);
        expect(dryRun.eligibleForDeletion).to.equal(2);
        expect(dryRun.deleted).to.equal(0);
        expect(fs.existsSync(currentOrphan)).to.be(true);

        var applied = await attachments.garbageCollect({ apply: true, now: now });
        expect(applied.mode).to.equal('apply');
        expect(applied.deleted).to.equal(2);
        expect(fs.existsSync(currentReference)).to.be(true);
        expect(fs.existsSync(legacyReference)).to.be(true);
        expect(fs.existsSync(recentOrphan)).to.be(true);
        expect(fs.existsSync(currentOrphan)).to.be(false);
        expect(fs.existsSync(legacyOrphan)).to.be(false);
        expect(fs.existsSync(otherUserSameName)).to.be(true);
    });

    it('protects references when user aliases are omitted by the repository', async function () {
        users.setRepository({ list: function () { return Promise.resolve([]); } });
        config.db = fakeDb({
            things: [{ ownerId: 'disabled-stable-id', attachments: [{ identifier: 'disabled-reference.bin' }] }]
        });
        var referenced = writeFile(tempDir, 'disabled-username', 'disabled-reference.bin', old);

        var result = await attachments.garbageCollect({ apply: true, now: now });

        expect(result.deleted).to.equal(0);
        expect(fs.existsSync(referenced)).to.be(true);
    });

    it('revalidates references immediately before deleting an eligible orphan', async function () {
        var collections = { things: [] };
        config.db = fakeDb(collections);
        var referenced = writeFile(tempDir, 'alice-id', 'concurrent-reference.bin', old);
        var storage = require('../storage/local-storage.js');
        storage.listAttachments = async function () {
            var files = await originalListAttachments();
            collections.things.push({
                ownerId: 'alice-id',
                attachments: [{ identifier: 'concurrent-reference.bin' }]
            });
            return files;
        };

        var result = await attachments.garbageCollect({ apply: true, now: now });

        expect(result.eligibleForDeletion).to.equal(1);
        expect(result.deleted).to.equal(0);
        expect(fs.existsSync(referenced)).to.be(true);
    });

    it('fails closed on database scan errors without deleting files', async function () {
        config.db = fakeDb({}, 'listCollections');
        var orphan = writeFile(tempDir, 'alice', 'orphan.bin', old);

        var error;
        try {
            await attachments.garbageCollect({ apply: true, now: now });
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.ok();
        expect(error.message).to.contain('database scan failed');
        expect(fs.existsSync(orphan)).to.be(true);
    });

    it('fails closed on unsafe database attachment paths', async function () {
        config.db = fakeDb({
            things: [{ ownerId: 'alice-id', attachments: [{ identifier: '../escape.bin' }] }]
        });
        var orphan = writeFile(tempDir, 'alice-id', 'orphan.bin', old);

        var error;
        try {
            await attachments.garbageCollect({ apply: true, now: now });
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.ok();
        expect(error.message).to.contain('Unsafe attachment identifier');
        expect(fs.existsSync(orphan)).to.be(true);
    });

    it('defaults the CLI to dry-run and rejects conflicting modes', function () {
        expect(gcCli.parseArgs([]).mode).to.equal('dry-run');
        expect(function () { gcCli.parseArgs(['--dry-run', '--apply']); }).to.throwError();
    });
});
