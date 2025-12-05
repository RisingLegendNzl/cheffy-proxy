/**
 * utils/errors.js
 * 
 * Structured Error Classes for Cheffy Pipeline
 * V1.0 - Initial implementation
 * 
 * PURPOSE:
 * Provides structured error classes that serialize properly for SSE transmission.
 * All pipeline errors should be wrapped in these classes to ensure consistent
 * error formatting across the system.
 * 
 * DESIGN PRINCIPLES:
 * 1. All errors have a code, message, and optional context
 * 2. toJSON() produces machine-parseable envelopes
 * 3. Error codes map to ERROR_CODES in sseHelper.js
 * 4. Stack traces are sanitized (first 5 lines only)
 */

const { ERROR_CODES } = require('./sseHelper.js');

/**
 * Base class for all pipeline errors
 * Ensures proper serialization for SSE transmission
 */
class PipelineError extends Error {
  /**
   * @param {string} code - Error code from ERROR_CODES
   * @param {string} message - Human-readable error message
   * @param {Object} options - Additional options
   */
  constructor(code, message, options = {}) {
    super(message);
    
    this.name = 'PipelineError';
    this.code = code || ERROR_CODES.UNKNOWN_ERROR;
    this.traceId = options.traceId || null;
    this.stage = options.stage || null;
    this.context = options.context || {};
    this.recoverable = options.recoverable || false;
    this.timestamp = new Date().toISOString();
    this.originalError = options.originalError || null;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PipelineError);
    }
  }
  
  /**
   * Serializes error for JSON transmission
   * @returns {Object} Structured error envelope
   */
  toJSON() {
    return {
      type: this.name,
      code: this.code,
      message: this.message,
      traceId: this.traceId,
      stage: this.stage,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      stack: this.stack ? this.stack.split('\n').slice(0, 5).join('\n') : null
    };
  }
  
  /**
   * Creates a PipelineError from any error type
   * 
   * @param {Error|string|Object} error - Original error
   * @param {Object} options - Additional options
   * @returns {PipelineError}
   */
  static from(error, options = {}) {
    if (error instanceof PipelineError) {
      // Update with new options if provided
      if (options.traceId) error.traceId = options.traceId;
      if (options.stage) error.stage = options.stage;
      return error;
    }
    
    if (error instanceof InvariantViolationError) {
      return new PipelineError(
        error.invariantId === 'INV-001-RESPONSE' 
          ? ERROR_CODES.INV_001_RESPONSE_BLOCKED 
          : ERROR_CODES.INV_001_BLOCKING,
        error.message,
        {
          traceId: options.traceId || error.context?.traceId,
          stage: options.stage || 'invariant_check',
          context: error.context || {},
          originalError: error
        }
      );
    }
    
    if (error instanceof ValidationError) {
      return new PipelineError(
        ERROR_CODES.VALIDATION_CRITICAL,
        error.message,
        {
          traceId: options.traceId,
          stage: options.stage || 'validation',
          context: { validationResult: error.validationResult },
          originalError: error
        }
      );
    }
    
    if (error instanceof LLMError) {
      return new PipelineError(
        error.code || ERROR_CODES.LLM_RETRY_EXHAUSTED,
        error.message,
        {
          traceId: options.traceId,
          stage: options.stage || 'llm',
          context: error.context || {},
          originalError: error
        }
      );
    }
    
    // Handle standard Error objects
    if (error instanceof Error) {
      let code = ERROR_CODES.UNKNOWN_ERROR;
      
      // Detect error type from flags
      if (error.isValidationError) {
        code = ERROR_CODES.VALIDATION_CRITICAL;
      } else if (error.isLLMValidationError) {
        code = ERROR_CODES.LLM_VALIDATION_FAILED;
      } else if (error.name === 'InvariantViolationError') {
        code = ERROR_CODES.INV_001_BLOCKING;
      }
      
      return new PipelineError(code, error.message, {
        traceId: options.traceId,
        stage: options.stage,
        context: {
          originalName: error.name,
          ...options.context
        },
        originalError: error
      });
    }
    
    // Handle string errors
    if (typeof error === 'string') {
      return new PipelineError(
        options.code || ERROR_CODES.UNKNOWN_ERROR,
        error,
        options
      );
    }
    
    // Handle plain objects
    if (typeof error === 'object' && error !== null) {
      return new PipelineError(
        error.code || options.code || ERROR_CODES.UNKNOWN_ERROR,
        error.message || JSON.stringify(error),
        {
          traceId: options.traceId || error.traceId,
          stage: options.stage || error.stage,
          context: error.context || error,
          originalError: error
        }
      );
    }
    
    // Fallback for unknown types
    return new PipelineError(
      ERROR_CODES.UNKNOWN_ERROR,
      'An unknown error occurred',
      options
    );
  }
}

