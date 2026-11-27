'use strict';

var twemoji = require('twemoji');

var COLOR_SET = new Set([
    'clear', 'aliceblue', 'lightsalmon', 'antiquewhite', 'lightseagreen', 'aqua', 'lightskyblue', 'aquamarine',
    'lightslategray', 'azure', 'lightsteelblue', 'beige', 'lightyellow', 'bisque', 'lime', 'black', 'limegreen',
    'blanchedalmond', 'linen', 'blue', 'magenta', 'blueviolet', 'maroon', 'brown', 'mediumaquamarine', 'burlywood',
    'mediumblue', 'cadetblue', 'mediumorchid', 'chartreuse', 'mediumpurple', 'chocolate', 'mediumseagreen', 'coral',
    'mediumslateblue', 'cornflowerblue', 'mediumspringgreen', 'cornsilk', 'mediumturquoise', 'crimson', 'mediumvioletred',
    'cyan', 'midnightblue', 'darkblue', 'mintcream', 'darkcyan', 'mistyrose', 'darkgoldenrod', 'moccasin', 'darkgray',
    'navajowhite', 'darkgreen', 'navy', 'darkkhaki', 'oldlace', 'darkmagenta', 'olive', 'darkolivegreen', 'olivedrab',
    'darkorange', 'orange', 'darkorchid', 'orangered', 'darkred', 'orchid', 'darksalmon', 'palegoldenrod',
    'darkseagreen', 'palegreen', 'darkslateblue', 'paleturquoise', 'darkslategray', 'palevioletred', 'darkturquoise',
    'papayawhip', 'darkviolet', 'peachpuff', 'deeppink', 'peru', 'deepskyblue', 'pink', 'dimgray', 'plum',
    'dodgerblue', 'powderblue', 'firebrick', 'purple', 'floralwhite', 'red', 'forestgreen', 'rosybrown', 'fuchsia',
    'royalblue', 'gainsboro', 'saddlebrown', 'ghostwhite', 'salmon', 'gold', 'sandybrown', 'goldenrod', 'seagreen',
    'gray', 'seashell', 'green', 'sienna', 'greenyellow', 'silver', 'honeydew', 'skyblue', 'hotpink', 'slateblue',
    'indianred', 'slategray', 'indigo', 'snow', 'ivory', 'springgreen', 'khaki', 'steelblue', 'lavender', 'tan',
    'lavenderblush', 'teal', 'lawngreen', 'thistle', 'lemonchiffon', 'tomato', 'lightblue', 'turquoise', 'lightcoral',
    'violet', 'lightcyan', 'wheat', 'lightgoldenrodyellow', 'white', 'lightgreen', 'whitesmoke', 'lightgrey', 'yellow',
    'lightpink', 'yellowgreen'
]);

function markdownTargetBlank(md) {
    var defaultRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        var href = tokens[idx].attrs[tokens[idx].attrIndex('href')][1];
        if (href.indexOf('https://') === 0 || href.indexOf('http://') === 0) {
            var targetIndex = tokens[idx].attrIndex('target');
            if (targetIndex < 0) tokens[idx].attrPush(['target', '_blank']);
            else tokens[idx].attrs[targetIndex][1] = '_blank';
        }
        return defaultRender(tokens, idx, options, env, self);
    };
}

function colorizeIt(md) {
    var regexp = /^:([#\w-]+):/;

    md.inline.ruler.push('colorizeIt', function (state, silent) {
        if (state.src.charCodeAt(state.pos) !== 0x3a) return false;
        var match = regexp.exec(state.src.slice(state.pos, state.pos + 32));
        if (!match || (match[1][0] !== '#' && !COLOR_SET.has(match[1]))) return false;
        state.pos += match[0].length;
        if (silent) return true;
        var token = state.push('colorizeIt', '', 0);
        token.meta = { color: match[1] };
        return true;
    });

    md.renderer.rules.colorizeIt = function (tokens, id) {
        if (tokens[id].meta.color === 'clear') return '</span>';
        return '<span style="color: ' + tokens[id].meta.color + ';">';
    };
}

function wikilinks(md) {
    md.inline.ruler.before('link', 'wikilink', function (state, silent) {
        if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
        var start = state.pos + 2;
        var matchEnd = state.src.indexOf(']]', start);
        if (matchEnd === -1) return false;
        var inner = state.src.slice(start, matchEnd);
        if (inner.indexOf('\n') !== -1 || !inner.trim()) return false;
        var parts = inner.split('|');
        var target = parts[0].trim();
        if (!target) return false;

        if (!silent) {
            var label = (parts.length > 1 ? parts.slice(1).join('|') : parts[0]).trim() || target;
            var token = state.push('wikilink', 'a', 0);
            token.meta = { target: target, label: label };
        }
        state.pos = matchEnd + 2;
        return true;
    });

    md.renderer.rules.wikilink = function (tokens, idx, options, env) {
        var token = tokens[idx];
        var target = token.meta ? token.meta.target : '';
        var label = token.meta ? token.meta.label : target;
        var baseUrl = (env && env.baseUrl) ? env.baseUrl : (process.env.APP_ORIGIN || '');
        var prefix = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
        var href = prefix + '/?q=' + encodeURIComponent(target);
        return '<a class="wikilink" href="' + md.utils.escapeHtml(href) + '" data-wikilink="' + md.utils.escapeHtml(target) + '">' + md.utils.escapeHtml(label) + '</a>';
    };
}

var markdown = require('markdown-it')({ breaks: true, html: true, linkify: true })
    .use(require('markdown-it-emoji').full)
    .use(colorizeIt)
    .use(wikilinks)
    .use(require('markdown-it-checkbox'))
    .use(markdownTargetBlank);

markdown.renderer.rules.emoji = function (token, idx) {
    return twemoji.parse(token[idx].content);
};

function renderFeedHtml(source, webServer) {
    return markdown.render(source, { baseUrl: webServer })
        .replace(/(src|href)="\/api\//g, '$1="' + webServer + '/api/');
}

module.exports = {
    renderFeedHtml: renderFeedHtml
};
