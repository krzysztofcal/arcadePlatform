#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(projectRoot, 'js', 'games.schema.json');
const dataPath = path.join(projectRoot, 'js', 'games.json');

function readJson(filePath){
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}

const schema = readJson(schemaPath);
const data = readJson(dataPath);

class ValidationError extends Error {
  constructor(pathLabel, message){
    super(`${pathLabel}: ${message}`);
    this.name = 'ValidationError';
    this.path = pathLabel;
  }
}

function decodePointerFragment(fragment){
  return fragment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveRef(ref, root){
  if (typeof ref !== 'string' || !ref.startsWith('#/')){
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const parts = ref.slice(2).split('/').map(decodePointerFragment);
  let current = root;
  for (const part of parts){
    if (current && Object.prototype.hasOwnProperty.call(current, part)){
      current = current[part];
    } else {
      throw new Error(`Unresolved $ref: ${ref}`);
    }
  }
  return current;
}

function deepEqual(a, b){
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateType(value, schema, pathLabel){
  if (!schema || typeof schema !== 'object') return;
  const expected = schema.type;
  if (!expected) return;
  if (Array.isArray(expected)){
    if (expected.some(type => checkType(value, type))) return;
    throw new ValidationError(pathLabel, `expected type ${expected.join(' or ')}`);
  }
  if (!checkType(value, expected)){
    throw new ValidationError(pathLabel, `expected type ${expected}`);
  }
}

function checkType(value, type){
  switch (type){
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: return false;
  }
}

function testSchema(value, schemaNode, pathLabel){
  try {
    validateSchema(value, schemaNode, pathLabel);
    return true;
  } catch (err){
    if (err instanceof ValidationError) return false;
    throw err;
  }
}

function validateSchema(value, schemaNode, pathLabel){
  if (schemaNode === true) return;
  if (schemaNode === false) throw new ValidationError(pathLabel, 'value not permitted');
  if (!schemaNode || typeof schemaNode !== 'object') return;

  if (schemaNode.$ref){
    const refSchema = resolveRef(schemaNode.$ref, schema);
    return validateSchema(value, refSchema, pathLabel);
  }

  validateType(value, schemaNode, pathLabel);

  if (Object.prototype.hasOwnProperty.call(schemaNode, 'const')){
    if (!deepEqual(value, schemaNode.const)){
      throw new ValidationError(pathLabel, `must equal ${JSON.stringify(schemaNode.const)}`);
    }
  }

  if (Array.isArray(schemaNode.enum)){
    const matched = schemaNode.enum.some(option => deepEqual(option, value));
    if (!matched){
      throw new ValidationError(pathLabel, `must be one of ${JSON.stringify(schemaNode.enum)}`);
    }
  }

  if (typeof schemaNode.minLength === 'number'){
    if (typeof value !== 'string'){
      throw new ValidationError(pathLabel, 'expected string for minLength constraint');
    }
    if (value.length < schemaNode.minLength){
      throw new ValidationError(pathLabel, `string shorter than ${schemaNode.minLength}`);
    }
  }

  if (schemaNode.type === 'object' || schemaNode.properties || schemaNode.required || schemaNode.additionalProperties !== undefined){
    if (!checkType(value, 'object')){
      throw new ValidationError(pathLabel, 'expected object');
    }
    const obj = value;
    const properties = schemaNode.properties || {};
    if (Array.isArray(schemaNode.required)){
      for (const key of schemaNode.required){
        if (!Object.prototype.hasOwnProperty.call(obj, key)){
          throw new ValidationError(`${pathLabel}.${key}`, 'is required');
        }
      }
    }
    if (schemaNode.additionalProperties === false){
      for (const key of Object.keys(obj)){
        if (!Object.prototype.hasOwnProperty.call(properties, key)){
          throw new ValidationError(`${pathLabel}.${key}`, 'is not allowed');
        }
      }
    }
    for (const [key, subSchema] of Object.entries(properties)){
      if (Object.prototype.hasOwnProperty.call(obj, key)){
        validateSchema(obj[key], subSchema, `${pathLabel}.${key}`);
      }
    }
  }

  if (schemaNode.type === 'array' || schemaNode.items){
    if (!Array.isArray(value)){
      throw new ValidationError(pathLabel, 'expected array');
    }
    if (schemaNode.items){
      value.forEach((item, index) => {
        validateSchema(item, schemaNode.items, `${pathLabel}[${index}]`);
      });
    }
  }

  if (Array.isArray(schemaNode.allOf)){
    schemaNode.allOf.forEach((subSchema) => {
      validateSchema(value, subSchema, pathLabel);
    });
  }

  if (schemaNode.if){
    const matches = testSchema(value, schemaNode.if, pathLabel);
    if (matches){
      if (schemaNode.then){
        validateSchema(value, schemaNode.then, pathLabel);
      }
    } else if (schemaNode.else){
      validateSchema(value, schemaNode.else, pathLabel);
    }
  }
}

try {
  validateSchema(data, schema, 'root');
} catch (err){
  if (err instanceof ValidationError){
    console.error(`games.json validation failed: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

console.log('games.json validation succeeded.');
