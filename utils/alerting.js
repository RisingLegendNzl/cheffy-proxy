/**
 * utils/alerting.js
 * 
 * Alerting System for Cheffy
 * V2.0 - Added new alert metrics for reliability layer
 * 
 * PURPOSE:
 * Provides centralized alerting infrastructure for the Cheffy pipeline.
 * Emits structured alerts when system metrics exceed thresholds or
 * when critical events occur.
 * 
 * V2.0 CHANGES (Minimum Viable Reliability):
 * - Added item_flagged_inv001: Item flagged for macro-kcal inconsistency
 * - Added response_blocked_inv001: Entire response blocked due to >20% flagged items
 * - Added lookup_validation_failed: Nutrition lookup failed pre-use validation
 * - Added ingestion_rejected: Build-time record rejection
 * - Added macro_kcal_inconsistency: Specific alert for INV-001 violations
 * 
 * DESIGN PRINCIPLES:
 * 1. Every alert is structured and machine-parseable
 * 2. Alert levels have semantic meaning (CRITICAL, WARNING, INFO)
 * 3. Alerts include sufficient context for debugging
 * 4. Alerting is non-blocking (failures don't crash pipeline)
 */

/**
 * Alert severity levels
 */
const ALERT_LEVELS = {
  CRITICAL: 'critical',  // Requires immediate attention, user impact likely
  WARNING: 'warning',    // Elevated concern, should investigate
  INFO: 'info'           // Informational, for monitoring and trends
};

/**
 * Alert threshold definitions
 * These define when automatic alerts should fire based on metric values
 */
const ALERT_THRESHOLDS = {
  // Nutrition fallback rate thresholds
  fallback_rate: {
    critical: 30,  // > 30% triggers CRITICAL
    warning: 15    // > 15% triggers WARNING
  },
  
  // State resolution confidence
  low_confidence_rate: {
    warning: 20    // > 20% low confidence resolutions triggers WARNING
  },
  
  // LLM validation failure rate
  llm_validation_failure_rate: {
    warning: 10    // > 10% validation failures triggers WARNING
  },
  
  // Reconciliation factor bounds
  reconciliation_factor: {
    critical_high: 2.0,  // > 2.0 triggers CRITICAL
    critical_low: 0.5,   // < 0.5 triggers CRITICAL
    warning_high: 1.5,   // > 1.5 triggers WARNING
    warning_low: 0.7     // < 0.7 triggers WARNING
  },
  
  // Calorie deviation from target
  calorie_deviation: {
    critical: 15,  // > 15% triggers CRITICAL
    warning: 10    // > 10% triggers WARNING
  },
  
  // Protein deviation from target
  protein_deviation: {
    critical: 20,  // > 20% triggers CRITICAL
    warning: 15    // > 15% triggers WARNING
  },
  
  // Market run success rate
  market_run_success_rate: {
    warning: 80    // < 80% success triggers WARNING
  },
  
  // HotPath hit rate
  hotpath_hit_rate: {
    warning: 70    // < 70% hit rate triggers WARNING
  },
  
  // Validation issues
  validation_critical_count: {
    critical: 0    // > 0 critical issues triggers CRITICAL
  },
  
  // V2.0: Macro-kcal consistency thresholds
  macro_kcal_deviation: {
    warning: 5,    // > 5% triggers WARNING (flag item)
    critical: 20   // > 20% triggers CRITICAL (hard fail)
  },
  
  // V2.0: Flagged items rate (response blocking)
  flagged_items_rate: {
    critical: 20   // > 20% of items flagged triggers response block
  }
};

/**
 * Alert category definitions for grouping and routing
 */
const ALERT_CATEGORIES = {
  NUTRITION: 'nutrition',
  STATE_RESOLUTION: 'state_resolution',
  VALIDATION: 'validation',
  RECONCILIATION: 'reconciliation',
  MARKET_RUN: 'market_run',
  LLM: 'llm',
  SYSTEM: 'system',
  INVARIANTS: 'invariants',      // V2.0: New category
  INGESTION: 'ingestion'         // V2.0: New category
};

/**
 * Maps alert metrics to categories
 */
