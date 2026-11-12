'use strict';

function validateCommand(metadata, feature, command, body) {
  if (!metadata) return; // Compatibility while older devices refresh their metadata.
  const descriptor = metadata[feature]?.[command];
  if (!descriptor) throw new Error(`Command ${command} is not supported by ${feature}`);
  if (descriptor.isExecutable === false) throw new Error(`Command ${command} is currently unavailable for ${feature}`);
  for (const [name, parameter] of Object.entries(descriptor.params || {})) {
    const value = body[name];
    if (value === undefined) {
      if (parameter.required) throw new Error(`Missing required parameter: ${name}`);
      continue;
    }
    const constraints = parameter.constraints || {};
    if ((parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
      || (parameter.type === 'string' && typeof value !== 'string')
      || (parameter.type === 'boolean' && typeof value !== 'boolean')) {
      throw new Error(`Invalid type for ${name}`);
    }
    if (constraints.enum && !constraints.enum.includes(value)) throw new Error(`Unsupported value for ${name}: ${value}`);
    if ((constraints.min !== undefined && value < constraints.min)
      || (constraints.max !== undefined && value > constraints.max)) throw new Error(`${name} is outside the supported range`);
    if (constraints.stepping && typeof value === 'number') {
      const steps = (value - (constraints.min || 0)) / constraints.stepping;
      if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error(`${name} must use steps of ${constraints.stepping}`);
    }
    if ((constraints.minLength !== undefined && value.length < constraints.minLength)
      || (constraints.maxLength !== undefined && value.length > constraints.maxLength)) throw new Error(`Invalid length for ${name}`);
  }
}

module.exports = validateCommand;
