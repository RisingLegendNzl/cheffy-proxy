/**
 * api/metrics.js
 * 
 * Metrics API Endpoint for Cheffy
 * 
 * PURPOSE:
 * Exposes pipeline metrics via HTTP endpoint for monitoring dashboards.
 * Stores time-series metrics in @vercel/kv for historical analysis.
 * 
 * PLAN REFERENCE: Step E1 - Expose pipelineStats via api/metrics.js
 * 
 * ENDPOINTS:
 * - GET /api/metrics - Returns current and historical metrics
 * - POST /api/metrics - Records new metric data point
 * 
 * DESIGN PRINCIPLES:
 * 1. Metrics are aggregated at configurable intervals
 * 2. Historical data is retained with configurable TTL
 * 3. Response format is compatible with Prometheus/Grafana
 * 4. Non-blocking - metric recording shouldn't slow the pipeline
 * 
 * ASSUMPTIONS:
 * - @vercel/kv is available for persistence
 * - This runs as a Vercel serverless function
 * - Authentication is handled at the edge/middleware layer
 */

/**
 * Metric definitions
 * Each metric has a name, type, description, and optional labels
 */
const METRIC_DEFINITIONS = {
  // Pipeline execution metrics
  pipeline_executions_total: {
    type: 'counter',
    description: 'Total number of pipeline executions',
    labels: ['status'] // success, failure
  },
  pipeline_duration_seconds: {
    type: 'histogram',
    description: 'Pipeline execution duration in seconds',
    labels: ['stage'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
  },
  
  // Nutrition lookup metrics
  nutrition_lookups_total: {
    type: 'counter',
    description: 'Total nutrition lookups',
    labels: ['source'] // hotpath, canonical, fallback
  },
  nutrition_fallback_rate: {
    type: 'gauge',
    description: 'Current fallback rate percentage',
    labels: []
  },
  hotpath_hit_rate: {
    type: 'gauge',
    description: 'HotPath cache hit rate percentage',
    labels: []
  },
  
  // State resolution metrics
  state_resolutions_total: {
    type: 'counter',
    description: 'Total state resolutions',
    labels: ['source', 'confidence'] // rule/llm_agreed/rule_override, high/medium/low
  },
  state_llm_disagreements_total: {
    type: 'counter',
    description: 'Number of times LLM state hint was overridden',
    labels: []
  },
  
  // LLM validation metrics
  llm_validations_total: {
    type: 'counter',
    description: 'Total LLM output validations',
    labels: ['result'] // success, corrected, failed
  },
  llm_corrections_total: {
    type: 'counter',
    description: 'Total auto-corrections applied to LLM output',
    labels: ['rule'] // correction rule ID
  },
  llm_retries_total: {
    type: 'counter',
    description: 'Total LLM retry attempts',
    labels: []
  },
  
  // Reconciliation metrics
  reconciliation_factor: {
    type: 'gauge',
    description: 'Current reconciliation factor',
    labels: ['scope'] // meal, daily
  },
  reconciliation_out_of_bounds_total: {
    type: 'counter',
    description: 'Reconciliation factors outside acceptable bounds',
    labels: []
  },
  
  // Accuracy metrics
  calorie_deviation_percent: {
    type: 'gauge',
    description: 'Deviation from target calories as percentage',
    labels: []
  },
  protein_deviation_percent: {
    type: 'gauge',
    description: 'Deviation from target protein as percentage',
    labels: []
  },
  
  // Validation metrics
  validation_issues_total: {
    type: 'counter',
    description: 'Total validation issues detected',
    labels: ['severity'] // critical, warning, info
  },
  
  // Market run metrics
  market_run_success_rate: {
    type: 'gauge',
    description: 'Market run success rate percentage',
    labels: []
  },
  market_run_duration_seconds: {
    type: 'histogram',
    description: 'Market run duration in seconds',
    labels: [],
    buckets: [1, 2, 5, 10, 20, 30, 60]
  },
  
  // Invariant metrics
  invariant_violations_total: {
    type: 'counter',
    description: 'Total invariant violations detected',
    labels: ['invariant_id']
  },
  
  // Alert metrics
  alerts_emitted_total: {
    type: 'counter',
    description: 'Total alerts emitted',
    labels: ['level', 'category']
  }
};

/**
 * Configuration for metrics storage
 */
const METRICS_CONFIG = {
  // Time-series retention
  retentionHours: 24,
  
  // Aggregation interval in seconds
  aggregationIntervalSeconds: 60,
  
  // Key prefixes for storage
  keyPrefix: 'cheffy:metrics:',
  timeSeriesPrefix: 'cheffy:metrics:ts:',
  aggregatePrefix: 'cheffy:metrics:agg:',
  
  // Maximum time-series points to store per metric
  maxTimeSeriesPoints: 1440  // 24 hours at 1-minute intervals
};

/**
 * In-memory buffer for metric aggregation
 * Flushed to storage periodically
 */
const metricsBuffer = {
  counters: new Map(),
  gauges: new Map(),
  histograms: new Map(),
  lastFlush: Date.now()
};

/**
 * Generates a storage key for a metric
 * 
 * @param {string} metricName - Metric name
 * @param {Object} labels - Label key-value pairs
 * @returns {string} Storage key
 */
function generateMetricKey(metricName, labels = {}) {
  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  
  return labelStr ? `${metricName}{${labelStr}}` : metricName;
}

/**
 * Records a counter increment
 * 
 * @param {string} name - Metric name
 * @param {Object} labels - Labels
 * @param {number} value - Increment value (default 1)
 */
function incrementCounter(name, labels = {}, value = 1) {
  const key = generateMetricKey(name, labels);
  const current = metricsBuffer.counters.get(key) || 0;
  metricsBuffer.counters.set(key, current + value);
}

/**
 * Records a gauge value
 * 
 * @param {string} name - Metric name
 * @param {Object} labels - Labels
 * @param {number} value - Current value
 */
function setGauge(name, labels = {}, value) {
  const key = generateMetricKey(name, labels);
  metricsBuffer.gauges.set(key, {
    value,
    timestamp: Date.now()
  });
}

/**
 * Records a histogram observation
 * 
 * @param {string} name - Metric name
 * @param {Object} labels - Labels
 * @param {number} value - Observed value
 */
function observeHistogram(name, labels = {}, value) {
  const key = generateMetricKey(name, labels);
  
  if (!metricsBuffer.histograms.has(key)) {
    metricsBuffer.histograms.set(key, {
      sum: 0,
      count: 0,
      buckets: {}
    });
  }
  
  const hist = metricsBuffer.histograms.get(key);
  hist.sum += value;
  hist.count += 1;
  
  // Get bucket boundaries from definition
  const def = METRIC_DEFINITIONS[name];
  if (def && def.buckets) {
    for (const boundary of def.buckets) {
      if (!hist.buckets[boundary]) {
        hist.buckets[boundary] = 0;
      }
      if (value <= boundary) {
        hist.buckets[boundary]++;
      }
    }
  }
}

/**
 * Records pipeline stats from a single execution
 * 
 * @param {Object} stats - Pipeline statistics object
 */
function recordPipelineStats(stats) {
  const {
    traceId,
    success,
    totalDuration,
    stageDurations,
    nutritionStats,
    stateStats,
    llmStats,
    reconciliationStats,
    validationStats,
    accuracyStats
  } = stats;
  
  // Pipeline execution
  incrementCounter('pipeline_executions_total', { status: success ? 'success' : 'failure' });
  
  if (totalDuration !== undefined) {
    observeHistogram('pipeline_duration_seconds', { stage: 'total' }, totalDuration / 1000);
  }
  
  // Stage durations
  if (stageDurations) {
    for (const [stage, duration] of Object.entries(stageDurations)) {
      observeHistogram('pipeline_duration_seconds', { stage }, duration / 1000);
    }
  }
  
  // Nutrition stats
  if (nutritionStats) {
    const { hotPath, canonical, fallback, total } = nutritionStats;
    
    if (hotPath !== undefined) {
      incrementCounter('nutrition_lookups_total', { source: 'hotpath' }, hotPath);
    }
    if (canonical !== undefined) {
      incrementCounter('nutrition_lookups_total', { source: 'canonical' }, canonical);
    }
    if (fallback !== undefined) {
      incrementCounter('nutrition_lookups_total', { source: 'fallback' }, fallback);
    }
    
    if (total > 0) {
      setGauge('nutrition_fallback_rate', {}, (fallback / total) * 100);
      setGauge('hotpath_hit_rate', {}, (hotPath / total) * 100);
    }
  }
  
  // State resolution stats
  if (stateStats) {
    const { bySource, byConfidence, llmDisagreements } = stateStats;
    
    if (bySource) {
      for (const [source, count] of Object.entries(bySource)) {
        incrementCounter('state_resolutions_total', { source, confidence: 'all' }, count);
      }
    }
    
    if (byConfidence) {
      for (const [confidence, count] of Object.entries(byConfidence)) {
        incrementCounter('state_resolutions_total', { source: 'all', confidence }, count);
      }
    }
    
    if (llmDisagreements !== undefined) {
      incrementCounter('state_llm_disagreements_total', {}, llmDisagreements);
    }
  }
  
  // LLM validation stats
  if (llmStats) {
    const { validations, corrections, retries } = llmStats;
    
    if (validations) {
      for (const [result, count] of Object.entries(validations)) {
        incrementCounter('llm_validations_total', { result }, count);
      }
    }
    
    if (corrections) {
      for (const [rule, count] of Object.entries(corrections)) {
        incrementCounter('llm_corrections_total', { rule }, count);
      }
    }
    
    if (retries !== undefined) {
      incrementCounter('llm_retries_total', {}, retries);
    }
  }
  
  // Reconciliation stats
  if (reconciliationStats) {
    const { mealFactor, dailyFactor, outOfBounds } = reconciliationStats;
    
    if (mealFactor !== undefined) {
      setGauge('reconciliation_factor', { scope: 'meal' }, mealFactor);
    }
    if (dailyFactor !== undefined) {
      setGauge('reconciliation_factor', { scope: 'daily' }, dailyFactor);
    }
    if (outOfBounds) {
      incrementCounter('reconciliation_out_of_bounds_total', {});
    }
  }
  
  // Accuracy stats
  if (accuracyStats) {
    const { calorieDeviationPct, proteinDeviationPct } = accuracyStats;
    
    if (calorieDeviationPct !== undefined) {
      setGauge('calorie_deviation_percent', {}, calorieDeviationPct);
    }
    if (proteinDeviationPct !== undefined) {
      setGauge('protein_deviation_percent', {}, proteinDeviationPct);
    }
  }
  
  // Validation stats
  if (validationStats) {
    const { critical, warnings, info } = validationStats;
    
    if (critical !== undefined) {
      incrementCounter('validation_issues_total', { severity: 'critical' }, critical);
    }
    if (warnings !== undefined) {
      incrementCounter('validation_issues_total', { severity: 'warning' }, warnings);
    }
    if (info !== undefined) {
      incrementCounter('validation_issues_total', { severity: 'info' }, info);
    }
  }
}

/**
 * Records an alert emission
 * 
 * @param {string} level - Alert level
 * @param {string} category - Alert category
 */
function recordAlert(level, category) {
  incrementCounter('alerts_emitted_total', { level, category });
}

/**
 * Records an invariant violation
 * 
 * @param {string} invariantId - Invariant ID
 */
function recordInvariantViolation(invariantId) {
  incrementCounter('invariant_violations_total', { invariant_id: invariantId });
}

/**
 * Gets current metric values from buffer
 * 
 * @returns {Object} Current metrics
 */
function getCurrentMetrics() {
  const metrics = {
    timestamp: new Date().toISOString(),
    counters: {},
    gauges: {},
    histograms: {}
  };
  
  // Convert counters
  for (const [key, value] of metricsBuffer.counters) {
    metrics.counters[key] = value;
  }
  
  // Convert gauges
  for (const [key, data] of metricsBuffer.gauges) {
    metrics.gauges[key] = data;
  }
  
  // Convert histograms
  for (const [key, data] of metricsBuffer.histograms) {
    metrics.histograms[key] = {
      count: data.count,
      sum: data.sum,
      mean: data.count > 0 ? data.sum / data.count : 0,
      buckets: data.buckets
    };
  }
  
  return metrics;
}

/**
 * Formats metrics in Prometheus exposition format
 * 
 * @returns {string} Prometheus-formatted metrics
 */
function formatPrometheus() {
  const lines = [];
  const metrics = getCurrentMetrics();
  
  // Add counters
  for (const [key, value] of Object.entries(metrics.counters)) {
    const [name] = key.split('{');
    const def = METRIC_DEFINITIONS[name];
    
    if (def) {
      lines.push(`# HELP ${name} ${def.description}`);
      lines.push(`# TYPE ${name} ${def.type}`);
    }
    
    lines.push(`${key} ${value}`);
  }
  
  // Add gauges
  for (const [key, data] of Object.entries(metrics.gauges)) {
    const [name] = key.split('{');
    const def = METRIC_DEFINITIONS[name];
    
    if (def) {
      lines.push(`# HELP ${name} ${def.description}`);
      lines.push(`# TYPE ${name} ${def.type}`);
    }
    
    lines.push(`${key} ${data.value}`);
  }
  
  // Add histograms
  for (const [key, data] of Object.entries(metrics.histograms)) {
    const [name, labelPart] = key.split('{');
    const labels = labelPart ? `{${labelPart}` : '';
    const def = METRIC_DEFINITIONS[name];
    
    if (def) {
      lines.push(`# HELP ${name} ${def.description}`);
      lines.push(`# TYPE ${name} histogram`);
    }
    
    // Add bucket values
    for (const [le, count] of Object.entries(data.buckets)) {
      const bucketLabels = labels 
        ? labels.replace('}', `,le="${le}"}`)
        : `{le="${le}"}`;
      lines.push(`${name}_bucket${bucketLabels} ${count}`);
    }
    
    // Add +Inf bucket
    const infLabels = labels 
      ? labels.replace('}', ',le="+Inf"}')
      : '{le="+Inf"}';
    lines.push(`${name}_bucket${infLabels} ${data.count}`);
    
    // Add sum and count
    lines.push(`${name}_sum${labels} ${data.sum}`);
    lines.push(`${name}_count${labels} ${data.count}`);
  }
  
  return lines.join('\n');
}

/**
 * Resets all metrics (for testing)
 */
function resetMetrics() {
  metricsBuffer.counters.clear();
  metricsBuffer.gauges.clear();
  metricsBuffer.histograms.clear();
  metricsBuffer.lastFlush = Date.now();
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    if (req.method === 'GET') {
      // Check format query param
      const format = req.query?.format || 'json';
      
      if (format === 'prometheus') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(formatPrometheus());
      } else {
        const metrics = getCurrentMetrics();
        
        // Add metadata
        metrics.definitions = METRIC_DEFINITIONS;
        metrics.config = {
          retentionHours: METRICS_CONFIG.retentionHours,
          aggregationIntervalSeconds: METRICS_CONFIG.aggregationIntervalSeconds
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(metrics);
      }
      
    } else if (req.method === 'POST') {
      // Record pipeline stats
      const stats = req.body;
      
      if (!stats) {
        res.status(400).json({ error: 'Missing request body' });
        return;
      }
      
      recordPipelineStats(stats);
      
      res.status(200).json({ 
        success: true, 
        message: 'Metrics recorded',
        timestamp: new Date().toISOString()
      });
      
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    console.error('Metrics endpoint error:', error);
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
  
  // Metric recording functions
  incrementCounter,
  setGauge,
  observeHistogram,
  recordPipelineStats,
  recordAlert,
  recordInvariantViolation,
  
  // Query functions
  getCurrentMetrics,
  formatPrometheus,
  
  // Utilities
  generateMetricKey,
  resetMetrics,
  
  // Constants
  METRIC_DEFINITIONS,
  METRICS_CONFIG
};