'use strict';

var NOTE_COLORS = [
    'default',
    'coral',
    'peach',
    'sand',
    'mint',
    'sage',
    'fog',
    'storm',
    'dusk',
    'blossom',
    'clay',
    'chalk'
];

function isValidNoteColor(color) {
    return NOTE_COLORS.indexOf(color) !== -1;
}

function invalidNoteColorError() {
    var error = new TypeError('Invalid note color');
    error.code = 'ERR_INVALID_NOTE_COLOR';
    return error;
}

function normalizeNoteColor(color) {
    if (color === undefined) return 'default';
    if (!isValidNoteColor(color)) throw invalidNoteColorError();
    return color;
}

module.exports = {
    NOTE_COLORS: NOTE_COLORS,
    isValidNoteColor: isValidNoteColor,
    invalidNoteColorError: invalidNoteColorError,
    normalizeNoteColor: normalizeNoteColor
};
