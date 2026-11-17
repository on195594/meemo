'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js');
var http = require('http');
var EventEmitter = require('events').EventEmitter;
var MongoClient = require('mongodb').MongoClient;
var ssrf = require('../ssrf.js');
var logic = require('../services/thing-service.js');
var config = require('../config.js');

describe('SSRF Protection', function () {
    var previousEnv;

    beforeEach(function () {
        previousEnv = process.env.URL_ENRICHMENT_ENABLED;
    });

    afterEach(function () {
        if (previousEnv === undefined) {
            delete process.env.URL_ENRICHMENT_ENABLED;
        } else {
            process.env.URL_ENRICHMENT_ENABLED = previousEnv;
        }
    });

    describe('isPrivateIp', function () {
        it('identifies IPv4 loopback addresses as private', function () {
            expect(ssrf.isPrivateIp('127.0.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('127.0.0.2')).to.be(true);
            expect(ssrf.isPrivateIp('127.255.255.255')).to.be(true);
        });

        it('identifies RFC1918 10.0.0.0/8 as private', function () {
            expect(ssrf.isPrivateIp('10.0.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('10.255.255.255')).to.be(true);
        });

        it('identifies RFC1918 172.16.0.0/12 as private', function () {
            expect(ssrf.isPrivateIp('172.16.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('172.31.255.255')).to.be(true);
            // 172.32.0.1 is public
            expect(ssrf.isPrivateIp('172.32.0.1')).to.be(false);
        });

        it('identifies RFC1918 192.168.0.0/16 as private', function () {
            expect(ssrf.isPrivateIp('192.168.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('192.168.1.100')).to.be(true);
            expect(ssrf.isPrivateIp('192.168.255.255')).to.be(true);
        });

        it('identifies link-local and cloud metadata addresses (169.254.0.0/16) as private', function () {
            expect(ssrf.isPrivateIp('169.254.169.254')).to.be(true);
            expect(ssrf.isPrivateIp('169.254.1.1')).to.be(true);
        });

        it('identifies current network (0.0.0.0/8) as private', function () {
            expect(ssrf.isPrivateIp('0.0.0.0')).to.be(true);
        });

        it('identifies CGNAT (100.64.0.0/10) as private', function () {
            expect(ssrf.isPrivateIp('100.64.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('100.127.255.255')).to.be(true);
            expect(ssrf.isPrivateIp('100.128.0.1')).to.be(false);
        });

        it('identifies multicast and reserved IPv4 as private', function () {
            expect(ssrf.isPrivateIp('224.0.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('240.0.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('255.255.255.255')).to.be(true);
        });

        it('identifies IPv6 loopback, unspecified, ULA, link-local, and site-local as private', function () {
            expect(ssrf.isPrivateIp('::1')).to.be(true);
            expect(ssrf.isPrivateIp('::')).to.be(true);
            expect(ssrf.isPrivateIp('fc00::1')).to.be(true);
            expect(ssrf.isPrivateIp('fd12:3456::1')).to.be(true);
            expect(ssrf.isPrivateIp('fe80::1')).to.be(true);
            expect(ssrf.isPrivateIp('fec0::1')).to.be(true);
            expect(ssrf.isPrivateIp('ff02::1')).to.be(true);
        });

        it('identifies IPv4-mapped IPv6 pointing to private addresses', function () {
            expect(ssrf.isPrivateIp('::ffff:127.0.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('::ffff:169.254.169.254')).to.be(true);
            expect(ssrf.isPrivateIp('::ffff:10.0.0.1')).to.be(true);
            expect(ssrf.isPrivateIp('::ffff:192.168.1.1')).to.be(true);
            expect(ssrf.isPrivateIp('::ffff:7f00:1')).to.be(true);
            // Public IPv4-mapped IPv6
            expect(ssrf.isPrivateIp('::ffff:8.8.8.8')).to.be(false);
        });

        it('identifies valid public IPs as not private', function () {
            expect(ssrf.isPrivateIp('8.8.8.8')).to.be(false);
            expect(ssrf.isPrivateIp('1.1.1.1')).to.be(false);
            expect(ssrf.isPrivateIp('93.184.216.34')).to.be(false);
            expect(ssrf.isPrivateIp('2606:2800:220:1:248:1893:25c8:1946')).to.be(false);
        });

        it('identifies invalid IP strings as private/unsafe', function () {
            expect(ssrf.isPrivateIp('')).to.be(true);
            expect(ssrf.isPrivateIp(null)).to.be(true);
            expect(ssrf.isPrivateIp('invalid-ip')).to.be(true);
            expect(ssrf.isPrivateIp('999.999.999.999')).to.be(true);
        });
    });

    describe('isSafeUrl', function () {
        it('rejects non-http/https protocols', async function () {
            expect((await ssrf.isSafeUrl('ftp://example.com/file')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('file:///etc/passwd')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('javascript:alert(1)')).safe).to.be(false);
        });

        it('rejects localhost and reserved local hostnames', async function () {
            expect((await ssrf.isSafeUrl('http://localhost:3000/api')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://sub.localhost/foo')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://myhost.local/')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://internal.lan/secret')).safe).to.be(false);
        });

        it('rejects loopback and link-local IP URLs', async function () {
            expect((await ssrf.isSafeUrl('http://127.0.0.1:8080')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://169.254.169.254/latest/meta-data')).safe).to.be(false);
        });

        it('rejects RFC1918 private IP URLs', async function () {
            expect((await ssrf.isSafeUrl('http://10.0.0.1/admin')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://172.16.0.1/')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://192.168.1.1/router')).safe).to.be(false);
        });

        it('rejects IPv6 loopback and private URLs', async function () {
            expect((await ssrf.isSafeUrl('http://[::1]:8080')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://[fe80::1]/')).safe).to.be(false);
            expect((await ssrf.isSafeUrl('http://[fc00::1]/')).safe).to.be(false);
        });

        it('rejects malformed URLs', async function () {
            expect((await ssrf.isSafeUrl('not a url')).safe).to.be(false);
        });
    });

    describe('probeUrl and redirects', function () {
        it('blocks direct probe to loopback address', async function () {
            var result = await ssrf.probeUrl('http://127.0.0.1/image.png');
            expect(result.type).to.equal(ssrf.TYPE_UNKNOWN);
            expect(result.url).to.equal('http://127.0.0.1/image.png');
        });

        it('blocks redirects from a public URL to loopback and metadata addresses', async function () {
            var originalRequest = http.request;
            var hosts = [];
            var location;
            http.request = function (options, onResponse) {
                hosts.push(options.hostname);
                var request = new EventEmitter();
                request.end = function () {
                    onResponse({ statusCode: 302, headers: { location: location }, destroy: function () {} });
                };
                return request;
            };
            try {
                for (location of ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data']) {
                    hosts = [];
                    var result = await ssrf.probeUrl('http://93.184.216.34/redirect');
                    expect(hosts).to.eql(['93.184.216.34']);
                    expect(result).to.eql({ url: 'http://93.184.216.34/redirect', type: ssrf.TYPE_UNKNOWN });
                }
            } finally {
                http.request = originalRequest;
            }
        });
    });

    describe('Enrichment policy and note integration', function () {
        var dbClient;
        var previousDb;

        before(async function () {
            previousDb = config.db;
            await config._clearDatabase();
            dbClient = await MongoClient.connect(config.databaseUrl);
            config.db = dbClient.db();
        });

        after(async function () {
            config.db = previousDb;
            if (dbClient) {
                await dbClient.close();
            }
            await config._clearDatabase();
        });

        it('defaults to URL enrichment disabled when URL_ENRICHMENT_ENABLED is not set', async function () {
            delete process.env.URL_ENRICHMENT_ENABLED;
            expect(ssrf.isEnrichmentEnabled()).to.be(false);
            var note = 'Check out http://127.0.0.1/secret and http://example.com/test.png';
            var result = await ssrf.enrichUrls(logic.extractURLs(note));
            expect(result.length).to.equal(2);
            expect(result[0].type).to.equal(ssrf.TYPE_UNKNOWN);
            expect(result[1].type).to.equal(ssrf.TYPE_UNKNOWN);
        });

        it('probes only the first five URLs by default when enrichment is enabled', async function () {
            process.env.URL_ENRICHMENT_ENABLED = 'true';
            ssrf.clearProbeCache();
            var urls = Array.from({ length: 7 }, function (_, index) { return 'https://example.com/' + index; });
            var probed = [];
            var originalProbe = ssrf.probeUrl;
            ssrf.probeUrl = async function (url) {
                probed.push(url);
                return { url: url, type: ssrf.TYPE_IMAGE };
            };
            try {
                var result = await ssrf.enrichUrls(urls);
                expect(probed).to.eql(urls.slice(0, 5));
                expect(result).to.eql(urls.map(function (url, index) {
                    return { url: url, type: index < 5 ? ssrf.TYPE_IMAGE : ssrf.TYPE_UNKNOWN };
                }));
            } finally {
                ssrf.probeUrl = originalProbe;
                ssrf.clearProbeCache();
            }
        });

        it('saves notes cleanly with private URLs without failing or hanging', async function () {
            process.env.URL_ENRICHMENT_ENABLED = 'false';
            var userId = 'test-user-ssrf';
            var content = 'Note with internal links: http://127.0.0.1:8080, http://169.254.169.254/meta #security';

            var note = await logic.add(userId, content, []);
            expect(note).to.be.ok();
            expect(note.content).to.equal(content);
            expect(note.tags).to.eql(['security']);
            expect(note.externalContent.length).to.equal(2);
            expect(note.externalContent[0].type).to.equal(ssrf.TYPE_UNKNOWN);
            expect(note.externalContent[1].type).to.equal(ssrf.TYPE_UNKNOWN);
        });
    });
});
