'use strict';

var settings = require('../database/settings.js');

module.exports = {
    get: settings.get,
    save: settings.put
};
