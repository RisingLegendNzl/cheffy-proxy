/**
 * utils/llmValidator.js
 * 
 * LLM Output Validator for Cheffy
 * 
 * PURPOSE:
 * Validates all LLM outputs against JSON schemas before pipeline processing.
 * Implements constraint validation, auto-correction rules, and structured
 * error reporting.
 * 
 * PLAN REFERENCE: Steps D1, D2, D3
 * - D1: Create LLM Output Validator
 * - D2: Implement Constraint Validation
 * - D3: Implement Auto-Correction Rules
 * 
 * DESIGN PRINCIPLES:
 * 1. Fail fast - invalid output triggers retry
 * 2. Auto-correct known issues deterministically
 * 3. Every correction is logged for auditability
 * 4. Schema validation before constraint validation
 * 
 * ASSUMPTIONS:
 * - LLM outputs are JavaScript objects (parsed JSON)
 * - Auto-corrections are safe and deterministic
 * - Unknown fields are allowed (lenient parsing)
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
  'rasher', 'rashers',
  'strip', 'strips',
  'can', 'cans',
  'tin', 'tins',
  'jar', 'jars',
  'packet', 'packets',
  'sachet', 'sachets',
  'serve', 'serves', 'serving', 'servings',
  
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
  'small eggs': 'small egg'
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
  'stir-fried', 'deep-fried', null, undefined, ''
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
  
  // Carrots
  'small carrot': 50,
  'medium carrot': 70,
  'large carrot': 100,
  
  // Apples
  'small apple': 100,
  'medium apple': 150,
  'large apple': 200,
  
  // Bananas
  'small banana': 80,
  'medium banana': 120,
  'large banana': 150,
  
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
  /**
   * Schema for a single item within a meal
   */
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
  
  /**
   * Schema for a single meal
   */
  MEAL_SCHEMA: {
    type: 'object',
    required: ['type', 'name', 'items'],
    properties: {
      type: { type: 'string', enum: VALID_MEAL_TYPES },
      name: { type: 'string', minLength: 1 },
      items: { type: 'array', minItems: 1 }
    }
  },
  
  /**
   * Schema for array of meals
   */
  MEALS_ARRAY: {
    type: 'array',
    minItems: 1,
    items: { $ref: '#/definitions/MEAL_SCHEMA' }
  },
  
  /**
   * Schema for grocery query object
   */
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
 * 
 * @param {*} value - Value to validate
 * @param {string|Array} type - Expected type(s)
 * @returns {boolean} True if valid
 */
function validateType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  
  for (const t of types) {
    switch (t) {
      case 'string':
        if (typeof value === 'string') return true;
        break;
      case 'number':
        if (typeof value === 'number' && !isNaN(value)) return true;
        break;
      case 'boolean':
        if (typeof value === 'boolean') return true;
        break;
      case 'array':
        if (Array.isArray(value)) return true;
        break;
      case 'object':
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) return true;
        break;
      case 'null':
        if (value === null) return true;
        break;
    }
  }
  
  return false;
}

/**
 * Validates an object against a schema
 * 
 * @param {Object} obj - Object to validate
 * @param {Object} schema - Schema definition
 * @returns {Array} Array of error messages
 */
