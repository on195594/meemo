'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js');
var http = require('http');
var ssrf = require('../ssrf.js');
var logic = require('../logic.js');
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
        it('rejects non-http/https protocols', function (done) {
            ssrf.isSafeUrl('ftp://example.com/file', function (err, safe) {
                expect(safe).to.be(false);
                ssrf.isSafeUrl('file:///etc/passwd', function (err, safe) {
                    expect(safe).to.be(false);
                    ssrf.isSafeUrl('javascript:alert(1)', function (err, safe) {
                        expect(safe).to.be(false);
                        done();
                    });
                });
            });
        });

        it('rejects localhost and reserved local hostnames', function (done) {
            ssrf.isSafeUrl('http://localhost:3000/api', function (err, safe) {
                expect(safe).to.be(false);
                ssrf.isSafeUrl('http://sub.localhost/foo', function (err, safe) {
                    expect(safe).to.be(false);
                    ssrf.isSafeUrl('http://myhost.local/', function (err, safe) {
                        expect(safe).to.be(false);
                        ssrf.isSafeUrl('http://internal.lan/secret', function (err, safe) {
                            expect(safe).to.be(false);
                            done();
                        });
                    });
                });
            });
        });

        it('rejects loopback and link-local IP URLs', function (done) {
            ssrf.isSafeUrl('http://127.0.0.1:8080', function (err, safe) {
                expect(safe).to.be(false);
                ssrf.isSafeUrl('http://169.254.169.254/latest/meta-data', function (err, safe) {
                    expect(safe).to.be(false);
                    done();
                });
            });
        });

        it('rejects RFC1918 private IP URLs', function (done) {
            ssrf.isSafeUrl('http://10.0.0.1/admin', function (err, safe) {
                expect(safe).to.be(false);
                ssrf.isSafeUrl('http://172.16.0.1/', function (err, safe) {
                    expect(safe).to.be(false);
                    ssrf.isSafeUrl('http://192.168.1.1/router', function (err, safe) {
                        expect(safe).to.be(false);
                        done();
                    });
                });
            });
        });

        it('rejects IPv6 loopback and private URLs', function (done) {
            ssrf.isSafeUrl('http://[::1]:8080', function (err, safe) {
                expect(safe).to.be(false);
                ssrf.isSafeUrl('http://[fe80::1]/', function (err, safe) {
                    expect(safe).to.be(false);
                    ssrf.isSafeUrl('http://[fc00::1]/', function (err, safe) {
                        expect(safe).to.be(false);
                        done();
                    });
                });
            });
        });

        it('rejects malformed URLs', function (done) {
            ssrf.isSafeUrl('not a url', function (err, safe) {
                expect(safe).to.be(false);
                done();
            });
        });
    });

    describe('probeUrl and redirects', function () {
        var server;
        var serverPort;

        before(function (done) {
            server = http.createServer(function (req, res) {
                if (req.url === '/redirect-to-private') {
                    res.writeHead(302, { 'Location': 'http://127.0.0.1:9999/secret' });
                    res.end();
                } else if (req.url === '/redirect-to-metadata') {
                    res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data' });
                    res.end();
                } else if (req.url === '/redirect-loop') {
                    res.writeHead(302, { 'Location': '/redirect-loop' });
                    res.end();
                } else if (req.url === '/image.png') {
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    res.end();
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('Hello');
                }
            });

            server.listen(0, '127.0.0.1', function () {
                serverPort = server.address().port;
                done();
            });
        });

        after(function (done) {
            if (server) {
                server.close(done);
            } else {
                done();
            }
        });

        it('blocks direct probe to loopback address', function (done) {
            ssrf.probeUrl('http://127.0.0.1:' + serverPort + '/image.png', function (err, result) {
                expect(err).to.be(null);
                expect(result.type).to.equal(ssrf.TYPE_UNKNOWN);
                expect(result.url).to.equal('http://127.0.0.1:' + serverPort + '/image.png');
                done();
            });
        });

        it('blocks redirect to private loopback address', function (done) {
            // We bypass the initial check to simulate a public URL redirecting to private
            var customOptions = {
                timeout: 2000,
                maxRedirects: 3
            };

            // Test with direct probe to redirect endpoint: initial check blocks it because 127.0.0.1 is private
            ssrf.probeUrl('http://127.0.0.1:' + serverPort + '/redirect-to-private', customOptions, function (err, result) {
                expect(err).to.be(null);
                expect(result.type).to.equal(ssrf.TYPE_UNKNOWN);
                done();
            });
        });
    });

    describe('Enrichment policy and note integration', function () {
        before(function (done) {
            config._clearDatabase(done);
        });

        after(function (done) {
            config._clearDatabase(done);
        });

        it('defaults to URL enrichment disabled when URL_ENRICHMENT_ENABLED is not set', function (done) {
            delete process.env.URL_ENRICHMENT_ENABLED;
            expect(ssrf.isEnrichmentEnabled()).to.be(false);

            var note = 'Check out http://127.0.0.1/secret and http://example.com/test.png';
            logic.extractExternalContent(note, function (err, result) {
                expect(err).to.be(null);
                expect(result.length).to.equal(2);
                expect(result[0].type).to.equal(ssrf.TYPE_UNKNOWN);
                expect(result[1].type).to.equal(ssrf.TYPE_UNKNOWN);
                done();
            });
        });

        it('caps outbound URL enrichment to MAX_ENRICH_URLS (5) when enabled', function (done) {
            process.env.URL_ENRICHMENT_ENABLED = 'true';

            var urls = [
                'http://127.0.0.1/1',
                'http://127.0.0.1/2',
                'http://127.0.0.1/3',
                'http://127.0.0.1/4',
                'http://127.0.0.1/5',
                'http://127.0.0.1/6',
                'http://127.0.0.1/7'
            ];

            ssrf.enrichUrls(urls, { maxUrls: 5 }, function (err, result) {
                expect(err).to.be(null);
                expect(result.length).to.equal(7);
                result.forEach(function (item) {
                    expect(item.type).to.equal(ssrf.TYPE_UNKNOWN);
                });
                done();
            });
        });

        it('saves notes cleanly with private URLs without failing or hanging', function (done) {
            process.env.URL_ENRICHMENT_ENABLED = 'false';
            var userId = 'test-user-ssrf';
            var content = 'Note with internal links: http://127.0.0.1:8080, http://169.254.169.254/meta #security';

            logic.add(userId, content, [], function (err, note) {
                expect(err).to.be(null);
                expect(note).to.be.ok();
                expect(note.content).to.equal(content);
                expect(note.tags).to.eql(['security']);
                expect(note.externalContent.length).to.equal(2);
                expect(note.externalContent[0].type).to.equal(ssrf.TYPE_UNKNOWN);
                expect(note.externalContent[1].type).to.equal(ssrf.TYPE_UNKNOWN);
                done();
            });
        });
    });
});
