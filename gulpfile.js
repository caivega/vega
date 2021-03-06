var gulp = require('gulp'),
    browserify = require('browserify'),
    buffer = require('vinyl-buffer'),
    rename = require('gulp-rename'),
    source = require('vinyl-source-stream'),
    sourcemaps = require('gulp-sourcemaps'),
    uglify = require('gulp-uglify'),
    watchify = require('watchify'),
    gutil = require('gulp-util'),
    mocha = require('gulp-spawn-mocha');

function browser() {
  return browserify({
      entries: ['./src/'],
      standalone: 'vg',
      debug: true,
      cache: {}, packageCache: {}
    })
    .external(['d3', 'topojson']); 
}

function watcher() {
  return watchify(browser());
}

function build(b) {
  return b.bundle()
    // log errors if they happen
    .on('error', gutil.log.bind(gutil, 'Browserify Error'))
    .pipe(source('vega2.js'))
    .pipe(buffer())
    .pipe(gulp.dest('.'))
    .pipe(sourcemaps.init({loadMaps: true}))
    // This will minify and rename to vegalite.min.js
    .pipe(uglify())
    .pipe(rename({ extname: '.min.js' }))
    .pipe(sourcemaps.write('./'))
    .pipe(gulp.dest('.')); 
}

gulp.task('build', function() { 
  build(browser()); 
});

gulp.task('watch', function() { 
  var b = watcher();
  b.on('update', function() { build(b) });
  b.on('log', gutil.log); // output build logs to terminal
  build(b); 
});

gulp.task('test', function() {
  return gulp.src(['test/**/*.js'], { read: false })
    .pipe(mocha())
    .on('error', gutil.log);
});

gulp.task('default', ['test', 'build']);