function validateSchema(obj, schema) {
  const errors = [];
  
  // Type check
  if (schema.type) {
    if (schema.type === 'array') {
      if (!Array.isArray(obj)) {
        errors.push(`Expected array, got ${typeof obj}`);
        return errors;
      }
      
      // Validate array constraints
      if (schema.minItems !== undefined && obj.length < schema.minItems) {
        errors.push(`Array must have at least ${schema.minItems} items, got ${obj.length}`);
      }
      
      // Validate array items
      if (schema.items && obj.length > 0) {
        obj.forEach((item, index) => {
          const itemErrors = validateSchema(item, schema.items);
          itemErrors.forEach(err => errors.push(`[${index}]: ${err}`));
        });
      }
      
      return errors;
    }
    
    if (!validateType(obj, schema.type)) {
      errors.push(`Expected ${schema.type}, got ${typeof obj}`);
      return errors;
    }
  }
  
  // Required fields check
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (obj[field] === undefined || obj[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  // Property validation
  if (schema.properties) {
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      const value = obj[field];
      
      if (value === undefined || value === null) continue; // Skip optional fields
      
      // Type validation
      if (fieldSchema.type && !validateType(value, fieldSchema.type)) {
        errors.push(`Field '${field}': expected ${fieldSchema.type}, got ${typeof value}`);
      }
      
      // String constraints
      if (fieldSchema.type === 'string' || (Array.isArray(fieldSchema.type) && fieldSchema.type.includes('string'))) {
        if (typeof value === 'string') {
          if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
            errors.push(`Field '${field}': string must be at least ${fieldSchema.minLength} characters`);
          }
          if (fieldSchema.maxLength !== undefined && value.length > fieldSchema.maxLength) {
            errors.push(`Field '${field}': string must be at most ${fieldSchema.maxLength} characters`);
          }
          if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
            errors.push(`Field '${field}': value '${value}' not in allowed values [${fieldSchema.enum.join(', ')}]`);
          }
        }
      }
      
      // Number constraints
      if (fieldSchema.type === 'number' && typeof value === 'number') {
        if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
          errors.push(`Field '${field}': value ${value} is below minimum ${fieldSchema.minimum}`);
        }
        if (fieldSchema.maximum !== undefined && value > fieldSchema.maximum) {
          errors.push(`Field '${field}': value ${value} is above maximum ${fieldSchema.maximum}`);
        }
      }
      
      // Array constraints
      if (fieldSchema.type === 'array' && Array.isArray(value)) {
        if (fieldSchema.minItems !== undefined && value.length < fieldSchema.minItems) {
          errors.push(`Field '${field}': array must have at least ${fieldSchema.minItems} items`);
        }
      }
    }
  }
  
  return errors;
}

/**
 * Checks if a unit is liquid-based
 * 
 * @param {string} unit - Unit to check
 * @returns {boolean} True if liquid unit
 */
function isLiquidUnit(unit) {
  const liquidUnits = ['ml', 'milliliter', 'milliliters', 'l', 'L', 'liter', 'liters', 'fl oz', 'fluid ounce', 'cup', 'cups', 'tbsp', 'tsp'];
  return liquidUnits.includes(unit?.toLowerCase());
}

/**
 * Validates quantity constraints for an item
 * 
 * @param {Object} item - Item with qty_value and qty_unit
 * @returns {Object} { valid: boolean, errors: array }
 */