const METRIC_TO_CATEGORY = {
  // Existing metrics
  high_fallback_rate: ALERT_CATEGORIES.NUTRITION,
  elevated_fallback_rate: ALERT_CATEGORIES.NUTRITION,
  yield_unmapped: ALERT_CATEGORIES.NUTRITION,
  hotpath_miss: ALERT_CATEGORIES.NUTRITION,
  nutrition_fallback: ALERT_CATEGORIES.NUTRITION,
  
  llm_state_disagreement: ALERT_CATEGORIES.STATE_RESOLUTION,
  low_confidence_resolution: ALERT_CATEGORIES.STATE_RESOLUTION,
  
  validation_critical: ALERT_CATEGORIES.VALIDATION,
  validation_warning: ALERT_CATEGORIES.VALIDATION,
  
  reconciliation_factor_bounds: ALERT_CATEGORIES.RECONCILIATION,
  daily_reconciliation_bounds: ALERT_CATEGORIES.RECONCILIATION,
  reconciliation_clamped: ALERT_CATEGORIES.RECONCILIATION,
  
  market_run_failure: ALERT_CATEGORIES.MARKET_RUN,
  product_mismatch: ALERT_CATEGORIES.MARKET_RUN,
  
  llm_validation_failed: ALERT_CATEGORIES.LLM,
  llm_retry_exhausted: ALERT_CATEGORIES.LLM,
  
  system_error: ALERT_CATEGORIES.SYSTEM,
  pipeline_failure: ALERT_CATEGORIES.SYSTEM,
  
  // V2.0: New metrics for reliability layer
  item_flagged_inv001: ALERT_CATEGORIES.INVARIANTS,
  response_blocked_inv001: ALERT_CATEGORIES.INVARIANTS,
  macro_kcal_inconsistency: ALERT_CATEGORIES.INVARIANTS,
  invariant_violation: ALERT_CATEGORIES.INVARIANTS,
  invariant_violation_critical: ALERT_CATEGORIES.INVARIANTS,
  
  lookup_validation_failed: ALERT_CATEGORIES.NUTRITION,
  nutrition_validation_skipped: ALERT_CATEGORIES.NUTRITION,
  
  ingestion_rejected: ALERT_CATEGORIES.INGESTION,
  ingestion_validation_failed: ALERT_CATEGORIES.INGESTION,
  canonical_audit_failure: ALERT_CATEGORIES.INGESTION
};

/**
 * In-memory alert buffer for rate limiting
 * Prevents alert floods from repeated issues
 */
const alertBuffer = {
  recent: new Map(),  // metric -> { count, lastEmitted }
  rateLimitWindow: 60000,  // 1 minute window
  maxPerWindow: 5  // Max 5 alerts of same type per window
};

/**
 * Notification hooks for external systems
 * These can be configured to send alerts to Slack, email, etc.
 */
const notificationHooks = [];

/**
 * Generates a unique alert ID
 * 
 * @returns {string} Alert ID
 */
function generateAlertId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `alert_${timestamp}_${random}`;
}

/**
 * Checks if an alert should be rate-limited
 * 
 * @param {string} metric - The metric/alert type
 * @returns {boolean} True if alert should be suppressed
 */
function shouldRateLimit(metric) {
  const now = Date.now();
  const entry = alertBuffer.recent.get(metric);
  
  if (!entry) {
    alertBuffer.recent.set(metric, { count: 1, lastEmitted: now, windowStart: now });
    return false;
  }
  
  // Check if we're in a new window
  if (now - entry.windowStart > alertBuffer.rateLimitWindow) {
    alertBuffer.recent.set(metric, { count: 1, lastEmitted: now, windowStart: now });
    return false;
  }
  
  // Check if we've exceeded rate limit
  if (entry.count >= alertBuffer.maxPerWindow) {
    return true;
  }
  
  // Update count
  entry.count++;
  entry.lastEmitted = now;
  return false;
}

/**
 * Creates a structured alert object
 * 
 * @param {string} level - Alert level (CRITICAL, WARNING, INFO)
 * @param {string} metric - Metric/alert type identifier
 * @param {Object} context - Additional context data
 * @returns {Object} Structured alert object
 */
function createAlert(level, metric, context = {}) {
  const category = METRIC_TO_CATEGORY[metric] || ALERT_CATEGORIES.SYSTEM;
  
  return {
    id: generateAlertId(),
    timestamp: new Date().toISOString(),
    level,
    metric,
    category,
    context,
    traceId: context.traceId || null,
    source: 'cheffy-pipeline',
    version: '2.0'
  };
}

/**
 * Emits an alert
 * Handles rate limiting, logging, and notification dispatch
 * 
 * @param {string} level - Alert level from ALERT_LEVELS
 * @param {string} metric - Metric/alert type identifier
 * @param {Object} context - Additional context data
 * @returns {Object|null} Alert object if emitted, null if rate-limited
 */
