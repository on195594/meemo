/* jslint node:true */

'use strict';

exports = module.exports = {
    isPrivateIp: isPrivateIp,
    isSafeUrl: isSafeUrl,
    probeUrl: probeUrl,
    enrichUrls: enrichUrls,
    isEnrichmentEnabled: isEnrichmentEnabled,

    TYPE_IMAGE: 'image',
    TYPE_UNKNOWN: 'unknown',
    MAX_ENRICH_URLS: 5,
    DEFAULT_TIMEOUT: 3000,
    MAX_REDIRECTS: 3
};

var http = require('http');
var https = require('https');
var dns = require('dns');
var net = require('net');
var async = require('async');
var debug = require('debug')('ssrf');

var TYPE_IMAGE = exports.TYPE_IMAGE;
var TYPE_UNKNOWN = exports.TYPE_UNKNOWN;
var MAX_ENRICH_URLS = exports.MAX_ENRICH_URLS;
var DEFAULT_TIMEOUT = exports.DEFAULT_TIMEOUT;
var MAX_REDIRECTS = exports.MAX_REDIRECTS;

function isPrivateIpv4(ip) {
    var parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(function (n) { return isNaN(n) || n < 0 || n > 255; })) {
        return true;
    }
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (RFC1918)
    if (parts[0] === 10) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT RFC6598)
    if (parts[0] === 100 && (parts[1] >= 64 && parts[1] <= 127)) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local, includes 169.254.169.254 metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (RFC1918)
    if (parts[0] === 172 && (parts[1] >= 16 && parts[1] <= 31)) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    // 192.168.0.0/16 (RFC1918)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast 224-239) & 240.0.0.0/4 (Reserved 240-255)
    if (parts[0] >= 224) return true;

    return false;
}

function isPrivateIpv6(ip) {
    var lower = ip.toLowerCase();
    // Loopback & Unspecified
    if (lower === '::1' || lower === '::') return true;
    // ULA (Unique Local Address fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local (fe80::/10)
    if (/^fe[89ab]/.test(lower)) return true;
    // Site-local (fec0::/10, deprecated)
    if (/^fe[cdef]/.test(lower)) return true;
    // Multicast (ff00::/8)
    if (lower.startsWith('ff')) return true;
    // Documentation (2001:db8::/32)
    if (lower.startsWith('2001:db8:')) return true;

    return false;
}

function isPrivateIp(ip) {
    if (!ip || typeof ip !== 'string') return true;

    // Remove zone identifier if any (e.g., fe80::1%eth0)
    var zoneIndex = ip.indexOf('%');
    if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);

    // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (ip.toLowerCase().startsWith('::ffff:')) {
        var rest = ip.slice(7);
        if (net.isIPv4(rest)) return isPrivateIpv4(rest);
        var hexParts = rest.split(':');
        if (hexParts.length === 2) {
            var hi = parseInt(hexParts[0], 16);
            var lo = parseInt(hexParts[1], 16);
            if (!isNaN(hi) && !isNaN(lo)) {
                return isPrivateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
            }
        }
        return true;
    }

    if (net.isIPv4(ip)) return isPrivateIpv4(ip);
    if (net.isIPv6(ip)) return isPrivateIpv6(ip);

    return true;
}

function isSafeUrl(urlString, callback) {
    var parsed;
    try {
        parsed = new URL(urlString);
    } catch (e) {
        return callback(null, false, null);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return callback(null, false, parsed);
    }

    var hostname = parsed.hostname;
    if (!hostname) {
        return callback(null, false, parsed);
    }

    // Strip IPv6 brackets
    var cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // Reject localhost / reserved domain names
    if (cleanHost === 'localhost' ||
        cleanHost.endsWith('.localhost') ||
        cleanHost.endsWith('.local') ||
        cleanHost.endsWith('.internal') ||
        cleanHost.endsWith('.intranet') ||
        cleanHost.endsWith('.home.arpa') ||
        cleanHost.endsWith('.lan')) {
        return callback(null, false, parsed);
    }

    // If hostname is directly an IP
    if (net.isIP(cleanHost)) {
        if (isPrivateIp(cleanHost)) {
            return callback(null, false, parsed);
        }
        return callback(null, true, parsed);
    }

    // Domain name: resolve DNS and check all returned IPs
    dns.lookup(cleanHost, { all: true }, function (err, addresses) {
        if (err || !addresses || addresses.length === 0) {
            debug('DNS lookup failed for %s: %s', cleanHost, err ? err.message : 'no addresses');
            return callback(null, false, parsed);
        }

        for (var i = 0; i < addresses.length; i++) {
            if (isPrivateIp(addresses[i].address)) {
                debug('Domain %s resolved to private IP: %s', cleanHost, addresses[i].address);
                return callback(null, false, parsed);
            }
        }

        return callback(null, true, parsed);
    });
}