function validateQuantityConstraints(item) {
  const errors = [];
  const { qty_value, qty_unit } = item;
  
  if (typeof qty_value !== 'number') {
    errors.push('qty_value must be a number');
    return { valid: false, errors };
  }
  
  // Check positive
  if (qty_value <= 0) {
    errors.push(`qty_value must be positive, got ${qty_value}`);
  }
  
  // Check bounds based on unit type
  const isLiquid = isLiquidUnit(qty_unit);
  const constraints = isLiquid ? QUANTITY_CONSTRAINTS.liquid : QUANTITY_CONSTRAINTS.solid;
  
  // Only apply gram/ml bounds for those specific units
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

/**
 * Validates stateHint value
 * 
 * @param {string|null} stateHint - State hint to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateStateHint(stateHint) {
  if (stateHint === null || stateHint === undefined || stateHint === '') {
    return { valid: true, error: null };
  }
  
  const normalizedState = stateHint.toLowerCase().trim();
  const validStates = ['dry', 'raw', 'cooked', 'as_pack'];
  
  if (!validStates.includes(normalizedState)) {
    return { valid: false, error: `Invalid stateHint '${stateHint}', must be one of: ${validStates.join(', ')}` };
  }
  
  return { valid: true, error: null };
}

/**
 * Validates methodHint value
 * 
 * @param {string|null} methodHint - Method hint to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateMethodHint(methodHint) {
  if (methodHint === null || methodHint === undefined || methodHint === '') {
    return { valid: true, error: null };
  }
  
  const normalizedMethod = methodHint.toLowerCase().trim();
  const validMethods = ['boiled', 'fried', 'baked', 'steamed', 'grilled', 'roasted', 'sauteed', 'poached', 'braised', 'pan-fried', 'stir-fried', 'deep-fried'];
  
  if (!validMethods.includes(normalizedMethod)) {
    return { valid: false, error: `Invalid methodHint '${methodHint}', must be one of: ${validMethods.join(', ')}` };
  }
  
  return { valid: true, error: null };
}

/**
 * Validates qty_unit value
 * 
 * @param {string} unit - Unit to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateUnit(unit) {
  if (!unit || typeof unit !== 'string') {
    return { valid: false, error: 'qty_unit is required and must be a string' };
  }
  
  const normalizedUnit = unit.toLowerCase().trim();
  const allowedLower = ALLOWED_UNITS.map(u => u.toLowerCase());
  
  if (!allowedLower.includes(normalizedUnit)) {
    // Check if it's a size descriptor (handled by auto-correction)
    if (SIZE_DESCRIPTORS.includes(normalizedUnit)) {
      return { valid: false, error: `qty_unit '${unit}' is a size descriptor, not a unit. Will be auto-corrected.` };
    }
    return { valid: false, error: `qty_unit '${unit}' is not in allowed units list` };
  }
  
  return { valid: true, error: null };
}

/**
 * Auto-correction: Parse string qty_value to number
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { corrected: boolean, item: Object, correction: Object|null }
 */
function autocorrectQtyValueToNumber(item) {
  if (typeof item.qty_value === 'string') {
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

/**
 * Auto-correction: Handle size descriptors as units
 * Converts "2 medium" to actual grams based on item key
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { corrected: boolean, item: Object, correction: Object|null }
 */
function autocorrectSizeDescriptor(item) {
  const unit = item.qty_unit?.toLowerCase().trim();
  
  if (!SIZE_DESCRIPTORS.includes(unit)) {
    return { corrected: false, item, correction: null };
  }
  
  // Try to find specific size for this item
  const key = item.key.toLowerCase();
  const sizeKey = `${unit} ${key}`;
  
  // Look for specific size default
  let gramsPerUnit = SIZE_DEFAULTS[sizeKey];
  
  // Try partial matches
  if (!gramsPerUnit) {
    for (const [defaultKey, defaultGrams] of Object.entries(SIZE_DEFAULTS)) {
      if (defaultKey.startsWith(unit + ' ') && key.includes(defaultKey.split(' ').slice(1).join(' '))) {
        gramsPerUnit = defaultGrams;
        break;
      }
    }
  }
  
  // Fall back to generic size default
  if (!gramsPerUnit) {
    gramsPerUnit = SIZE_DEFAULTS[unit] || 100;
  }
  
  const totalGrams = item.qty_value * gramsPerUnit;
  
  return {
    corrected: true,
    item: { ...item, qty_value: totalGrams, qty_unit: 'g' },
    correction: {
      field: 'qty_unit',
      originalValue: `${item.qty_value} ${item.qty_unit}`,
      correctedValue: `${totalGrams}g`,
      rule: 'SIZE_DESCRIPTOR_TO_GRAMS',
      details: { gramsPerUnit, count: item.qty_value }
    }
  };
}

/**
 * Auto-correction: Normalize unit to canonical form
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { corrected: boolean, item: Object, correction: Object|null }
 */
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
 * Auto-correction: Normalize stateHint to lowercase
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { corrected: boolean, item: Object, correction: Object|null }
 */
function autocorrectStateHint(item) {
  if (!item.stateHint || typeof item.stateHint !== 'string') {
    return { corrected: false, item, correction: null };
  }
  
  const normalized = item.stateHint.toLowerCase().trim();
  const validStates = ['dry', 'raw', 'cooked', 'as_pack'];
  
  // Map common variations
  const stateMapping = {
    'dried': 'dry',
    'uncooked': 'raw',
    'fresh': 'raw',
    'packaged': 'as_pack',
    'packed': 'as_pack',
    'as-pack': 'as_pack',
    'aspack': 'as_pack'
  };
  
  let correctedState = stateMapping[normalized] || (validStates.includes(normalized) ? normalized : null);
  
  if (correctedState && correctedState !== item.stateHint) {
    return {
      corrected: true,
      item: { ...item, stateHint: correctedState },
      correction: {
        field: 'stateHint',
        originalValue: item.stateHint,
        correctedValue: correctedState,
        rule: 'STATE_HINT_NORMALIZATION'
      }
    };
  }
  
  // If stateHint is invalid and can't be mapped, set to null (defer to resolver)
  if (!validStates.includes(normalized) && !correctedState) {
    return {
      corrected: true,
      item: { ...item, stateHint: null },
      correction: {
        field: 'stateHint',
        originalValue: item.stateHint,
        correctedValue: null,
        rule: 'INVALID_STATE_HINT_CLEARED'
      }
    };
  }
  
  return { corrected: false, item, correction: null };
}

/**
 * Auto-correction: Normalize methodHint to lowercase
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { corrected: boolean, item: Object, correction: Object|null }
 */
function autocorrectMethodHint(item) {
  if (!item.methodHint || typeof item.methodHint !== 'string') {
    return { corrected: false, item, correction: null };
  }
  
  const normalized = item.methodHint.toLowerCase().trim();
  const validMethods = ['boiled', 'fried', 'baked', 'steamed', 'grilled', 'roasted', 'sauteed', 'poached', 'braised'];
  
  // Map common variations
  const methodMapping = {
    'sautéed': 'sauteed',
    'pan fried': 'fried',
    'pan-fried': 'fried',
    'stir fried': 'fried',
    'stir-fried': 'fried',
    'deep fried': 'fried',
    'deep-fried': 'fried',
    'bbq': 'grilled',
    'barbecued': 'grilled',
    'chargrilled': 'grilled'
  };
  
  let correctedMethod = methodMapping[normalized] || (validMethods.includes(normalized) ? normalized : null);
  
  if (correctedMethod && correctedMethod !== item.methodHint) {
    return {
      corrected: true,
      item: { ...item, methodHint: correctedMethod },
      correction: {
        field: 'methodHint',
        originalValue: item.methodHint,
        correctedValue: correctedMethod,
        rule: 'METHOD_HINT_NORMALIZATION'
      }
    };
  }
  
  // If methodHint is invalid and can't be mapped, set to null
  if (!validMethods.includes(normalized) && !correctedMethod) {
    return {
      corrected: true,
      item: { ...item, methodHint: null },
      correction: {
        field: 'methodHint',
        originalValue: item.methodHint,
        correctedValue: null,
        rule: 'INVALID_METHOD_HINT_CLEARED'
      }
    };
  }
  
  return { corrected: false, item, correction: null };
}

/**
 * Auto-correction: Clamp qty_value to valid range
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { corrected: boolean, item: Object, correction: Object|null }
 */
function autocorrectQuantityBounds(item) {
  const { qty_value, qty_unit } = item;
  
  if (typeof qty_value !== 'number') {
    return { corrected: false, item, correction: null };
  }
  
  // Only clamp for gram/ml units
  if (!['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters'].includes(qty_unit?.toLowerCase())) {
    return { corrected: false, item, correction: null };
  }
  
  const isLiquid = isLiquidUnit(qty_unit);
  const constraints = isLiquid ? QUANTITY_CONSTRAINTS.liquid : QUANTITY_CONSTRAINTS.solid;
  
  let correctedValue = qty_value;
  let corrected = false;
  
  if (qty_value < constraints.min) {
    correctedValue = constraints.min;
    corrected = true;
  } else if (qty_value > constraints.max) {
    correctedValue = constraints.max;
    corrected = true;
  }
  
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

/**
 * Applies all auto-corrections to an item
 * 
 * @param {Object} item - Item to correct
 * @returns {Object} { item: Object, corrections: Array }
 */
function applyItemAutocorrections(item) {
  let currentItem = { ...item };
  const corrections = [];
  
  // Apply corrections in order
  const correctors = [
    autocorrectQtyValueToNumber,
    autocorrectSizeDescriptor,
    autocorrectNormalizeUnit,
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

/**
 * Validates a single item with constraint checking
 * 
 * @param {Object} item - Item to validate
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateItemConstraints(item) {
  const errors = [];
  
  // Validate qty_unit
  const unitValidation = validateUnit(item.qty_unit);
  if (!unitValidation.valid) {
    errors.push(unitValidation.error);
  }
  
  // Validate quantity constraints
  const qtyValidation = validateQuantityConstraints(item);
  errors.push(...qtyValidation.errors);
  
  // Validate stateHint
  const stateValidation = validateStateHint(item.stateHint);
  if (!stateValidation.valid) {
    errors.push(stateValidation.error);
  }
  
  // Validate methodHint
  const methodValidation = validateMethodHint(item.methodHint);
  if (!methodValidation.valid) {
    errors.push(methodValidation.error);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Main validation function
 * Validates LLM output against schema and constraints, applies auto-corrections
 * 
 * @param {*} output - Raw LLM output
 * @param {string} schemaName - Name of schema to validate against
 * @returns {Object} { valid: boolean, errors: Array, corrections: Array, correctedOutput: Object|null }
 */
function validateLLMOutput(output, schemaName) {
  const result = {
    valid: true,
    errors: [],
    corrections: [],
    correctedOutput: null
  };
  
  // Get schema
  const schema = SCHEMAS[schemaName];
  if (!schema) {
    result.valid = false;
    result.errors.push(`Unknown schema: ${schemaName}`);
    return result;
  }
  
  // Handle null/undefined
  if (output === null || output === undefined) {
    result.valid = false;
    result.errors.push('Output is null or undefined');
    return result;
  }
  
  // Schema validation
  const schemaErrors = validateSchema(output, schema);
  if (schemaErrors.length > 0) {
    result.valid = false;
    result.errors.push(...schemaErrors);
    // Continue to attempt corrections
  }
  
  // Apply corrections and constraint validation based on schema type
  let correctedOutput = output;
  
  if (schemaName === 'MEALS_ARRAY' && Array.isArray(output)) {
    correctedOutput = [];
    
    for (const meal of output) {
      if (!meal || typeof meal !== 'object') {
        correctedOutput.push(meal);
        continue;
      }
      
      const correctedMeal = { ...meal };
      
      // Process items in meal
      if (Array.isArray(meal.items)) {
        correctedMeal.items = [];
        
        for (const item of meal.items) {
          if (!item || typeof item !== 'object') {
            correctedMeal.items.push(item);
            continue;
          }
          
          // Apply auto-corrections
          const { item: correctedItem, corrections } = applyItemAutocorrections(item);
          result.corrections.push(...corrections);
          
          // Validate constraints on corrected item
          const constraintValidation = validateItemConstraints(correctedItem);
          if (!constraintValidation.valid) {
            result.errors.push(...constraintValidation.errors.map(e => `Item '${correctedItem.key}': ${e}`));
          }
          
          correctedMeal.items.push(correctedItem);
        }
      }
      
      correctedOutput.push(correctedMeal);
    }
  } else if (schemaName === 'ITEM_SCHEMA' && typeof output === 'object') {
    const { item: correctedItem, corrections } = applyItemAutocorrections(output);
    result.corrections.push(...corrections);
    
    const constraintValidation = validateItemConstraints(correctedItem);
    if (!constraintValidation.valid) {
      result.errors.push(...constraintValidation.errors);
    }
    
    correctedOutput = correctedItem;
  } else if (schemaName === 'MEAL_SCHEMA' && typeof output === 'object') {
    correctedOutput = { ...output };
    
    if (Array.isArray(output.items)) {
      correctedOutput.items = [];
      
      for (const item of output.items) {
        if (!item || typeof item !== 'object') {
          correctedOutput.items.push(item);
          continue;
        }
        
        const { item: correctedItem, corrections } = applyItemAutocorrections(item);
        result.corrections.push(...corrections);
        
        const constraintValidation = validateItemConstraints(correctedItem);
        if (!constraintValidation.valid) {
          result.errors.push(...constraintValidation.errors.map(e => `Item '${correctedItem.key}': ${e}`));
        }
        
        correctedOutput.items.push(correctedItem);
      }
    }
  }
  
  result.correctedOutput = correctedOutput;
  
  // Re-evaluate validity after corrections
  // Only mark as invalid if there are errors that couldn't be corrected
  result.valid = result.errors.length === 0;
  
  return result;
}

/**
 * Validates a grocery query object
 * 
 * @param {Object} query - Grocery query to validate
 * @returns {Object} { valid: boolean, errors: Array }
 */
function validateGroceryQuery(query) {
  const result = validateLLMOutput(query, 'GROCERY_QUERY_SCHEMA');
  
  // Additional grocery-specific validation
  if (query.normalQuery && query.normalQuery.length < 2) {
    result.valid = false;
    result.errors.push('normalQuery must be at least 2 characters');
  }
  
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
  
  // Export for testing and external use
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