'use strict';

var autoprefixer = require('gulp-autoprefixer'),
    argv = require('yargs').argv,
    fs = require('fs'),
    ejs = require('gulp-ejs'),
    gulp = require('gulp'),
    minifycss = require('gulp-cssnano'),
    rename = require('gulp-rename'),
    sass = require('gulp-sass')(require('sass')),
    sourcemaps = require('gulp-sourcemaps');

if (argv.help || argv.h) {
    console.log('Supported arguments:');
    console.log(' --revision <revision>');

    process.exit(1);
}

var revision = argv.revision || '';

console.log();
console.log('Building for revision: %s', revision);
console.log();

function buildCss() {
    return gulp.src('frontend/scss/index.scss')
        .pipe(sourcemaps.init())
        .pipe(sass({ includePaths: [] }).on('error', sass.logError))
        .pipe(autoprefixer('last 2 version', 'safari 5', 'ie 8', 'ie 9', 'opera 12.1', 'ios 6', 'android 4'))
        .pipe(rename({suffix: '.min'}))
        .pipe(minifycss())
        .pipe(sourcemaps.write())
        .pipe(gulp.dest('public/'));
}

function buildJavascript() {
    return gulp.src('frontend/js/*.js').pipe(gulp.dest('public/js/'));
}

function buildHtml() {
    return gulp.src('frontend/*.html')
        .pipe(ejs({ revision: revision }).on('error', console.error))
        .pipe(gulp.dest('public/'));
}

function buildFavicon() {
    return gulp.src('frontend/favicon.png')
        .pipe(gulp.dest('public/'));
}

var build3rdParty = gulp.series(
    function build3rdPartyFromNodeModules() {
        return gulp.src([
            'node_modules/superagent/dist/superagent.js',
            'node_modules/vue/dist/vue.min.js',
            'node_modules/markdown-it/dist/markdown-it.min.js',
            'node_modules/markdown-it-emoji/dist/markdown-it-emoji.min.js'
        ]).pipe(gulp.dest('public/3rdparty/js/'));
    },
    function build3rdPartyFromFrontend() {
        return gulp.src([
            'node_modules/jquery/dist/*.min.js*',
            'frontend/3rdparty/**/*.min.css*',
            'frontend/3rdparty/**/*.min.js*',
            'frontend/3rdparty/**/*.js*',
            'frontend/3rdparty/**/*.otf',
            'frontend/3rdparty/**/*.svg',
            'frontend/3rdparty/**/*.ttf',
            'frontend/3rdparty/**/*.woff*',
        ]).pipe(gulp.dest('public/3rdparty/'));
    }
);

gulp.task('clean', async function () {
    fs.rmSync('public/', { recursive: true, force: true });
});

gulp.task('default', gulp.series('clean', buildHtml, buildFavicon, buildCss, buildJavascript, build3rdParty, function defaultTask(done) {
    done();
}));

function watchCss() {
    return gulp.watch('frontend/scss/*.scss', buildCss);
}

function watchJavascript() {
    return gulp.watch('frontend/js/*.js', buildJavascript);
}

function watchHtml() {
    return gulp.watch(['frontend/*.html', 'frontend/templates/*'], gulp.series('default'));
}

gulp.task('develop', gulp.series('default', gulp.parallel(watchCss, watchJavascript, watchHtml)));
