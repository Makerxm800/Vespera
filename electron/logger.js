/**
 * Vespera logger — writes timestamped logs to a file the user can actually
 * find and read:  <userData>/logs/vespera.log
 *
 * Everything important (startup steps, service port, errors with stack
 * traces, crash events) goes here — so "the app does nothing" always has a
 * visible explanation.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

let logDir = null;
let logFile = null;

function init(dir) {
  logDir = dir;
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, 'vespera.log');
  // Rotate: keep previous run as vespera.old.log
  try {
    if (fs.existsSync(logFile)) fs.renameSync(logFile, path.join(logDir, 'vespera.old.log'));
  } catch { /* best effort */ }
  return logFile;
}

function line(level, msg) {
  const ts = new Date().toISOString();
  const text = `[${ts}] [${level}] ${msg}`;
  console[level === 'ERROR' ? 'error' : 'log'](text);
  if (logFile) {
    try { fs.appendFileSync(logFile, text + '\n'); } catch { /* disk trouble — console still has it */ }
  }
}

const info = (msg) => line('INFO', msg);
const warn = (msg) => line('WARN', msg);
const error = (msg, err) => {
  line('ERROR', err ? `${msg}\n${err.stack || err}` : msg);
};

/** Tail of the log for the in-app log viewer. */
function readTail(maxLines = 300) {
  try {
    const text = fs.readFileSync(logFile, 'utf8');
    return text.split('\n').slice(-maxLines).join('\n');
  } catch {
    return '(log file not created yet)';
  }
}

function getLogDir() { return logDir; }
function getLogFile() { return logFile; }

module.exports = { init, info, warn, error, readTail, getLogDir, getLogFile };
