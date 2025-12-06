/**
 * utils/sseHelper.js
 * 
 * Server-Sent Events (SSE) Helper for Cheffy Pipeline
 * V1.0 - Initial implementation
 * 
 * PURPOSE:
 * Provides consistent SSE streaming infrastructure for the Cheffy pipeline.
 * Ensures all events conform to the SSE protocol and include structured payloads.
 * Guarantees terminal events are always sent before stream closure.
 * 
 * SSE PROTOCOL:
 * Each event is formatted as:
 *   event: <eventType>\n
 *   data: <JSON payload>\n
 *   \n
 * 
 * EVENT TYPES:
 * - phase:start / phase:end / phase:error - Pipeline stage lifecycle
 * - day:start / day:complete / day:error - Day processing lifecycle  
 * - ingredient:found / ingredient:failed / ingredient:flagged - Ingredient events
 * - invariant:warning / invariant:violation - Invariant check results
 * - validation:warning / validation:failed - Validation results
 * - log_message - Diagnostic logging
 * - plan:complete - Terminal success event
 * - plan:error - Terminal error event
 */

/**
 * Event type constants
 */
const SSE_EVENT_TYPES = {
  // Phase lifecycle
  PHASE_START: 'phase:start',
  PHASE_END: 'phase:end',
  PHASE_ERROR: 'phase:error',
  
  // Day lifecycle
  DAY_START: 'day:start',
  DAY_COMPLETE: 'day:complete',
  DAY_ERROR: 'day:error',
  
  // Ingredient events
  INGREDIENT_FOUND: 'ingredient:found',
  INGREDIENT_FAILED: 'ingredient:failed',
  INGREDIENT_FLAGGED: 'ingredient:flagged',
  
  // Invariant events
  INVARIANT_WARNING: 'invariant:warning',
  INVARIANT_VIOLATION: 'invariant:violation',
  
  // Validation events
  VALIDATION_WARNING: 'validation:warning',
  VALIDATION_FAILED: 'validation:failed',
  
  // Logging
  LOG_MESSAGE: 'log_message',
  
  // Terminal events
  PLAN_COMPLETE: 'plan:complete',
  PLAN_ERROR: 'plan:error'
};

/**
 * Error codes for structured error envelopes
 */
const ERROR_CODES = {
  // Invariant violations
  INV_001_BLOCKING: 'INV_001_BLOCKING',
  INV_001_RESPONSE_BLOCKED: 'INV_001_RESPONSE_BLOCKED',
  
  // Validation failures
  VALIDATION_CRITICAL: 'VALIDATION_CRITICAL',
  LLM_VALIDATION_FAILED: 'LLM_VALIDATION_FAILED',
  
  // LLM failures
  LLM_RETRY_EXHAUSTED: 'LLM_RETRY_EXHAUSTED',
  LLM_PRIMARY_FAILED: 'LLM_PRIMARY_FAILED',
  LLM_FALLBACK_FAILED: 'LLM_FALLBACK_FAILED',
  
  // Pipeline failures
  PIPELINE_EXECUTION_FAILED: 'PIPELINE_EXECUTION_FAILED',
  DAY_GENERATION_FAILED: 'DAY_GENERATION_FAILED',
  NUTRITION_LOOKUP_FAILED: 'NUTRITION_LOOKUP_FAILED',
  
  // System errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  HANDLER_CRASHED: 'HANDLER_CRASHED',
  STREAM_TERMINATED: 'STREAM_TERMINATED'
};

/**
 * Creates an SSE stream manager for a response object
 * 
 * @param {Object} response - Express/Vercel response object
 * @param {string} traceId - Trace ID for correlation
 * @returns {Object} SSE manager with send/complete/error methods
 */
