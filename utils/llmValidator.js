/**
 * utils/llmValidator.js
 * * LLM Output Validator for Cheffy
 * V15.3 - Robust Unit Fallbacks
 */

/**
 * Allowed unit values for qty_unit field
 */
const ALLOWED_UNITS = [
  // Metric weight
  'g', 'gram', 'grams',
  'kg', 'kilogram', 'kilograms',
  
  // Metric volume
  'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
  'l', 'L', 'liter', 'liters', 'litre', 'litres',
  
  // Imperial weight
  'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds',
  
  // Volume measures
  'cup', 'cups',
  'tbsp', 'tablespoon', 'tablespoons',
  'tsp', 'teaspoon', 'teaspoons',
  'fl oz', 'fluid ounce', 'fluid ounces',
  'pint', 'pints',
  'quart', 'quarts',
  'gal', 'gallon', 'gallons',
  
  // Count units
  'piece', 'pieces',
  'slice', 'slices',
  'whole',
  'clove', 'cloves',
  'stalk', 'stalks',
  'sprig', 'sprigs',
  'bunch', 'bunches',
  'head', 'heads',
  'leaf', 'leaves',
  'fillet', 'fillets',
  'breast', 'breasts',
  'thigh', 'thighs',
  'wing', 'wings',
  'rasher', 'rashers',
  'strip', 'strips',
  'can', 'cans',
  'tin', 'tins',
  'jar', 'jars',
  'packet', 'packets',
  'sachet', 'sachets',
  'serve', 'serves', 'serving', 'servings',
  'pinch', 'pinches',
  'dash', 'dashes',
  'handful', 'handfuls',
  'wedge', 'wedges',
  'cube', 'cubes',
  
  // Egg-specific
  'egg', 'eggs',
  'large egg', 'large eggs',
  'medium egg', 'medium eggs',
  'small egg', 'small eggs'
];

/**
 * Normalized unit mapping (maps variations to canonical form)
 */
const UNIT_NORMALIZATION = {
  'gram': 'g',
  'grams': 'g',
  'kilogram': 'kg',
  'kilograms': 'kg',
  'milliliter': 'ml',
  'milliliters': 'ml',
  'millilitre': 'ml',
  'millilitres': 'ml',
  'liter': 'L',
  'liters': 'L',
  'litre': 'L',
  'litres': 'L',
  'l': 'L',
  'ounce': 'oz',
  'ounces': 'oz',
  'pound': 'lb',
  'pounds': 'lb',
  'lbs': 'lb',
  'tablespoon': 'tbsp',
  'tablespoons': 'tbsp',
  'teaspoon': 'tsp',
  'teaspoons': 'tsp',
  'pieces': 'piece',
  'slices': 'slice',
  'cloves': 'clove',
  'stalks': 'stalk',
  'sprigs': 'sprig',
  'bunches': 'bunch',
  'heads': 'head',
  'leaves': 'leaf',
  'fillets': 'fillet',
  'breasts': 'breast',
  'thighs': 'thigh',
  'rashers': 'rasher',
  'strips': 'strip',
  'cans': 'can',
  'tins': 'tin',
  'jars': 'jar',
  'packets': 'packet',
  'sachets': 'sachet',
  'serves': 'serving',
  'servings': 'serving',
  'cups': 'cup',
  'eggs': 'egg',
  'large eggs': 'large egg',
  'medium eggs': 'medium egg',
  'small eggs': 'small egg',
  'pinches': 'pinch',
  'dashes': 'dash',
  'handfuls': 'handful'
};

/**
 * Valid stateHint values
 */
const VALID_STATE_HINTS = ['dry', 'raw', 'cooked', 'as_pack', null, undefined, ''];

/**
 * Valid methodHint values
 */
const VALID_METHOD_HINTS = [
  'boiled', 'fried', 'baked', 'steamed', 'grilled', 'roasted', 
  'sauteed', 'sautéed', 'poached', 'braised', 'pan-fried', 
  'stir-fried', 'deep-fried', 'seared', 'simmered', 'stewed',
  null, undefined, ''
];

/**
 * Valid meal types
 */
const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'morning_snack', 'afternoon_snack', 'evening_snack'];

/**
 * Size descriptors that indicate approximate quantity
 */
const SIZE_DESCRIPTORS = ['small', 'medium', 'large', 'extra large', 'xl', 'jumbo'];

/**
 * Default weights for size-based items (grams)
 */