function emitAlert(level, metric, context = {}) {
  try {
    // Validate level
    if (!Object.values(ALERT_LEVELS).includes(level)) {
      console.error(`Invalid alert level: ${level}`);
      return null;
    }
    
    // Check rate limiting (except for CRITICAL alerts)
    if (level !== ALERT_LEVELS.CRITICAL && shouldRateLimit(metric)) {
      return null;
    }
    
    // Create alert
    const alert = createAlert(level, metric, context);
    
    // Log to console as structured JSON
    const logEntry = {
      type: 'ALERT',
      ...alert
    };
    
    // Use appropriate console method based on level
    switch (level) {
      case ALERT_LEVELS.CRITICAL:
        console.error(JSON.stringify(logEntry));
        break;
      case ALERT_LEVELS.WARNING:
        console.warn(JSON.stringify(logEntry));
        break;
      default:
        console.log(JSON.stringify(logEntry));
    }
    
    // Dispatch to notification hooks (async, non-blocking)
    dispatchToHooks(alert);
    
    return alert;
    
  } catch (error) {
    // Alerting should never crash the pipeline
    console.error('Alert emission failed:', error.message);
    return null;
  }
}

/**
 * Dispatches alert to registered notification hooks
 * 
 * @param {Object} alert - Alert object
 */
async function dispatchToHooks(alert) {
  for (const hook of notificationHooks) {
    try {
      // Run hooks asynchronously without awaiting
      hook(alert).catch(err => {
        console.error(`Notification hook failed: ${err.message}`);
      });
    } catch (error) {
      console.error(`Notification hook error: ${error.message}`);
    }
  }
}

/**
 * Registers a notification hook
 * Hooks receive alert objects and can send to external systems
 * 
 * @param {Function} hook - Async function that receives alert object
 */
function registerNotificationHook(hook) {
  if (typeof hook === 'function') {
    notificationHooks.push(hook);
  }
}

/**
 * Removes a notification hook
 * 
 * @param {Function} hook - Hook to remove
 */
function unregisterNotificationHook(hook) {
  const index = notificationHooks.indexOf(hook);
  if (index > -1) {
    notificationHooks.splice(index, 1);
  }
}

/**
 * Checks a metric value against thresholds and emits alert if exceeded
 * 
 * @param {string} metric - Metric name (must match key in ALERT_THRESHOLDS)
 * @param {number} value - Current metric value
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert if threshold exceeded, null otherwise
 */
function checkThreshold(metric, value, context = {}) {
  const thresholds = ALERT_THRESHOLDS[metric];
  
  if (!thresholds) {
    return null;
  }
  
  // Check for rate-based thresholds (higher is worse)
  if (thresholds.critical !== undefined && value > thresholds.critical) {
    return emitAlert(ALERT_LEVELS.CRITICAL, metric, {
      ...context,
      value,
      threshold: thresholds.critical,
      thresholdType: 'critical'
    });
  }
  
  if (thresholds.warning !== undefined && value > thresholds.warning) {
    return emitAlert(ALERT_LEVELS.WARNING, metric, {
      ...context,
      value,
      threshold: thresholds.warning,
      thresholdType: 'warning'
    });
  }
  
  // Check for bounded thresholds (reconciliation factor)
  if (thresholds.critical_high !== undefined && value > thresholds.critical_high) {
    return emitAlert(ALERT_LEVELS.CRITICAL, metric, {
      ...context,
      value,
      threshold: thresholds.critical_high,
      thresholdType: 'critical_high'
    });
  }
  
  if (thresholds.critical_low !== undefined && value < thresholds.critical_low) {
    return emitAlert(ALERT_LEVELS.CRITICAL, metric, {
      ...context,
      value,
      threshold: thresholds.critical_low,
      thresholdType: 'critical_low'
    });
  }
  
  if (thresholds.warning_high !== undefined && value > thresholds.warning_high) {
    return emitAlert(ALERT_LEVELS.WARNING, metric, {
      ...context,
      value,
      threshold: thresholds.warning_high,
      thresholdType: 'warning_high'
    });
  }
  
  if (thresholds.warning_low !== undefined && value < thresholds.warning_low) {
    return emitAlert(ALERT_LEVELS.WARNING, metric, {
      ...context,
      value,
      threshold: thresholds.warning_low,
      thresholdType: 'warning_low'
    });
  }
  
  return null;
}

/**
 * Checks reconciliation factor and emits alert if out of bounds
 * 
 * @param {number} factor - Reconciliation factor
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert if out of bounds
 */
function checkReconciliationFactor(factor, context = {}) {
  return checkThreshold('reconciliation_factor', factor, context);
}

