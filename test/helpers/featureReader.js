'use strict';

// A reader over features given as { path: properties }, like the one FeatureMapper gives a
// derived capability (config/*.js → DERIVED).
const featureReader = (features) => (path, propertyPath) => propertyPath.split('.')
  .reduce((node, part) => node?.[part], features[path]);

module.exports = { featureReader };
