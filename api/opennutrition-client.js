/**
 * OpenNutrition MCP Client Wrapper for Cheffy
 * File: api/opennutrition-client.js
 * 
 * Provides a clean, performant interface to query the local OpenNutrition MCP server.
 * Implements connection pooling, request batching, and graceful fallbacks.
 * 
 * Performance targets:
 * - Single query latency: < 50ms (p95)
 * - Batch query (5 items): < 150ms (p95)
 * - Memory footprint: < 200MB
 */

const { spawn } = require('child_process');
const path = require('path');

// --- CONFIGURATION ---
const OPENNUTRITION_NODE_PATH = process.env.OPENNUTRITION_NODE_PATH || '/usr/bin/node';
const OPENNUTRITION_SERVER_PATH = process.env.OPENNUTRITION_SERVER_PATH || 
  path.join(__dirname, '../mcp-opennutrition/build/index.js');

const REQUEST_TIMEOUT_MS = 3000; // 3 seconds
const SERVER_START_TIMEOUT_MS = 5000; // 5 seconds
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;

// --- IN-MEMORY CACHE (for this process) ---
const searchCache = new Map(); // query -> {result, timestamp}
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

class OpenNutritionClient {
  constructor() {
    this.serverProcess = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.isReady = false;
    this.startupError = null;
  }