const SIZE_DEFAULTS = {
  // Eggs
  'small egg': 45,
  'medium egg': 50,
  'large egg': 55,
  'extra large egg': 60,
  
  // Potatoes
  'small potato': 120,
  'medium potato': 170,
  'large potato': 280,
  
  // Onions
  'small onion': 70,
  'medium onion': 110,
  'large onion': 150,
  
  // Tomatoes
  'small tomato': 75,
  'medium tomato': 120,
  'large tomato': 180,
  
  // Generic fallbacks
  'small': 75,
  'medium': 120,
  'large': 180
};

/**
 * Quantity constraints
 */
const QUANTITY_CONSTRAINTS = {
  solid: {
    min: 1,      // 1 gram minimum
    max: 2000,   // 2kg maximum for single item
    unit: 'g'
  },
  liquid: {
    min: 5,      // 5ml minimum
    max: 1000,   // 1L maximum for single item
    unit: 'ml'
  }
};

/**
 * JSON Schema definitions
 */
const SCHEMAS = {
  ITEM_SCHEMA: {
    type: 'object',
    required: ['key', 'qty_value', 'qty_unit'],
    properties: {
      key: { type: 'string', minLength: 1 },
      qty_value: { type: 'number', minimum: 0 },
      qty_unit: { type: 'string' },
      stateHint: { type: ['string', 'null'] },
      methodHint: { type: ['string', 'null'] }
    }
  },
  MEAL_SCHEMA: {
    type: 'object',
    required: ['type', 'name', 'items'],
    properties: {
      type: { type: 'string', enum: VALID_MEAL_TYPES },
      name: { type: 'string', minLength: 1 },
      items: { type: 'array', minItems: 1 }
    }
  },
  MEALS_ARRAY: {
    type: 'array',
    minItems: 1,
    items: { $ref: '#/definitions/MEAL_SCHEMA' }
  },
  GROCERY_QUERY_SCHEMA: {
    type: 'object',
    required: ['normalQuery'],
    properties: {
      normalQuery: { type: 'string', minLength: 1 },
      tightQuery: { type: 'string' },
      requiredWords: { type: 'array', items: { type: 'string' } },
      negativeKeywords: { type: 'array', items: { type: 'string' } },
      allowedCategories: { type: 'array', items: { type: 'string' } }
    }
  }
};

/**
 * Validates a value against a simple type
 */
function validateType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  
  for (const t of types) {
    switch (t) {
      case 'string': if (typeof value === 'string') return true; break;
      case 'number': if (typeof value === 'number' && !isNaN(value)) return true; break;
      case 'boolean': if (typeof value === 'boolean') return true; break;
      case 'array': if (Array.isArray(value)) return true; break;
      case 'object': if (value !== null && typeof value === 'object' && !Array.isArray(value)) return true; break;
      case 'null': if (value === null) return true; break;
    }
  }
  return false;
}

/**
 * Validates an object against a schema
 */
function validateSchema(obj, schema) {
  const errors = [];
  
  if (schema.type) {
    if (schema.type === 'array') {
      if (!Array.isArray(obj)) return [`Expected array, got ${typeof obj}`];
      if (schema.minItems !== undefined && obj.length < schema.minItems) {
        errors.push(`Array must have at least ${schema.minItems} items, got ${obj.length}`);
      }
      if (schema.items && obj.length > 0) {
        obj.forEach((item, index) => {
          const itemErrors = validateSchema(item, schema.items);
          itemErrors.forEach(err => errors.push(`[${index}]: ${err}`));
        });
      }
      return errors;
    }
    
    if (!validateType(obj, schema.type)) {
      return [`Expected ${schema.type}, got ${typeof obj}`];
    }
  }
  
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (obj[field] === undefined || obj[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  if (schema.properties) {
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      const value = obj[field];
      if (value === undefined || value === null) continue;
      
      if (fieldSchema.type && !validateType(value, fieldSchema.type)) {
        errors.push(`Field '${field}': expected ${fieldSchema.type}, got ${typeof value}`);
      }
      
      if (fieldSchema.type === 'string' && typeof value === 'string') {
        if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
          errors.push(`Field '${field}': string must be at least ${fieldSchema.minLength} characters`);
        }
        if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
          errors.push(`Field '${field}': value '${value}' not in allowed values`);
        }
      }
      
      if (fieldSchema.type === 'number' && typeof value === 'number') {
        if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
          errors.push(`Field '${field}': value ${value} is below minimum ${fieldSchema.minimum}`);
        }
      }
    }
  }
  
  return errors;
}

function isLiquidUnit(unit) {
  const liquidUnits = ['ml', 'milliliter', 'milliliters', 'l', 'L', 'liter', 'liters', 'fl oz', 'fluid ounce', 'cup', 'cups', 'tbsp', 'tsp'];
  return liquidUnits.includes(unit?.toLowerCase());
}