function probeUrl(rawUrl, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    options = options || {};
    var timeout = typeof options.timeout === 'number' ? options.timeout : DEFAULT_TIMEOUT;
    var maxRedirects = typeof options.maxRedirects === 'number' ? options.maxRedirects : MAX_REDIRECTS;
    var redirectCount = typeof options.redirectCount === 'number' ? options.redirectCount : 0;
    var originalUrl = options.originalUrl || rawUrl;

    var done = false;
    function finish(type) {
        if (done) return;
        done = true;
        callback(null, { url: originalUrl, type: type || TYPE_UNKNOWN });
    }

    isSafeUrl(rawUrl, function (err, isSafe, parsedUrl) {
        if (!isSafe || !parsedUrl) {
            return finish(TYPE_UNKNOWN);
        }

        var transport = parsedUrl.protocol === 'https:' ? https : http;
        var cleanHost = parsedUrl.hostname.replace(/^\[|\]$/g, '');

        var reqOptions = {
            protocol: parsedUrl.protocol,
            hostname: cleanHost,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: (parsedUrl.pathname || '/') + (parsedUrl.search || ''),
            method: 'HEAD',
            headers: {
                'User-Agent': 'meemo-url-enricher/1.0',
                'Accept': '*/*'
            },
            timeout: timeout,
            // Guard against DNS rebinding TOCTOU during socket connect
            lookup: function (hostname, lookupOpts, cb) {
                dns.lookup(hostname, lookupOpts, function (dnsErr, address, family) {
                    if (dnsErr) return cb(dnsErr);
                    var addr = Array.isArray(address) ? address[0].address : address;
                    if (isPrivateIp(addr)) {
                        return cb(new Error('SSRF blocked in socket lookup: ' + addr));
                    }
                    cb(null, address, family);
                });
            }
        };

        var req = transport.request(reqOptions, function (res) {
            // Handle redirects (301, 302, 303, 307, 308)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.destroy();
                if (redirectCount >= maxRedirects) {
                    debug('Exceeded max redirects (%d) for %s', maxRedirects, rawUrl);
                    return finish(TYPE_UNKNOWN);
                }

                var nextUrl;
                try {
                    nextUrl = new URL(res.headers.location, rawUrl).href;
                } catch (e) {
                    debug('Invalid redirect location %s from %s', res.headers.location, rawUrl);
                    return finish(TYPE_UNKNOWN);
                }

                var nextOpts = {
                    timeout: timeout,
                    maxRedirects: maxRedirects,
                    redirectCount: redirectCount + 1,
                    originalUrl: originalUrl
                };

                return probeUrl(nextUrl, nextOpts, callback);
            }

            var contentType = res.headers['content-type'] || '';
            res.destroy();

            if (res.statusCode >= 200 && res.statusCode < 300 && contentType.indexOf('image/') === 0) {
                return finish(TYPE_IMAGE);
            }

            return finish(TYPE_UNKNOWN);
        });

        req.on('timeout', function () {
            debug('Probe timed out for %s', rawUrl);
            req.destroy();
            finish(TYPE_UNKNOWN);
        });

        req.on('error', function (error) {
            debug('Probe failed for %s: %s', rawUrl, error.message);
            finish(TYPE_UNKNOWN);
        });

        req.end();
    });
}

function isEnrichmentEnabled() {
    return process.env.URL_ENRICHMENT_ENABLED === 'true';
}

function enrichUrls(urls, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    options = options || {};

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return callback(null, []);
    }

    if (!isEnrichmentEnabled()) {
        return callback(null, urls.map(function (u) {
            return { url: u, type: TYPE_UNKNOWN };
        }));
    }

    var maxEnrich = typeof options.maxUrls === 'number' ? options.maxUrls : MAX_ENRICH_URLS;
    var toProbe = urls.slice(0, maxEnrich);
    var remaining = urls.slice(maxEnrich);

    async.mapLimit(toProbe, 3, function (u, cb) {
        probeUrl(u, options, function (err, result) {
            cb(null, result || { url: u, type: TYPE_UNKNOWN });
        });
    }, function (err, results) {
        var unprobed = remaining.map(function (u) {
            return { url: u, type: TYPE_UNKNOWN };
        });
        callback(null, (results || []).concat(unprobed));
    });
}
