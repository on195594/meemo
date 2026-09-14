'use strict';

function escapeRegExp(value) {
    return value.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function buildSearchFilter(filterStr) {
    if (!filterStr || typeof filterStr !== 'string') return null;
    var trimmed = filterStr.trim();
    if (!trimmed) return null;

    var words = trimmed.split(/\s+/).filter(Boolean);
    if (!words.length) return null;

    var wordConditions = words.map(function (word) {
        if (word.startsWith('#') && word.length > 1) return { tags: word.slice(1).toLowerCase() };
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
    var searchCondition = buildSearchFilter(options.filter);
    if (searchCondition) conditions.push(searchCondition);
    if (options.sticky) conditions.push({ sticky: true });
    return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

module.exports = {
    buildQuery: buildQuery,
    buildSearchFilter: buildSearchFilter,
    escapeRegExp: escapeRegExp
};