function createSSEStream(response, traceId) {
  let terminalEventSent = false;
  let streamClosed = false;
  
  // Setup SSE headers
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  
  // Flush headers immediately
  if (typeof response.flushHeaders === 'function') {
    response.flushHeaders();
  }
  
  /**
   * Sends an SSE event
   * 
   * @param {string} eventType - Event type from SSE_EVENT_TYPES
   * @param {Object} data - Event payload
   * @returns {boolean} Whether send was successful
   */
  function send(eventType, data) {
    if (streamClosed) {
      console.warn(`[SSE] Attempted to send event after stream closed: ${eventType}`);
      return false;
    }
    
    try {
      const payload = {
        ...data,
        _meta: {
          traceId,
          timestamp: new Date().toISOString(),
          eventType
        }
      };
      
      const eventString = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
      response.write(eventString);
      
      // Flush if available (Vercel streaming support)
      if (typeof response.flush === 'function') {
        response.flush();
      }
      
      return true;
    } catch (err) {
      console.error(`[SSE] Failed to send event ${eventType}:`, err.message);
      return false;
    }
  }
  
  /**
   * Sends a log message event
   * 
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG, CRITICAL)
   * @param {string} tag - Log tag/category
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  function log(level, tag, message, data = {}) {
    send(SSE_EVENT_TYPES.LOG_MESSAGE, {
      timestamp: new Date().toISOString(),
      level,
      tag,
      message,
      ...data
    });
  }
  
  /**
   * Sends phase start event
   * 
   * @param {string} name - Phase name
   * @param {string} description - Human-readable description
   */
  function phaseStart(name, description) {
    send(SSE_EVENT_TYPES.PHASE_START, { name, description });
  }
  
  /**
   * Sends phase end event
   * 
   * @param {string} name - Phase name
   * @param {Object} result - Phase result data
   */
  function phaseEnd(name, result = {}) {
    send(SSE_EVENT_TYPES.PHASE_END, { name, result });
  }
  
  /**
   * Sends phase error event
   * 
   * @param {string} name - Phase name
   * @param {string} code - Error code
   * @param {string} message - Error message
   */
  function phaseError(name, code, message) {
    send(SSE_EVENT_TYPES.PHASE_ERROR, { name, code, message });
  }
  
  /**
   * Sends day start event
   * 
   * @param {number} dayNumber - Day number (1-indexed)
   * @param {number} totalDays - Total days in plan
   */
  function dayStart(dayNumber, totalDays) {
    send(SSE_EVENT_TYPES.DAY_START, { 
      dayNumber, 
      totalDays,
      description: `Processing Day ${dayNumber} of ${totalDays}`
    });
  }
  
  /**
   * Sends day complete event
   * 
   * @param {number} dayNumber - Day number
   * @param {Object} dayData - Processed day data
   */
  function dayComplete(dayNumber, dayData) {
    send(SSE_EVENT_TYPES.DAY_COMPLETE, { dayNumber, data: dayData });
  }
  
  /**
   * Sends day error event
   * 
   * @param {number} dayNumber - Day number
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {boolean} recoverable - Whether pipeline can continue
   */
  function dayError(dayNumber, code, message, recoverable = false) {
    send(SSE_EVENT_TYPES.DAY_ERROR, { 
      dayNumber, 
      code, 
      message, 
      recoverable 
    });
  }
  
  /**
   * Sends ingredient found event
   * 
   * @param {string} key - Ingredient key
   * @param {Object} data - Ingredient data (nutrition, products, etc.)
   */
  function ingredientFound(key, data) {
    send(SSE_EVENT_TYPES.INGREDIENT_FOUND, { key, data });
  }
  
  /**
   * Sends ingredient failed event
   * 
   * @param {string} key - Ingredient key
   * @param {string} reason - Failure reason
   */
  function ingredientFailed(key, reason) {
    send(SSE_EVENT_TYPES.INGREDIENT_FAILED, { key, reason });
  }
  
  /**
   * Sends ingredient flagged event (INV-001 warning)
   * 
   * @param {string} key - Ingredient key
   * @param {Object} violation - Violation details
   */
  function ingredientFlagged(key, violation) {
    send(SSE_EVENT_TYPES.INGREDIENT_FLAGGED, { 
      key, 
      invariantId: 'INV-001',
      severity: 'WARNING',
      ...violation 
    });
  }
  
  /**
   * Sends invariant warning event
   * 
   * @param {string} invariantId - Invariant ID (e.g., 'INV-001')
   * @param {Object} details - Warning details
   */
  function invariantWarning(invariantId, details) {
    send(SSE_EVENT_TYPES.INVARIANT_WARNING, { 
      invariantId, 
      severity: 'WARNING',
      ...details 
    });
  }
  
  /**
   * Sends invariant violation event (critical)
   * 
   * @param {string} invariantId - Invariant ID
   * @param {Object} details - Violation details
   */
  function invariantViolation(invariantId, details) {
    send(SSE_EVENT_TYPES.INVARIANT_VIOLATION, { 
      invariantId, 
      severity: 'CRITICAL',
      ...details 
    });
  }
  
  /**
   * Sends validation warning event
   * 
   * @param {Array} warnings - Array of warning objects
   */
  function validationWarning(warnings) {
    send(SSE_EVENT_TYPES.VALIDATION_WARNING, { 
      severity: 'WARNING',
      count: warnings.length,
      warnings 
    });
  }
  
  /**
   * Sends validation failed event
   * 
   * @param {Array} criticalIssues - Array of critical issues
   */
  function validationFailed(criticalIssues) {
    send(SSE_EVENT_TYPES.VALIDATION_FAILED, { 
      severity: 'CRITICAL',
      count: criticalIssues.length,
      issues: criticalIssues 
    });
  }
  
  /**
   * Sends terminal success event and closes stream
   * 
   * @param {Object} payload - Final payload (mealPlan, results, uniqueIngredients, etc.)
   */
  function complete(payload) {
    if (terminalEventSent) {
      console.warn('[SSE] Terminal event already sent, ignoring complete()');
      return;
    }
    
    terminalEventSent = true;
    send(SSE_EVENT_TYPES.PLAN_COMPLETE, payload);
    close();
  }
  
  /**
   * Sends terminal error event and closes stream
   * 
   * @param {string} code - Error code from ERROR_CODES
   * @param {string} message - Human-readable error message
   * @param {Object} context - Additional error context
   */
  function error(code, message, context = {}) {
    if (terminalEventSent) {
      console.warn('[SSE] Terminal event already sent, ignoring error()');
      return;
    }
    
    terminalEventSent = true;
    send(SSE_EVENT_TYPES.PLAN_ERROR, {
      code: code || ERROR_CODES.UNKNOWN_ERROR,
      message: message || 'An unknown error occurred',
      traceId,
      recoverable: false,
      ...context
    });
    close();
  }
  
  /**
   * Closes the SSE stream
   * Ensures a terminal event is sent if none was sent
   */
  function close() {
    if (streamClosed) {
      return;
    }
    
    // Ensure terminal event was sent
    if (!terminalEventSent) {
      send(SSE_EVENT_TYPES.PLAN_ERROR, {
        code: ERROR_CODES.STREAM_TERMINATED,
        message: 'Stream terminated without explicit completion',
        traceId,
        recoverable: false
      });
      terminalEventSent = true;
    }
    
    streamClosed = true;
    
    try {
      response.end();
    } catch (err) {
      console.error('[SSE] Error closing stream:', err.message);
    }
  }
  
  /**
   * Returns whether a terminal event has been sent
   * 
   * @returns {boolean}
   */
  function isTerminated() {
    return terminalEventSent;
  }
  
  /**
   * Returns whether the stream is closed
   * 
   * @returns {boolean}
   */
  function isClosed() {
    return streamClosed;
  }
  
  return {
    // Core methods
    send,
    log,
    close,
    
    // Phase events
    phaseStart,
    phaseEnd,
    phaseError,
    
    // Day events
    dayStart,
    dayComplete,
    dayError,
    
    // Ingredient events
    ingredientFound,
    ingredientFailed,
    ingredientFlagged,
    
    // Invariant events
    invariantWarning,
    invariantViolation,
    
    // Validation events
    validationWarning,
    validationFailed,
    
    // Terminal events
    complete,
    error,
    
    // State queries
    isTerminated,
    isClosed
  };
}