/**
 * Checks fallback rate and emits alert if too high
 * 
 * @param {number} rate - Fallback rate as percentage (0-100)
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert if threshold exceeded
 */
function checkFallbackRate(rate, context = {}) {
  if (rate > ALERT_THRESHOLDS.fallback_rate.critical) {
    return emitAlert(ALERT_LEVELS.CRITICAL, 'high_fallback_rate', {
      ...context,
      fallbackRate: rate,
      threshold: ALERT_THRESHOLDS.fallback_rate.critical
    });
  }
  
  if (rate > ALERT_THRESHOLDS.fallback_rate.warning) {
    return emitAlert(ALERT_LEVELS.WARNING, 'elevated_fallback_rate', {
      ...context,
      fallbackRate: rate,
      threshold: ALERT_THRESHOLDS.fallback_rate.warning
    });
  }
  
  return null;
}

/**
 * Checks calorie deviation and emits alert if too high
 * 
 * @param {number} actual - Actual calories
 * @param {number} target - Target calories
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert if deviation too high
 */
function checkCalorieDeviation(actual, target, context = {}) {
  if (target === 0) return null;
  
  const deviation = Math.abs((actual - target) / target) * 100;
  
  return checkThreshold('calorie_deviation', deviation, {
    ...context,
    actualCalories: actual,
    targetCalories: target,
    deviationPercent: deviation.toFixed(2)
  });
}

/**
 * Checks validation results and emits alerts for issues
 * 
 * @param {Object} validationResult - Result from validateDayPlan
 * @param {Object} context - Additional context
 * @returns {Array} Array of emitted alerts
 */
function checkValidationResult(validationResult, context = {}) {
  const alerts = [];
  
  if (validationResult.critical && validationResult.critical.length > 0) {
    const alert = emitAlert(ALERT_LEVELS.CRITICAL, 'validation_critical', {
      ...context,
      issues: validationResult.critical,
      count: validationResult.critical.length
    });
    if (alert) alerts.push(alert);
  }
  
  if (validationResult.warnings && validationResult.warnings.length > 5) {
    const alert = emitAlert(ALERT_LEVELS.WARNING, 'validation_warning', {
      ...context,
      issues: validationResult.warnings.slice(0, 10),  // Limit logged issues
      count: validationResult.warnings.length
    });
    if (alert) alerts.push(alert);
  }
  
  return alerts;
}

/**
 * Emits a new ingredient alert (ingredient not in HotPath)
 * 
 * @param {string} ingredientKey - The ingredient key
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertNewIngredient(ingredientKey, context = {}) {
  return emitAlert(ALERT_LEVELS.INFO, 'hotpath_miss', {
    ...context,
    ingredientKey,
    message: 'Ingredient not found in HotPath cache'
  });
}

/**
 * Emits a yield unmapped alert
 * 
 * @param {string} itemKey - The item key
 * @param {string} stateHint - The state hint that required yield lookup
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertYieldUnmapped(itemKey, stateHint, context = {}) {
  return emitAlert(ALERT_LEVELS.CRITICAL, 'yield_unmapped', {
    ...context,
    itemKey,
    stateHint,
    message: 'Cooked item has no YIELDS entry'
  });
}

/**
 * Emits a market run failure alert
 * 
 * @param {string} ingredientKey - The ingredient that failed
 * @param {string} reason - Failure reason
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertMarketRunFailure(ingredientKey, reason, context = {}) {
  return emitAlert(ALERT_LEVELS.WARNING, 'market_run_failure', {
    ...context,
    ingredientKey,
    reason,
    message: 'Market run failed to find products'
  });
}

/**
 * Emits a pipeline failure alert
 * 
 * @param {string} stage - Pipeline stage that failed
 * @param {Error} error - The error
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertPipelineFailure(stage, error, context = {}) {
  return emitAlert(ALERT_LEVELS.CRITICAL, 'pipeline_failure', {
    ...context,
    stage,
    errorMessage: error.message,
    errorStack: error.stack?.split('\n').slice(0, 5).join('\n'),
    message: 'Pipeline execution failed'
  });
}

// =====================================================================
// V2.0: NEW ALERT FUNCTIONS FOR RELIABILITY LAYER
// =====================================================================

/**
 * Emits an alert when an item is flagged for INV-001 violation
 * 
 * @param {string} itemKey - The item key
 * @param {Object} violation - Violation details { expected_kcal, reported_kcal, deviation_pct, severity }
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertItemFlaggedInv001(itemKey, violation, context = {}) {
  const level = violation.severity === 'CRITICAL' ? ALERT_LEVELS.CRITICAL : ALERT_LEVELS.WARNING;
  
  return emitAlert(level, 'item_flagged_inv001', {
    ...context,
    itemKey,
    expectedKcal: violation.expected_kcal,
    reportedKcal: violation.reported_kcal,
    deviationPct: violation.deviation_pct,
    severity: violation.severity,
    message: `Item '${itemKey}' macro-kcal inconsistency: ${violation.deviation_pct}% deviation`
  });
}

/**
 * Emits an alert when entire response is blocked due to too many flagged items
 * 
 * @param {number} flaggedCount - Number of flagged items
 * @param {number} totalItems - Total number of items
 * @param {Object} context - Additional context (should include traceId)
 * @returns {Object|null} Alert
 */