/**
 * Error class for invariant violations
 * Re-exported from invariants.js for convenience
 */
class InvariantViolationError extends Error {
  /**
   * @param {string} invariantId - Invariant ID (e.g., 'INV-001')
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   */
  constructor(invariantId, message, context = {}) {
    super(`[${invariantId}] ${message}`);
    
    this.name = 'InvariantViolationError';
    this.invariantId = invariantId;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvariantViolationError);
    }
  }
  
  toJSON() {
    return {
      type: this.name,
      invariantId: this.invariantId,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack ? this.stack.split('\n').slice(0, 5).join('\n') : null
    };
  }
}

/**
 * Error class for validation failures
 */
class ValidationError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} validationResult - Validation result object
   */
  constructor(message, validationResult = {}) {
    super(message);
    
    this.name = 'ValidationError';
    this.validationResult = validationResult;
    this.isValidationError = true;
    this.timestamp = new Date().toISOString();
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
  
  toJSON() {
    return {
      type: this.name,
      message: this.message,
      validationResult: this.validationResult,
      timestamp: this.timestamp,
      stack: this.stack ? this.stack.split('\n').slice(0, 5).join('\n') : null
    };
  }
}

/**
 * Error class for LLM failures
 */
class LLMError extends Error {
  /**
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   */
  constructor(code, message, context = {}) {
    super(message);
    
    this.name = 'LLMError';
    this.code = code || ERROR_CODES.LLM_RETRY_EXHAUSTED;
    this.context = context;
    this.isLLMValidationError = true;
    this.timestamp = new Date().toISOString();
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LLMError);
    }
  }
  
  toJSON() {
    return {
      type: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack ? this.stack.split('\n').slice(0, 5).join('\n') : null
    };
  }
}

/**
 * Error class for day generation failures
 */
class DayGenerationError extends Error {
  /**
   * @param {number} dayNumber - Day that failed
   * @param {string} message - Error message
   * @param {Error} originalError - Original error
   */
  constructor(dayNumber, message, originalError = null) {
    super(message);
    
    this.name = 'DayGenerationError';
    this.dayNumber = dayNumber;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DayGenerationError);
    }
  }
  
  toJSON() {
    return {
      type: this.name,
      dayNumber: this.dayNumber,
      message: this.message,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message
      } : null,
      timestamp: this.timestamp,
      stack: this.stack ? this.stack.split('\n').slice(0, 5).join('\n') : null
    };
  }
}

/**
 * Wraps an async function with structured error handling
 * 
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Error wrapping options
 * @returns {Function} Wrapped function that converts errors to PipelineError
 */
function wrapWithErrorHandling(fn, options = {}) {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      throw PipelineError.from(error, options);
    }
  };
}

/**
 * Extracts a safe, serializable representation of an error
 * 
 * @param {Error|string|Object} error - Error to extract
 * @returns {Object} Safe error representation
 */
function extractSafeError(error) {
  if (!error) {
    return {
      code: ERROR_CODES.UNKNOWN_ERROR,
      message: 'Unknown error occurred'
    };
  }
  
  if (error instanceof PipelineError) {
    return error.toJSON();
  }
  
  if (error instanceof Error) {
    return {
      code: error.code || ERROR_CODES.UNKNOWN_ERROR,
      message: error.message || 'Unknown error',
      name: error.name,
      stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null
    };
  }
  
  if (typeof error === 'string') {
    return {
      code: ERROR_CODES.UNKNOWN_ERROR,
      message: error
    };
  }
  
  if (typeof error === 'object') {
    return {
      code: error.code || ERROR_CODES.UNKNOWN_ERROR,
      message: error.message || JSON.stringify(error),
      ...error
    };
  }
  
  return {
    code: ERROR_CODES.UNKNOWN_ERROR,
    message: String(error)
  };
}

module.exports = {
  // Error classes
  PipelineError,
  InvariantViolationError,
  ValidationError,
  LLMError,
  DayGenerationError,
  
  // Utilities
  wrapWithErrorHandling,
  extractSafeError
};