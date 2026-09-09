/* jslint node:true */

'use strict';

var http = require('http'),
    https = require('https'),
    dns = require('dns'),
    net = require('net'),
    debug = require('debug')('ssrf'),
    nodeify = require('./promise.js');

var TYPE_IMAGE = 'image';
var TYPE_UNKNOWN = 'unknown';
var MAX_ENRICH_URLS = 5;
var DEFAULT_TIMEOUT = 3000;
var MAX_REDIRECTS = 3;

function isPrivateIpv4(ip) {
    var parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(function (number) { return isNaN(number) || number < 0 || number > 255; })) return true;
    if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    if (parts[0] >= 224) return true;
    return false;
}

function isPrivateIpv6(ip) {
    var lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(lower) || /^fe[cdef]/.test(lower)) return true;
    if (lower.startsWith('ff') || lower.startsWith('2001:db8:')) return true;
    return false;
}

function isPrivateIp(ip) {
    if (!ip || typeof ip !== 'string') return true;
    var zoneIndex = ip.indexOf('%');
    if (zoneIndex !== -1) ip = ip.slice(0, zoneIndex);

    if (ip.toLowerCase().startsWith('::ffff:')) {
        var rest = ip.slice(7);
        if (net.isIPv4(rest)) return isPrivateIpv4(rest);
        var hexParts = rest.split(':');
        if (hexParts.length === 2) {
            var high = parseInt(hexParts[0], 16);
            var low = parseInt(hexParts[1], 16);
            if (!isNaN(high) && !isNaN(low)) return isPrivateIpv4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
        }
        return true;
    }
    if (net.isIPv4(ip)) return isPrivateIpv4(ip);
    if (net.isIPv6(ip)) return isPrivateIpv6(ip);
    return true;
}

async function checkSafeUrl(urlString) {
    var parsed;
    try {
        parsed = new URL(urlString);
    } catch (error) {
        return { safe: false, parsed: null };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { safe: false, parsed: parsed };

    var hostname = parsed.hostname;
    if (!hostname) return { safe: false, parsed: parsed };
    var cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost') || cleanHost.endsWith('.local') ||
        cleanHost.endsWith('.internal') || cleanHost.endsWith('.intranet') || cleanHost.endsWith('.home.arpa') || cleanHost.endsWith('.lan')) {
        return { safe: false, parsed: parsed };
    }
    if (net.isIP(cleanHost)) return { safe: !isPrivateIp(cleanHost), parsed: parsed };

    try {
        var addresses = await dns.promises.lookup(cleanHost, { all: true });
        var safe = addresses.length > 0 && addresses.every(function (address) { return !isPrivateIp(address.address); });
        return { safe: safe, parsed: parsed };
    } catch (error) {
        debug('DNS lookup failed for %s: %s', cleanHost, error.message);
        return { safe: false, parsed: parsed };
    }
}

function isSafeUrl(urlString, callback) {
    var promise = checkSafeUrl(urlString);
    if (typeof callback !== 'function') return promise;
    promise.then(function (result) { callback(null, result.safe, result.parsed); }, callback);
}

function probeUrl(rawUrl, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    options = options || {};

    var promise = checkSafeUrl(rawUrl).then(function (safeResult) {
        if (!safeResult.safe || !safeResult.parsed) return { url: options.originalUrl || rawUrl, type: TYPE_UNKNOWN };

        return new Promise(function (resolve) {
            var parsedUrl = safeResult.parsed;
            var timeout = typeof options.timeout === 'number' ? options.timeout : DEFAULT_TIMEOUT;
            var redirectCount = typeof options.redirectCount === 'number' ? options.redirectCount : 0;
            var maxRedirects = typeof options.maxRedirects === 'number' ? options.maxRedirects : MAX_REDIRECTS;
            var originalUrl = options.originalUrl || rawUrl;
            var finished = false;

            function finish(type) {
                if (finished) return;
                finished = true;
                resolve({ url: originalUrl, type: type || TYPE_UNKNOWN });
            }

            var transport = parsedUrl.protocol === 'https:' ? https : http;
            var request = transport.request({
                protocol: parsedUrl.protocol,
                hostname: parsedUrl.hostname.replace(/^\[|\]$/g, ''),
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: (parsedUrl.pathname || '/') + (parsedUrl.search || ''),
                method: 'HEAD',
                headers: { 'User-Agent': 'meemo-url-enricher/1.0', 'Accept': '*/*' },
                timeout: timeout,
                lookup: function (hostname, lookupOptions, done) {
                    dns.lookup(hostname, lookupOptions, function (error, address, family) {
                        if (error) return done(error);
                        var resolved = Array.isArray(address) ? address.map(function (item) { return item.address; }) : [address];
                        var blocked = resolved.find(isPrivateIp);
                        if (blocked) return done(new Error('SSRF blocked in socket lookup: ' + blocked));
                        done(null, address, family);
                    });
                }
            }, function (response) {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.destroy();
                    if (redirectCount >= maxRedirects) return finish(TYPE_UNKNOWN);

                    var nextUrl;
                    try {
                        nextUrl = new URL(response.headers.location, rawUrl).href;
                    } catch (error) {
                        return finish(TYPE_UNKNOWN);
                    }
                    probeUrl(nextUrl, {
                        timeout: timeout,
                        maxRedirects: maxRedirects,
                        redirectCount: redirectCount + 1,
                        originalUrl: originalUrl
                    }).then(function (result) { finish(result.type); });
                    return;
                }

                var contentType = response.headers['content-type'] || '';
                var isImage = response.statusCode >= 200 && response.statusCode < 300 && contentType.indexOf('image/') === 0;
                response.destroy();
                finish(isImage ? TYPE_IMAGE : TYPE_UNKNOWN);
            });

            request.on('timeout', function () {
                request.destroy();
                finish(TYPE_UNKNOWN);
            });
            request.on('error', function () { finish(TYPE_UNKNOWN); });
            request.end();
        });
    });
    return nodeify(promise, callback);
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

    var promise = Promise.resolve().then(async function () {
        if (!Array.isArray(urls) || !urls.length) return [];
        if (!isEnrichmentEnabled()) return urls.map(function (url) { return { url: url, type: TYPE_UNKNOWN }; });

        var maxEnrich = typeof options.maxUrls === 'number' ? options.maxUrls : MAX_ENRICH_URLS;
        var toProbe = urls.slice(0, maxEnrich);
        var results = new Array(toProbe.length);
        var nextIndex = 0;

        async function worker() {
            while (nextIndex < toProbe.length) {
                var index = nextIndex++;
                results[index] = await probeUrl(toProbe[index], options);
            }
        }

        await Promise.all(Array.from({ length: Math.min(3, toProbe.length) }, worker));
        return results.concat(urls.slice(maxEnrich).map(function (url) { return { url: url, type: TYPE_UNKNOWN }; }));
    });
    return nodeify(promise, callback);
}

module.exports = {
    isPrivateIp: isPrivateIp,
    isSafeUrl: isSafeUrl,
    probeUrl: probeUrl,
    enrichUrls: enrichUrls,
    isEnrichmentEnabled: isEnrichmentEnabled,
    TYPE_IMAGE: TYPE_IMAGE,
    TYPE_UNKNOWN: TYPE_UNKNOWN,
    MAX_ENRICH_URLS: MAX_ENRICH_URLS,
    DEFAULT_TIMEOUT: DEFAULT_TIMEOUT,
    MAX_REDIRECTS: MAX_REDIRECTS
};