function alertResponseBlockedInv001(flaggedCount, totalItems, context = {}) {
  const flaggedRate = (flaggedCount / totalItems) * 100;
  
  return emitAlert(ALERT_LEVELS.CRITICAL, 'response_blocked_inv001', {
    ...context,
    flaggedCount,
    totalItems,
    flaggedRatePct: flaggedRate.toFixed(2),
    threshold: ALERT_THRESHOLDS.flagged_items_rate.critical,
    message: `Response blocked: ${flaggedRate.toFixed(1)}% of items flagged (${flaggedCount}/${totalItems})`
  });
}

/**
 * Emits an alert when nutrition lookup fails pre-use validation
 * 
 * @param {string} ingredientKey - The ingredient key
 * @param {string} source - Source that failed validation (hotpath, canonical)
 * @param {Object} validationResult - Result from validation check
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertLookupValidationFailed(ingredientKey, source, validationResult, context = {}) {
  return emitAlert(ALERT_LEVELS.WARNING, 'lookup_validation_failed', {
    ...context,
    ingredientKey,
    source,
    expectedKcal: validationResult.expected_kcal,
    reportedKcal: validationResult.reported_kcal,
    deviationPct: validationResult.deviation_pct,
    message: `Nutrition lookup from '${source}' failed validation for '${ingredientKey}'`
  });
}

/**
 * Emits an alert when a nutrition record is rejected at ingestion (build time)
 * 
 * @param {string} key - The record key
 * @param {Array} errors - List of validation errors
 * @param {Object} context - Additional context
 * @returns {Object|null} Alert
 */
function alertIngestionRejected(key, errors, context = {}) {
  return emitAlert(ALERT_LEVELS.WARNING, 'ingestion_rejected', {
    ...context,
    key,
    errors,
    errorCount: errors.length,
    message: `Nutrition record '${key}' rejected at ingestion: ${errors.join('; ')}`
  });
}

/**
 * Clears the rate limit buffer (for testing)
 */
function clearRateLimitBuffer() {
  alertBuffer.recent.clear();
}

/**
 * Gets current rate limit stats (for debugging)
 * 
 * @returns {Object} Rate limit statistics
 */
function getRateLimitStats() {
  const stats = {};
  for (const [metric, entry] of alertBuffer.recent) {
    stats[metric] = {
      count: entry.count,
      lastEmitted: new Date(entry.lastEmitted).toISOString(),
      windowStart: new Date(entry.windowStart).toISOString()
    };
  }
  return stats;
}

/**
 * Configures rate limiting parameters
 * 
 * @param {Object} config - { rateLimitWindow, maxPerWindow }
 */
function configureRateLimiting(config) {
  if (config.rateLimitWindow) {
    alertBuffer.rateLimitWindow = config.rateLimitWindow;
  }
  if (config.maxPerWindow) {
    alertBuffer.maxPerWindow = config.maxPerWindow;
  }
}

module.exports = {
  // Core functions
  emitAlert,
  checkThreshold,
  
  // Convenience checkers
  checkReconciliationFactor,
  checkFallbackRate,
  checkCalorieDeviation,
  checkValidationResult,
  
  // Specific alert emitters
  alertNewIngredient,
  alertYieldUnmapped,
  alertMarketRunFailure,
  alertPipelineFailure,
  
  // V2.0: New alert emitters for reliability layer
  alertItemFlaggedInv001,
  alertResponseBlockedInv001,
  alertLookupValidationFailed,
  alertIngestionRejected,
  
  // Hook management
  registerNotificationHook,
  unregisterNotificationHook,
  
  // Configuration and debugging
  configureRateLimiting,
  clearRateLimitBuffer,
  getRateLimitStats,
  
  // Constants
  ALERT_LEVELS,
  ALERT_THRESHOLDS,
  ALERT_CATEGORIES,
  METRIC_TO_CATEGORY
};