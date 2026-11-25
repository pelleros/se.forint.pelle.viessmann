'use strict';

const { FEATURES } = require('./config');

// The roles that FEATURES entries can require (type:heatpump, type:boiler)
const ROLE_TAGS = [...new Set(Object.values(FEATURES).map(({ requireRole }) => requireRole).filter(Boolean))];

// Some devices report none of these roles (e.g. newer heat pumps); for them, a role is inferred
// from the features: a compressor makes a heat pump, a burner a boiler.
const INFERRED_ROLES = [
  { role: 'type:heatpump', list: 'heating.compressors', item: /^heating\.compressors\.\d+$/ },
  { role: 'type:boiler', list: 'heating.burners', item: /^heating\.burners\.\d+$/ },
];

/**
 * Roles inferred from features.
 * @param {string[]} featureNames the device's stored (enabled) features
 * @param {object[]} [featureData] feature objects of a response, e.g. `heating.compressors`
 *   whose `enabled` property lists the compressors
 * @returns {string[]}
 */
function inferRoles(featureNames = [], featureData = []) {
  const names = Array.isArray(featureNames) ? featureNames.filter((name) => typeof name === 'string') : [];
  const data = Array.isArray(featureData) ? featureData : [];
  return INFERRED_ROLES.filter(({ list, item }) => names.some((name) => item.test(name))
    || data.some((feature) => feature?.feature === list && feature.isEnabled
      && Array.isArray(feature.properties?.enabled?.value) && feature.properties.enabled.value.length > 0))
    .map(({ role }) => role);
}

// Other roles that count as a role FEATURES can require, e.g. type:dhwHeatpump for a hot
// water heat pump. Only the role's type name (before any ';') is matched.
const ROLE_ALIASES = [
  { role: 'type:heatpump', pattern: /^type:[^;]*heatpump/i },
];

// The roles that ROLE_ALIASES add for the given roles
function aliasRoles(roles) {
  return ROLE_ALIASES.filter(({ pattern }) => roles.some((role) => pattern.test(role))).map(({ role }) => role);
}

// True when the roles say what the device is (contain a role that FEATURES can require)
function hasRoleTags(roles) {
  return Array.isArray(roles) && roles.some((role) => ROLE_TAGS.includes(role));
}

/**
 * The roles to check `requireRole` against: the stored roles plus the roles their aliases
 * stand for, and, when the stored roles contain no role that FEATURES can require, the
 * inferred ones. Both only ever add roles.
 * @param {string[]} storedRoles roles from the installation list (stored at pairing)
 * @param {string[]} inferred roles from inferRoles()
 * @returns {string[]}
 */
function effectiveRoles(storedRoles, inferred = []) {
  const roles = Array.isArray(storedRoles) ? storedRoles.filter((role) => typeof role === 'string') : [];
  return [...new Set([...roles, ...aliasRoles(roles), ...(hasRoleTags(roles) ? [] : inferred)])];
}

module.exports = {
  ROLE_TAGS, inferRoles, hasRoleTags, effectiveRoles,
};