  /**
   * Start the MCP server process
   */
  async start() {
    if (this.serverProcess) return;
    
    try {
      this.serverProcess = spawn(OPENNUTRITION_NODE_PATH, [OPENNUTRITION_SERVER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle server stdout (responses)
      this.serverProcess.stdout.on('data', (data) => {
        this._handleServerResponse(data);
      });

      // Handle server stderr (errors)
      this.serverProcess.stderr.on('data', (data) => {
        console.error(`[ON_CLIENT] Server stderr: ${data.toString().trim()}`);
      });

      // Handle server exit
      this.serverProcess.on('exit', (code, signal) => {
        console.error(`[ON_CLIENT] Server exited: code=${code}, signal=${signal}`);
        this.isReady = false;
        this.serverProcess = null;
      });

      // Wait for server ready signal
      await this._waitForReady();
      this.isReady = true;
      console.log('[ON_CLIENT] Server started successfully');
      
    } catch (error) {
      this.startupError = error;
      console.error(`[ON_CLIENT] Failed to start server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wait for server to be ready
   */
  _waitForReady() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, SERVER_START_TIMEOUT_MS);

      // Listen for any stdout data as ready signal
      const onData = (data) => {
        clearTimeout(timeout);
        this.serverProcess.stdout.off('data', onData);
        resolve();
      };

      this.serverProcess.stdout.once('data', onData);
    });
  }

  /**
   * Handle response from server
   */
  _handleServerResponse(data) {
    const lines = data.toString().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        
        if (response.id && this.pendingRequests.has(response.id)) {
          const { resolve, reject, timer } = this.pendingRequests.get(response.id);
          clearTimeout(timer);
          this.pendingRequests.delete(response.id);
          
          if (response.error) {
            reject(new Error(response.error.message || 'Unknown error'));
          } else {
            resolve(response.result);
          }
        }
      } catch (e) {
        // Incomplete JSON or non-JSON output, ignore
      }
    }
  }

  /**
   * Send MCP request to server
   */
  async sendRequest(method, params, retries = 0) {
    if (!this.isReady) {
      if (this.startupError) {
        throw new Error(`Server not ready: ${this.startupError.message}`);
      }
      await this.start();
    }

    const requestId = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        
        if (retries < MAX_RETRIES) {
          // Retry with exponential backoff
          setTimeout(() => {
            this.sendRequest(method, params, retries + 1)
              .then(resolve)
              .catch(reject);
          }, RETRY_DELAY_MS * Math.pow(2, retries));
        } else {
          reject(new Error('Request timeout'));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      try {
        this.serverProcess.stdin.write(JSON.stringify(request) + '\n');
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Search foods by name (with caching)
   */
  async searchByName(query, limit = 10) {
    const normalizedQuery = query.toLowerCase().trim();
    const cacheKey = `search:${normalizedQuery}:${limit}`;
    
    // Check cache
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      const startTime = Date.now();
      const result = await this.sendRequest('tools/call', {
        name: 'search-foods',
        arguments: {
          query: normalizedQuery,
          limit: Math.min(limit, 20)
        }
      });
      
      const latency = Date.now() - startTime;
      console.log(`[ON_CLIENT] Search "${normalizedQuery}": ${latency}ms, ${result?.length || 0} results`);

      // Cache successful results
      if (result && result.length > 0) {
        searchCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });

        // Limit cache size
        if (searchCache.size > 1000) {
          const oldestKey = searchCache.keys().next().value;
          searchCache.delete(oldestKey);
        }
      }

      return result;
      
    } catch (error) {
      console.error(`[ON_CLIENT] Search error for "${query}": ${error.message}`);
      return null;
    }
  }

  /**
   * Lookup by EAN-13 barcode
   */
  async lookupByBarcode(barcode) {
    if (!barcode || barcode.length !== 13 || !/^\d+$/.test(barcode)) {
      return null;
    }

    const cacheKey = `barcode:${barcode}`;
    const cached = searchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      const startTime = Date.now();
      const result = await this.sendRequest('tools/call', {
        name: 'get-food-by-ean13',
        arguments: {
          ean_13: barcode
        }
      });

      const latency = Date.now() - startTime;
      console.log(`[ON_CLIENT] Barcode lookup ${barcode}: ${latency}ms, ${result ? 'HIT' : 'MISS'}`);

      if (result) {
        searchCache.set(cacheKey, {
          result,
          timestamp: Date.now()
        });
      }

      return result;
      
    } catch (error) {
      console.error(`[ON_CLIENT] Barcode error for ${barcode}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get food by ID
   */
  async getFoodById(id) {
    try {
      const startTime = Date.now();
      const result = await this.sendRequest('tools/call', {
        name: 'get-food-by-id',
        arguments: {
          id: parseInt(id, 10)
        }
      });

      const latency = Date.now() - startTime;
      console.log(`[ON_CLIENT] ID lookup ${id}: ${latency}ms`);

      return result;
      
    } catch (error) {
      console.error(`[ON_CLIENT] ID lookup error for ${id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Batch search multiple queries (for performance)
   */
  async batchSearch(queries) {
    const promises = queries.map(q => this.searchByName(q, 5));
    const results = await Promise.allSettled(promises);
    
    return results.map((r, i) => ({
      query: queries[i],
      result: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? r.reason : null
    }));
  }

  /**
   * Transform OpenNutrition response to Cheffy format
   * CRITICAL: Enforces "as sold per 100g" format
   */
  transformToCheffyFormat(onData) {
    if (!onData || !onData.nutrition_100g) {
      return null;
    }

    const nutrition = onData.nutrition_100g;

    // Parse all macros with fallbacks
    const calories = parseFloat(nutrition.energy_kcal) || 0;
    const protein = parseFloat(nutrition.protein_g) || 0;
    const fat = parseFloat(nutrition.fat_g) || 0;
    const carbs = parseFloat(nutrition.carbohydrate_g) || 0;
    const fiber = parseFloat(nutrition.fiber_g) || 0;
    const sugar = parseFloat(nutrition.sugar_g) || 0;
    const sodium = parseFloat(nutrition.sodium_mg) || 0;

    // Sanity checks
    if (calories > 900) {
      console.warn(`[ON_CLIENT] Suspicious calories for ${onData.name}: ${calories} kcal/100g`);
    }
    
    if (protein + fat + carbs > 110) {
      console.warn(`[ON_CLIENT] Macros sum to ${protein + fat + carbs}g for ${onData.name}`);
    }

    return {
      status: 'found',
      source: 'OPENNUTRITION',
      servingUnit: '100g', // ALWAYS per 100g
      usda_link: null,
      
      // Core macros
      calories,
      protein,
      fat,
      carbs,
      
      // Additional nutrients
      fiber,
      sugar,
      sodium,
      
      // Metadata
      name: onData.name,
      barcode: onData.ean_13,
      labels: onData.labels || [],
      serving: onData.serving,
      package_size: onData.package_size,
      ingredient_analysis: onData.ingredient_analysis,
      
      notes: `OpenNutrition ID: ${onData.id}`,
      version: 'opennutrition-v1',
      
      // Source tracking (for debugging)
      _source_name: onData.source?.name || 'unknown',
      _source_url: onData.source?.url || null
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const result = await this.searchByName('test', 1);
      return {
        status: 'healthy',
        isReady: this.isReady,
        pendingRequests: this.pendingRequests.size,
        cacheSize: searchCache.size
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        isReady: this.isReady
      };
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    if (this.serverProcess) {
      console.log('[ON_CLIENT] Shutting down server...');
      
      // Reject all pending requests
      for (const [id, { reject, timer }] of this.pendingRequests) {
        clearTimeout(timer);
        reject(new Error('Client shutting down'));
      }
      this.pendingRequests.clear();

      // Kill server process
      this.serverProcess.kill('SIGTERM');
      
      // Force kill after 2 seconds
      setTimeout(() => {
        if (this.serverProcess) {
          this.serverProcess.kill('SIGKILL');
        }
      }, 2000);

      this.serverProcess = null;
      this.isReady = false;
    }
  }
}

// --- SINGLETON INSTANCE ---
let clientInstance = null;

function getClient() {
  if (!clientInstance) {
    clientInstance = new OpenNutritionClient();
    
    // Graceful shutdown on process exit
    process.on('exit', () => {
      if (clientInstance) {
        clientInstance.shutdown();
      }
    });
    
    process.on('SIGTERM', () => {
      if (clientInstance) {
        clientInstance.shutdown();
      }
      process.exit(0);
    });
  }
  return clientInstance;
}

module.exports = {
  OpenNutritionClient,
  getClient
};