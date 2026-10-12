'use strict';

var fs = require('fs'),
    os = require('os'),
    path = require('path');

function createCaptureStore(until) {
    var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-mcp-bootstrap-'));
    var filename = path.join(directory, 'callbacks.json');
    var entries = [];
    var saving = Promise.resolve();
    var cleanup = setTimeout(function () {
        saving = saving.catch(function () {}).then(function () {
            return fs.promises.rm(directory, { recursive: true, force: true });
        }).catch(function () {});
    }, Math.max(0, until - Date.now()));
    cleanup.unref();

    return async function capture(redirectUris) {
        if (Date.now() >= until) throw new Error('Bootstrap expired');
        entries.push({ receivedAt: new Date().toISOString(), redirectUris: redirectUris });
        if (entries.length > 10) entries.shift();
        saving = saving.catch(function () {}).then(async function () {
            if (Date.now() >= until) return;
            var file = await fs.promises.open(filename,
                fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
            try {
                await file.writeFile(JSON.stringify({ expiresAt: new Date(until).toISOString(), entries: entries }));
            } finally { await file.close(); }
        });
        await saving;
    };
}

module.exports = createCaptureStore;
