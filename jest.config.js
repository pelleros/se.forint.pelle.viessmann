'use strict';

module.exports = {
  // Ignore build output and nested Claude Code worktrees (full copies of this repo
  // under .claude/worktrees/) so their tests and package.json files are not picked up.
  modulePathIgnorePatterns: ['<rootDir>/.homeybuild/', '<rootDir>/.claude/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.homeybuild/', '<rootDir>/.claude/'],
  // Enforced by `npm run test:coverage` (CI), a little below the coverage when it was set
  // (82 % statements and lines, 78 % branches, 87 % functions). Raise it when coverage grows;
  // lower it only with a reason in the pull request.
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      functions: 84,
      lines: 80,
    },
  },
};