function validateQuantityConstraints(item) {
  const errors = [];
  const { qty_value, qty_unit } = item;
  
  if (typeof qty_value !== 'number') {
    errors.push('qty_value must be a number');
    return { valid: false, errors };
  }
  
  if (qty_value <= 0) {
    errors.push(`qty_value must be positive, got ${qty_value}`);
  }
  
  const isLiquid = isLiquidUnit(qty_unit);
  const constraints = isLiquid ? QUANTITY_CONSTRAINTS.liquid : QUANTITY_CONSTRAINTS.solid;
  
  if (['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters'].includes(qty_unit?.toLowerCase())) {
    if (qty_value < constraints.min) {
      errors.push(`qty_value ${qty_value}${constraints.unit} is below minimum ${constraints.min}${constraints.unit}`);
    }
    if (qty_value > constraints.max) {
      errors.push(`qty_value ${qty_value}${constraints.unit} is above maximum ${constraints.max}${constraints.unit}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

function validateStateHint(stateHint) {
  if (!stateHint) return { valid: true, error: null };
  const normalizedState = stateHint.toLowerCase().trim();
  const validStates = ['dry', 'raw', 'cooked', 'as_pack'];
  
  if (!validStates.includes(normalizedState)) {
    return { valid: false, error: `Invalid stateHint '${stateHint}'` };
  }
  return { valid: true, error: null };
}

function validateMethodHint(methodHint) {
  if (!methodHint) return { valid: true, error: null };
  const normalizedMethod = methodHint.toLowerCase().trim();
  const validMethods = VALID_METHOD_HINTS.filter(m => m).map(m => m.toLowerCase());
  
  if (!validMethods.includes(normalizedMethod)) {
    return { valid: false, error: `Invalid methodHint '${methodHint}'` };
  }
  return { valid: true, error: null };
}

/**
 * Validates qty_unit value with enhanced fallback support
 */
function validateUnit(unit) {
  if (!unit || typeof unit !== 'string') {
    return { valid: false, error: 'qty_unit is required and must be a string' };
  }
  
  const normalizedUnit = unit.toLowerCase().trim();
  const allowedLower = ALLOWED_UNITS.map(u => u.toLowerCase());
  
  if (!allowedLower.includes(normalizedUnit)) {
    if (SIZE_DESCRIPTORS.includes(normalizedUnit)) {
      return { valid: false, error: `qty_unit '${unit}' is a size descriptor` };
    }
    // Strict validation fails here, but autocorrect will catch it
    return { valid: false, error: `qty_unit '${unit}' is not in allowed units list` };
  }
  
  return { valid: true, error: null };
}

// --- Autocorrectors ---

function autocorrectQtyValueToNumber(item) {
  if (typeof item.qty_value === 'string') {
    // Handle ranges like "10-12" -> 11
    if (item.qty_value.includes('-')) {
        const parts = item.qty_value.split('-').map(parseFloat);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            const avg = (parts[0] + parts[1]) / 2;
            return {
                corrected: true,
                item: { ...item, qty_value: avg },
                correction: { field: 'qty_value', originalValue: item.qty_value, correctedValue: avg, rule: 'RANGE_TO_NUMBER' }
            };
        }
    }
    
    const parsed = parseFloat(item.qty_value);
    if (!isNaN(parsed)) {
      return {
        corrected: true,
        item: { ...item, qty_value: parsed },
        correction: {
          field: 'qty_value',
          originalValue: item.qty_value,
          correctedValue: parsed,
          rule: 'STRING_TO_NUMBER'
        }
      };
    }
  }
  return { corrected: false, item, correction: null };
}

function autocorrectSizeDescriptor(item) {
  const unit = item.qty_unit?.toLowerCase().trim();
  if (!SIZE_DESCRIPTORS.includes(unit)) {
    return { corrected: false, item, correction: null };
  }
  
  const key = item.key.toLowerCase();
  const sizeKey = `${unit} ${key}`;
  let gramsPerUnit = SIZE_DEFAULTS[sizeKey];
  
  if (!gramsPerUnit) {
    for (const [defaultKey, defaultGrams] of Object.entries(SIZE_DEFAULTS)) {
      if (defaultKey.startsWith(unit + ' ') && key.includes(defaultKey.split(' ').slice(1).join(' '))) {
        gramsPerUnit = defaultGrams;
        break;
      }
    }
  }
  if (!gramsPerUnit) gramsPerUnit = SIZE_DEFAULTS[unit] || 100;
  
  const totalGrams = item.qty_value * gramsPerUnit;
  return {
    corrected: true,
    item: { ...item, qty_value: totalGrams, qty_unit: 'g' },
    correction: {
      field: 'qty_unit',
      originalValue: `${item.qty_value} ${item.qty_unit}`,
      correctedValue: `${totalGrams}g`,
      rule: 'SIZE_DESCRIPTOR_TO_GRAMS',
      details: { gramsPerUnit }
    }
  };
}

function autocorrectNormalizeUnit(item) {
  const unit = item.qty_unit?.toLowerCase().trim();
  const canonical = UNIT_NORMALIZATION[unit];
  
  if (canonical && canonical !== unit) {
    return {
      corrected: true,
      item: { ...item, qty_unit: canonical },
      correction: {
        field: 'qty_unit',
        originalValue: item.qty_unit,
        correctedValue: canonical,
        rule: 'UNIT_NORMALIZATION'
      }
    };
  }
  return { corrected: false, item, correction: null };
}

/**
 * Fallback correction for unknown units
 * Converts unknown units (e.g. "box", "tub", "handful") to "piece"
 * so the pipeline can continue with heuristic weighting.
 */
function autocorrectUnknownUnit(item) {
    const unit = item.qty_unit?.toLowerCase().trim();
    const allowedLower = ALLOWED_UNITS.map(u => u.toLowerCase());
    
    if (unit && !allowedLower.includes(unit)) {
        // Safe fallback: treat as 'piece' (count)
        return {
            corrected: true,
            item: { ...item, qty_unit: 'piece' },
            correction: {
                field: 'qty_unit',
                originalValue: item.qty_unit,
                correctedValue: 'piece',
                rule: 'UNKNOWN_UNIT_FALLBACK'
            }
        };
    }
    return { corrected: false, item, correction: null };
}

function autocorrectStateHint(item) {
  if (!item.stateHint || typeof item.stateHint !== 'string') {
    return { corrected: false, item, correction: null };
  }
  const normalized = item.stateHint.toLowerCase().trim();
  const validStates = ['dry', 'raw', 'cooked', 'as_pack'];
  const stateMapping = {
    'dried': 'dry', 'uncooked': 'raw', 'fresh': 'raw', 'packaged': 'as_pack', 'packed': 'as_pack', 'as-pack': 'as_pack'
  };
  
  let correctedState = stateMapping[normalized] || (validStates.includes(normalized) ? normalized : null);
  
  if (correctedState && correctedState !== item.stateHint) {
    return {
      corrected: true,
      item: { ...item, stateHint: correctedState },
      correction: { field: 'stateHint', originalValue: item.stateHint, correctedValue: correctedState, rule: 'STATE_HINT_NORMALIZATION' }
    };
  }
  
  if (!validStates.includes(normalized) && !correctedState) {
    return {
      corrected: true,
      item: { ...item, stateHint: null },
      correction: { field: 'stateHint', originalValue: item.stateHint, correctedValue: null, rule: 'INVALID_STATE_HINT_CLEARED' }
    };
  }
  return { corrected: false, item, correction: null };
}

function autocorrectMethodHint(item) {
  if (!item.methodHint || typeof item.methodHint !== 'string') {
    return { corrected: false, item, correction: null };
  }
  const normalized = item.methodHint.toLowerCase().trim();
  const validMethods = VALID_METHOD_HINTS.filter(m => m).map(m => m.toLowerCase());
  const methodMapping = {
    'sautéed': 'sauteed', 'pan fried': 'pan-fried', 'stir fried': 'stir-fried', 'deep fried': 'deep-fried', 'bbq': 'grilled', 'barbecued': 'grilled', 'chargrilled': 'grilled'
  };
  
  let correctedMethod = methodMapping[normalized] || (validMethods.includes(normalized) ? normalized : null);
  
  if (correctedMethod && correctedMethod !== item.methodHint) {
    return {
      corrected: true,
      item: { ...item, methodHint: correctedMethod },
      correction: { field: 'methodHint', originalValue: item.methodHint, correctedValue: correctedMethod, rule: 'METHOD_HINT_NORMALIZATION' }
    };
  }
  
  if (!validMethods.includes(normalized) && !correctedMethod) {
    return {
      corrected: true,
      item: { ...item, methodHint: null },
      correction: { field: 'methodHint', originalValue: item.methodHint, correctedValue: null, rule: 'INVALID_METHOD_HINT_CLEARED' }
    };
  }
  return { corrected: false, item, correction: null };
}

function autocorrectQuantityBounds(item) {
  const { qty_value, qty_unit } = item;
  if (typeof qty_value !== 'number') return { corrected: false, item, correction: null };
  if (!['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters'].includes(qty_unit?.toLowerCase())) {
    return { corrected: false, item, correction: null };
  }
  
  const isLiquid = isLiquidUnit(qty_unit);
  const constraints = isLiquid ? QUANTITY_CONSTRAINTS.liquid : QUANTITY_CONSTRAINTS.solid;
  let correctedValue = qty_value;
  let corrected = false;
  
  if (qty_value < constraints.min) { correctedValue = constraints.min; corrected = true; }
  else if (qty_value > constraints.max) { correctedValue = constraints.max; corrected = true; }
  
  if (corrected) {
    return {
      corrected: true,
      item: { ...item, qty_value: correctedValue },
      correction: {
        field: 'qty_value',
        originalValue: qty_value,
        correctedValue: correctedValue,
        rule: 'QUANTITY_BOUNDS_CLAMPED',
        details: { min: constraints.min, max: constraints.max }
      }
    };
  }
  return { corrected: false, item, correction: null };
}

function applyItemAutocorrections(item) {
  let currentItem = { ...item };
  const corrections = [];
  
  const correctors = [
    autocorrectQtyValueToNumber,
    autocorrectSizeDescriptor,
    autocorrectNormalizeUnit,
    autocorrectUnknownUnit, // Add the fallback corrector
    autocorrectStateHint,
    autocorrectMethodHint,
    autocorrectQuantityBounds
  ];
  
  for (const corrector of correctors) {
    const result = corrector(currentItem);
    if (result.corrected) {
      currentItem = result.item;
      corrections.push(result.correction);
    }
  }
  return { item: currentItem, corrections };
}

function validateItemConstraints(item) {
  const errors = [];
  const unitValidation = validateUnit(item.qty_unit);
  if (!unitValidation.valid) errors.push(unitValidation.error);
  
  const qtyValidation = validateQuantityConstraints(item);
  errors.push(...qtyValidation.errors);
  
  const stateValidation = validateStateHint(item.stateHint);
  if (!stateValidation.valid) errors.push(stateValidation.error);
  
  const methodValidation = validateMethodHint(item.methodHint);
  if (!methodValidation.valid) errors.push(methodValidation.error);
  
  return { valid: errors.length === 0, errors };
}

function validateLLMOutput(output, schemaName) {
  const result = { valid: true, errors: [], corrections: [], correctedOutput: null };
  const schema = SCHEMAS[schemaName];
  if (!schema) { result.valid = false; result.errors.push(`Unknown schema: ${schemaName}`); return result; }
  if (output === null || output === undefined) { result.valid = false; result.errors.push('Output is null'); return result; }
  
  const schemaErrors = validateSchema(output, schema);
  if (schemaErrors.length > 0) { result.valid = false; result.errors.push(...schemaErrors); }
  
  let correctedOutput = output;
  
  if (schemaName === 'MEALS_ARRAY' && Array.isArray(output)) {
    correctedOutput = [];
    for (const meal of output) {
      if (!meal || typeof meal !== 'object') { correctedOutput.push(meal); continue; }
      const correctedMeal = { ...meal };
      if (Array.isArray(meal.items)) {
        correctedMeal.items = [];
        for (const item of meal.items) {
          if (!item || typeof item !== 'object') { correctedMeal.items.push(item); continue; }
          const { item: correctedItem, corrections } = applyItemAutocorrections(item);
          result.corrections.push(...corrections);
          const constraintValidation = validateItemConstraints(correctedItem);
          if (!constraintValidation.valid) {
            result.errors.push(...constraintValidation.errors.map(e => `Item '${correctedItem.key}': ${e}`));
          }
          correctedMeal.items.push(correctedItem);
        }
      }
      correctedOutput.push(correctedMeal);
    }
  }
  
  result.correctedOutput = correctedOutput;
  result.valid = result.errors.length === 0;
  return result;
}

function validateGroceryQuery(query) {
  const result = validateLLMOutput(query, 'GROCERY_QUERY_SCHEMA');
  if (query.normalQuery && query.normalQuery.length < 2) { result.valid = false; result.errors.push('normalQuery too short'); }
  return result;
}

module.exports = {
  validateLLMOutput,
  validateGroceryQuery,
  validateItemConstraints,
  validateQuantityConstraints,
  validateStateHint,
  validateMethodHint,
  validateUnit,
  applyItemAutocorrections,
  SCHEMAS,
  ALLOWED_UNITS,
  VALID_STATE_HINTS,
  VALID_METHOD_HINTS,
  VALID_MEAL_TYPES,
  SIZE_DESCRIPTORS,
  SIZE_DEFAULTS,
  QUANTITY_CONSTRAINTS,
  UNIT_NORMALIZATION
};

