'use strict';

module.exports = {
  // Ignore build output and nested Claude Code worktrees (full copies of this repo
  // under .claude/worktrees/) so their tests and package.json files are not picked up.
  modulePathIgnorePatterns: ['<rootDir>/.homeybuild/', '<rootDir>/.claude/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.homeybuild/', '<rootDir>/.claude/'],
};
