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

    var tokens = trimmed.match(/"[^"]+"|\[\[[^\]\n]+\]\]|[^\s,，、；;]+/g) || [];
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

function sanitizeTextQuery(textWords) {
    var raw = textWords.join(' ');
    var quoteCount = (raw.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
        raw = raw.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return raw;
}

/**
 * Builds a MongoDB query filter from a user query string.
 *
 * Search Mode Contracts:
 * - 'regex' (default):
 *   Conjunctive matching ($and). Each token must be present in either note content
 *   (case-insensitive regex) or tags. Quoted phrases ("phrase here") match literal continuous substrings.
 *
 * - 'text':
 *   Full-text index matching using MongoDB $text and English Porter stemming.
 *   Unquoted words are evaluated as relevance-ranked search terms (OR disjunction with TF-IDF weights,
 *   ranking notes with more match occurrences higher via textScore).
 *   Quoted phrases (e.g. "benchmark project") enforce exact phrase containment.
 *   Tags (#work) are conjunctive ($and) with the full-text search condition.
 */
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
            var searchStr = sanitizeTextQuery(textWords);
            if (searchStr && WORD_CHAR_PATTERN.test(searchStr)) {
                conditions.push({ $text: { $search: searchStr } });
            }
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
        var pattern = word;
        if (pattern.startsWith('"') && pattern.endsWith('"') && pattern.length >= 2) {
            pattern = pattern.slice(1, -1);
        } else {
            pattern = pattern.replace(/^"+|"+$/g, '');
        }
        return {
            $or: [
                { content: { $regex: escapeRegExp(pattern), $options: 'i' } },
                { tags: pattern.toLowerCase() }
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