/**
 * Creates a structured error envelope for SSE transmission
 * 
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Human-readable message
 * @param {Object} options - Additional options
 * @returns {Object} Structured error envelope
 */
function createErrorEnvelope(code, message, options = {}) {
  const {
    traceId = null,
    stage = null,
    invariantId = null,
    context = {},
    recoverable = false
  } = options;
  
  return {
    type: 'PipelineError',
    code: code || ERROR_CODES.UNKNOWN_ERROR,
    message: message || 'An error occurred during plan generation',
    traceId,
    stage,
    invariantId,
    context,
    recoverable,
    timestamp: new Date().toISOString()
  };
}

/**
 * Extracts error code from an Error object
 * 
 * @param {Error} error - Error object
 * @returns {string} Error code
 */
function getErrorCode(error) {
  if (!error) return ERROR_CODES.UNKNOWN_ERROR;
  
  // Check for InvariantViolationError
  if (error.name === 'InvariantViolationError') {
    if (error.invariantId === 'INV-001-RESPONSE') {
      return ERROR_CODES.INV_001_RESPONSE_BLOCKED;
    }
    if (error.invariantId === 'INV-001') {
      return ERROR_CODES.INV_001_BLOCKING;
    }
    return ERROR_CODES.INV_001_BLOCKING;
  }
  
  // Check for validation errors
  if (error.isValidationError) {
    return ERROR_CODES.VALIDATION_CRITICAL;
  }
  
  // Check for LLM validation errors
  if (error.isLLMValidationError) {
    return ERROR_CODES.LLM_VALIDATION_FAILED;
  }
  
  // Check for known error messages
  const msg = error.message?.toLowerCase() || '';
  
  if (msg.includes('llm') && msg.includes('retry')) {
    return ERROR_CODES.LLM_RETRY_EXHAUSTED;
  }
  
  if (msg.includes('nutrition') || msg.includes('lookup')) {
    return ERROR_CODES.NUTRITION_LOOKUP_FAILED;
  }
  
  if (msg.includes('pipeline')) {
    return ERROR_CODES.PIPELINE_EXECUTION_FAILED;
  }
  
  return ERROR_CODES.UNKNOWN_ERROR;
}

/**
 * Extracts a safe error message from an Error object
 * 
 * @param {Error|string|Object} error - Error to extract message from
 * @returns {string} Safe error message
 */
function getSafeErrorMessage(error) {
  if (!error) return 'Unknown error occurred';
  
  if (typeof error === 'string') return error;
  
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }
  
  if (typeof error === 'object') {
    if (error.message) return error.message;
    const str = JSON.stringify(error);
    if (str !== '{}') return str;
  }
  
  return 'Unknown error occurred';
}

module.exports = {
  // Factory
  createSSEStream,
  
  // Helpers
  createErrorEnvelope,
  getErrorCode,
  getSafeErrorMessage,
  
  // Constants
  SSE_EVENT_TYPES,
  ERROR_CODES
};
