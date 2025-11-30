/**
 * api/trace.js
 * 
 * Trace Retrieval API Endpoint for Cheffy
 * 
 * PURPOSE:
 * Provides a debugging interface for retrieving complete execution traces
 * by trace ID. Enables engineers to understand exactly what happened
 * during a specific pipeline execution.
 * 
 * PLAN REFERENCE: Step E4 - Implement Trace ID System
 * 
 * ENDPOINTS:
 * - GET /api/trace/:traceId - Retrieves trace data for a specific execution
 * - GET /api/trace/recent - Lists recent traces (with pagination)
 * - POST /api/trace - Records trace data
 * - DELETE /api/trace/:traceId - Deletes a specific trace
 * 
 * DESIGN PRINCIPLES:
 * 1. Every trace is immutable once recorded
 * 2. Traces include all decision points and data transformations
 * 3. Sensitive data is sanitized before storage
 * 4. Traces expire after configurable TTL
 * 
 * ASSUMPTIONS:
 * - @vercel/kv is available for persistence
 * - Trace IDs are UUID v4 format
 * - This runs as a Vercel serverless function
 */

/**
 * Trace storage configuration
 */
const TRACE_CONFIG = {
  // Key prefix for trace storage
  keyPrefix: 'cheffy:trace:',
  
  // Index key for recent traces
  recentIndexKey: 'cheffy:traces:recent',
  
  // TTL for traces in seconds (24 hours)
  ttlSeconds: 86400,
  
  // Maximum number of recent traces to index
  maxRecentTraces: 1000,
  
  // Maximum events per trace
  maxEventsPerTrace: 500,
  
  // Fields to sanitize from trace data
  sensitiveFields: ['apiKey', 'password', 'token', 'secret', 'authorization']
};

/**
 * Trace event types
 */
const EVENT_TYPES = {
  PIPELINE_START: 'pipeline_start',
  PIPELINE_END: 'pipeline_end',
  STAGE_START: 'stage_start',
  STAGE_END: 'stage_end',
  LLM_REQUEST: 'llm_request',
  LLM_RESPONSE: 'llm_response',
  VALIDATION: 'validation',
  STATE_RESOLUTION: 'state_resolution',
  NUTRITION_LOOKUP: 'nutrition_lookup',
  RECONCILIATION: 'reconciliation',
  ERROR: 'error',
  WARNING: 'warning',
  DEBUG: 'debug'
};

/**
 * In-memory trace buffer for current traces
 * Key: traceId, Value: trace object
 */
const activeTraces = new Map();

/**
 * Generates storage key for a trace
 * 
 * @param {string} traceId - Trace ID
 * @returns {string} Storage key
 */
function getTraceKey(traceId) {
  return `${TRACE_CONFIG.keyPrefix}${traceId}`;
}

/**
 * Sanitizes sensitive data from an object
 * 
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized copy
 */
