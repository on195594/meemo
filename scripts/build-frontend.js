'use strict';

var child_process = require('child_process'),
    fs = require('fs'),
    path = require('path');

var rootDir = path.resolve(__dirname, '..'),
    webDir = path.join(rootDir, 'web'),
    publicDir = path.join(rootDir, 'public'),
    distDir = path.join(webDir, 'dist');

if (!fs.existsSync(path.join(webDir, 'node_modules'))) {
    console.log('Installing web dependencies (npm ci)...');
    child_process.execSync('npm ci', { cwd: webDir, stdio: 'inherit' });
}

console.log('Building Vue 3 web frontend (Vite)...');
child_process.execSync('npm run build', { cwd: webDir, stdio: 'inherit' });

console.log('Syncing dist to public/...');
fs.rmSync(publicDir, { recursive: true, force: true });
fs.cpSync(distDir, publicDir, { recursive: true });

console.log('Frontend build successfully completed.');
