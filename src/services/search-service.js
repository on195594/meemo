'use strict';

function escapeRegExp(value) {
    return value.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function queryHasText(query) {
    if (!query || typeof query !== 'object') return false;
    if (query.$text) return true;
    if (Array.isArray(query.$and)) return query.$and.some(queryHasText);
    if (Array.isArray(query.$or)) return query.$or.some(queryHasText);
    return false;
}

function parseTokens(filterStr) {
    if (!filterStr || typeof filterStr !== 'string') return [];
    var trimmed = filterStr.trim();
    if (!trimmed) return [];

    var tokens = trimmed.match(/\[\[[^\]\n]+\]\]|[^\s,，、；;]+/g) || [];
    return tokens.map(function (token) {
        var word = token.trim();
        if (word.startsWith('[[') && word.endsWith(']]')) {
            word = word.slice(2, -2).trim();
            if (word.indexOf('|') !== -1) {
                word = word.split('|')[0].trim();
            }
        }
        return word;
    }).filter(Boolean);
}

function buildSearchFilter(filterStr, mode) {
    var words = parseTokens(filterStr);
    if (!words.length) return null;

    var WORD_CHAR_PATTERN = /[a-zA-Z0-9_\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;

    if (mode === 'text') {
        var tagConditions = [];
        var textWords = [];
        words.forEach(function (word) {
            if (word.startsWith('#')) {
                var tag = word.replace(/^#+/, '');
                if (WORD_CHAR_PATTERN.test(tag)) {
                    tagConditions.push({ tags: tag.toLowerCase() });
                }
                return;
            }

            if (!WORD_CHAR_PATTERN.test(word)) {
                return;
            }

            if (word.startsWith('-')) {
                var termAfterHyphen = word.replace(/^-+/, '');
                if (!WORD_CHAR_PATTERN.test(termAfterHyphen)) {
                    return;
                }
            }

            textWords.push(word);
        });

        var conditions = tagConditions.slice();
        if (textWords.length > 0) {
            conditions.push({ $text: { $search: textWords.join(' ') } });
        }
        if (!conditions.length) return null;
        return conditions.length === 1 ? conditions[0] : { $and: conditions };
    }

    var validWords = words.filter(function (word) {
        return WORD_CHAR_PATTERN.test(word);
    });
    if (!validWords.length) return null;

    var wordConditions = validWords.map(function (word) {
        if (word.startsWith('#') && word.length > 1) {
            var tagOnly = word.replace(/^#+/, '');
            if (WORD_CHAR_PATTERN.test(tagOnly)) {
                return { tags: tagOnly.toLowerCase() };
            }
        }
        return {
            $or: [
                { content: { $regex: escapeRegExp(word), $options: 'i' } },
                { tags: word.toLowerCase() }
            ]
        };
    });

    return wordConditions.length === 1 ? wordConditions[0] : { $and: wordConditions };
}

function buildQuery(options) {
    options = options || {};
    var conditions = [options.archived ? { archived: true } : {
        $or: [{ archived: false }, { archived: { $exists: false } }]
    }];
    var searchCondition = buildSearchFilter(options.filter, options.mode);
    if (searchCondition) conditions.push(searchCondition);
    if (options.sticky) conditions.push({ sticky: true });
    return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

module.exports = {
    buildQuery: buildQuery,
    buildSearchFilter: buildSearchFilter,
    escapeRegExp: escapeRegExp,
    parseTokens: parseTokens,
    queryHasText: queryHasText
};