function sanitizeData(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeData(item));
  }
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Check if this is a sensitive field
    if (TRACE_CONFIG.sensitiveFields.some(f => lowerKey.includes(f))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Creates a new trace
 * 
 * @param {string} traceId - UUID for this trace
 * @param {Object} metadata - Initial metadata (targets, config, etc.)
 * @returns {Object} Trace object
 */
function createTrace(traceId, metadata = {}) {
  const trace = {
    traceId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    metadata: sanitizeData(metadata),
    events: [],
    summary: {
      stageCount: 0,
      errorCount: 0,
      warningCount: 0,
      totalDuration: null
    }
  };
  
  activeTraces.set(traceId, trace);
  
  return trace;
}

/**
 * Adds an event to a trace
 * 
 * @param {string} traceId - Trace ID
 * @param {string} eventType - Event type from EVENT_TYPES
 * @param {Object} data - Event data
 * @returns {boolean} Success
 */
function addTraceEvent(traceId, eventType, data = {}) {
  const trace = activeTraces.get(traceId);
  
  if (!trace) {
    console.warn(`Trace not found: ${traceId}`);
    return false;
  }
  
  // Check event limit
  if (trace.events.length >= TRACE_CONFIG.maxEventsPerTrace) {
    console.warn(`Trace ${traceId} has reached max events limit`);
    return false;
  }
  
  const event = {
    id: trace.events.length,
    type: eventType,
    timestamp: new Date().toISOString(),
    data: sanitizeData(data)
  };
  
  trace.events.push(event);
  trace.updatedAt = event.timestamp;
  
  // Update summary
  if (eventType === EVENT_TYPES.STAGE_START) {
    trace.summary.stageCount++;
  } else if (eventType === EVENT_TYPES.ERROR) {
    trace.summary.errorCount++;
  } else if (eventType === EVENT_TYPES.WARNING) {
    trace.summary.warningCount++;
  }
  
  return true;
}

/**
 * Records the start of a pipeline stage
 * 
 * @param {string} traceId - Trace ID
 * @param {string} stageName - Stage name
 * @param {Object} input - Stage input (optional)
 */
function traceStageStart(traceId, stageName, input = null) {
  addTraceEvent(traceId, EVENT_TYPES.STAGE_START, {
    stage: stageName,
    input: input ? sanitizeData(input) : undefined
  });
}

/**
 * Records the end of a pipeline stage
 * 
 * @param {string} traceId - Trace ID
 * @param {string} stageName - Stage name
 * @param {Object} result - Stage result (optional)
 * @param {number} durationMs - Stage duration in milliseconds
 */
function traceStageEnd(traceId, stageName, result = null, durationMs = null) {
  addTraceEvent(traceId, EVENT_TYPES.STAGE_END, {
    stage: stageName,
    result: result ? sanitizeData(result) : undefined,
    durationMs
  });
}

/**
 * Records a state resolution decision
 * 
 * @param {string} traceId - Trace ID
 * @param {string} itemKey - Item key
 * @param {Object} resolution - Resolution details
 */
function traceStateResolution(traceId, itemKey, resolution) {
  addTraceEvent(traceId, EVENT_TYPES.STATE_RESOLUTION, {
    itemKey,
    ...sanitizeData(resolution)
  });
}

/**
 * Records a nutrition lookup
 * 
 * @param {string} traceId - Trace ID
 * @param {string} itemKey - Item key
 * @param {Object} result - Lookup result
 */
function traceNutritionLookup(traceId, itemKey, result) {
  addTraceEvent(traceId, EVENT_TYPES.NUTRITION_LOOKUP, {
    itemKey,
    source: result.source,
    isFallback: result.isFallback,
    confidence: result.confidence
  });
}

/**
 * Records a validation result
 * 
 * @param {string} traceId - Trace ID
 * @param {string} validationType - Type of validation
 * @param {Object} result - Validation result
 */
function traceValidation(traceId, validationType, result) {
  addTraceEvent(traceId, EVENT_TYPES.VALIDATION, {
    type: validationType,
    valid: result.valid,
    errorCount: result.errors?.length || 0,
    correctionCount: result.corrections?.length || 0,
    errors: result.errors?.slice(0, 10),  // Limit stored errors
    corrections: result.corrections?.slice(0, 10)
  });
}

/**
 * Records a reconciliation operation
 * 
 * @param {string} traceId - Trace ID
 * @param {string} scope - 'meal' or 'daily'
 * @param {Object} details - Reconciliation details
 */
function traceReconciliation(traceId, scope, details) {
  addTraceEvent(traceId, EVENT_TYPES.RECONCILIATION, {
    scope,
    ...sanitizeData(details)
  });
}

/**
 * Records an error
 * 
 * @param {string} traceId - Trace ID
 * @param {string} stage - Stage where error occurred
 * @param {Error|string} error - Error object or message
 */
function traceError(traceId, stage, error) {
  const errorData = {
    stage,
    message: error.message || error,
    name: error.name,
    stack: error.stack?.split('\n').slice(0, 5).join('\n')
  };
  
  addTraceEvent(traceId, EVENT_TYPES.ERROR, errorData);
}

/**
 * Records a warning
 * 
 * @param {string} traceId - Trace ID
 * @param {string} stage - Stage where warning occurred
 * @param {string} message - Warning message
 * @param {Object} context - Additional context
 */
function traceWarning(traceId, stage, message, context = {}) {
  addTraceEvent(traceId, EVENT_TYPES.WARNING, {
    stage,
    message,
    ...sanitizeData(context)
  });
}

/**
 * Records debug information
 * 
 * @param {string} traceId - Trace ID
 * @param {string} label - Debug label
 * @param {Object} data - Debug data
 */
function traceDebug(traceId, label, data) {
  addTraceEvent(traceId, EVENT_TYPES.DEBUG, {
    label,
    ...sanitizeData(data)
  });
}

/**
 * Completes a trace and prepares it for storage
 * 
 * @param {string} traceId - Trace ID
 * @param {string} status - Final status ('success', 'failure', 'partial')
 * @param {Object} result - Final result summary
 * @returns {Object} Completed trace
 */
function completeTrace(traceId, status, result = {}) {
  const trace = activeTraces.get(traceId);
  
  if (!trace) {
    console.warn(`Trace not found for completion: ${traceId}`);
    return null;
  }
  
  // Add pipeline end event
  addTraceEvent(traceId, EVENT_TYPES.PIPELINE_END, {
    status,
    result: sanitizeData(result)
  });
  
  // Update trace
  trace.status = status;
  trace.completedAt = new Date().toISOString();
  
  // Calculate total duration
  if (trace.events.length > 0) {
    const startTime = new Date(trace.events[0].timestamp).getTime();
    const endTime = new Date(trace.completedAt).getTime();
    trace.summary.totalDuration = endTime - startTime;
  }
  
  // Update final summary
  trace.summary.finalStatus = status;
  trace.summary.eventCount = trace.events.length;
  
  if (result.dayTotals) {
    trace.summary.dayTotals = result.dayTotals;
  }
  
  if (result.targets) {
    trace.summary.targets = result.targets;
  }
  
  return trace;
}

/**
 * Retrieves a trace by ID
 * 
 * @param {string} traceId - Trace ID
 * @returns {Object|null} Trace object or null
 */
function getTrace(traceId) {
  // Check active traces first
  if (activeTraces.has(traceId)) {
    return activeTraces.get(traceId);
  }
  
  // In production, this would query @vercel/kv
  // For now, return null for non-active traces
  return null;
}

/**
 * Lists recent traces
 * 
 * @param {Object} options - { limit, offset, status }
 * @returns {Array} Array of trace summaries
 */
function listRecentTraces(options = {}) {
  const { limit = 20, offset = 0, status = null } = options;
  
  // Get traces from active buffer
  let traces = Array.from(activeTraces.values());
  
  // Filter by status if specified
  if (status) {
    traces = traces.filter(t => t.status === status);
  }
  
  // Sort by creation time (newest first)
  traces.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Apply pagination
  traces = traces.slice(offset, offset + limit);
  
  // Return summaries only
  return traces.map(trace => ({
    traceId: trace.traceId,
    createdAt: trace.createdAt,
    completedAt: trace.completedAt,
    status: trace.status,
    summary: trace.summary
  }));
}

/**
 * Deletes a trace
 * 
 * @param {string} traceId - Trace ID
 * @returns {boolean} Success
 */
function deleteTrace(traceId) {
  if (activeTraces.has(traceId)) {
    activeTraces.delete(traceId);
    return true;
  }
  return false;
}

/**
 * Clears all traces (for testing)
 */
function clearAllTraces() {
  activeTraces.clear();
}

/**
 * Gets trace statistics
 * 
 * @returns {Object} Statistics
 */
function getTraceStats() {
  const traces = Array.from(activeTraces.values());
  
  return {
    totalTraces: traces.length,
    byStatus: {
      active: traces.filter(t => t.status === 'active').length,
      success: traces.filter(t => t.status === 'success').length,
      failure: traces.filter(t => t.status === 'failure').length,
      partial: traces.filter(t => t.status === 'partial').length
    },
    averageDuration: traces
      .filter(t => t.summary.totalDuration)
      .reduce((sum, t) => sum + t.summary.totalDuration, 0) / 
      (traces.filter(t => t.summary.totalDuration).length || 1),
    totalEvents: traces.reduce((sum, t) => sum + t.events.length, 0)
  };
}

/**
 * Vercel serverless handler
 * 
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    // Parse trace ID from URL if present
    const urlParts = req.url.split('/');
    const traceId = urlParts.length > 3 ? urlParts[3] : null;
    
    if (req.method === 'GET') {
      // Check for special endpoints
      if (traceId === 'recent' || req.query?.recent === 'true') {
        // List recent traces
        const limit = parseInt(req.query?.limit) || 20;
        const offset = parseInt(req.query?.offset) || 0;
        const status = req.query?.status || null;
        
        const traces = listRecentTraces({ limit, offset, status });
        const stats = getTraceStats();
        
        res.status(200).json({
          traces,
          pagination: {
            limit,
            offset,
            total: stats.totalTraces
          },
          stats
        });
        return;
      }
      
      if (traceId === 'stats') {
        // Get trace statistics
        res.status(200).json(getTraceStats());
        return;
      }
      
      if (traceId) {
        // Get specific trace
        const trace = getTrace(traceId);
        
        if (!trace) {
          res.status(404).json({ error: 'Trace not found', traceId });
          return;
        }
        
        // Check for summary-only request
        if (req.query?.summary === 'true') {
          res.status(200).json({
            traceId: trace.traceId,
            createdAt: trace.createdAt,
            completedAt: trace.completedAt,
            status: trace.status,
            summary: trace.summary,
            metadata: trace.metadata
          });
          return;
        }
        
        res.status(200).json(trace);
        return;
      }
      
      // No trace ID - return recent traces
      const traces = listRecentTraces({ limit: 10 });
      res.status(200).json({ traces });
      
    } else if (req.method === 'POST') {
      // Create or update trace
      const { traceId: bodyTraceId, action, ...data } = req.body || {};
      
      if (!bodyTraceId) {
        res.status(400).json({ error: 'Missing traceId in request body' });
        return;
      }
      
      if (action === 'create') {
        const trace = createTrace(bodyTraceId, data.metadata);
        res.status(201).json({ 
          success: true, 
          traceId: trace.traceId,
          message: 'Trace created'
        });
        return;
      }
      
      if (action === 'event') {
        const success = addTraceEvent(bodyTraceId, data.eventType, data.eventData);
        res.status(success ? 200 : 404).json({ 
          success,
          message: success ? 'Event added' : 'Trace not found'
        });
        return;
      }
      
      if (action === 'complete') {
        const trace = completeTrace(bodyTraceId, data.status, data.result);
        res.status(trace ? 200 : 404).json({ 
          success: !!trace,
          message: trace ? 'Trace completed' : 'Trace not found',
          summary: trace?.summary
        });
        return;
      }
      
      res.status(400).json({ error: 'Invalid action. Use: create, event, complete' });
      
    } else if (req.method === 'DELETE') {
      if (!traceId) {
        res.status(400).json({ error: 'Missing trace ID' });
        return;
      }
      
      const success = deleteTrace(traceId);
      res.status(success ? 200 : 404).json({
        success,
        message: success ? 'Trace deleted' : 'Trace not found'
      });
      
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    console.error('Trace endpoint error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

module.exports = {
  // Vercel handler
  default: handler,
  handler,
  
  // Trace lifecycle
  createTrace,
  addTraceEvent,
  completeTrace,
  
  // Convenience methods
  traceStageStart,
  traceStageEnd,
  traceStateResolution,
  traceNutritionLookup,
  traceValidation,
  traceReconciliation,
  traceError,
  traceWarning,
  traceDebug,
  
  // Query methods
  getTrace,
  listRecentTraces,
  getTraceStats,
  
  // Management
  deleteTrace,
  clearAllTraces,
  
  // Constants
  EVENT_TYPES,
  TRACE_CONFIG
};