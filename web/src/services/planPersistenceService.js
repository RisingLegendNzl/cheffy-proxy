// web/src/services/planPersistenceService.js
// Service layer for meal plan persistence
// Handles all API communication with the /api/plans endpoint

/**
 * PlanPersistenceService
 * Centralized service for all plan persistence operations
 */
class PlanPersistenceService {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.endpoint = `${baseUrl}/api/plans`;
  }

  // --- Helper method for API calls ---
  async request(method, params = {}, body = null) {
    const url = new URL(this.endpoint);
    
    // Add query parameters for GET requests
    if (method === 'GET' && params) {
      Object.keys(params).forEach(key => 
        url.searchParams.append(key, params[key])
      );
    }

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': params.userId || ''
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Request failed');
      }
      
      return data;
    } catch (error) {
      console.error(`[PlanPersistenceService] ${method} Error:`, error);
      throw error;
    }
  }

  // --- Current Plan Operations ---
  
  /**
   * Auto-save the current plan
   */
  async saveCurrentPlan(userId, planData) {
    return this.request('POST', { userId }, {
      action: 'saveCurrent',
      planData
    });
  }

  /**
   * Get the auto-saved current plan
   */
  async getCurrentPlan(userId) {
    return this.request('GET', { 
      userId,
      action: 'current'
    });
  }

  // --- Named Plans Operations ---
  
  /**
   * Save a plan with a custom name
   */
  async saveNamedPlan(userId, name, planData) {
    return this.request('POST', { userId }, {
      action: 'saveNamed',
      name,
      planData
    });
  }

  /**
   * List all saved plans for a user
   */
  async listSavedPlans(userId) {
    return this.request('GET', { 
      userId,
      action: 'list'
    });
  }

  /**
   * Load a specific saved plan
   */
  async loadSavedPlan(userId, planId) {
    return this.request('GET', { 
      userId,
      action: 'load',
      planId
    });
  }

  /**
   * Delete a saved plan
   */
  async deleteSavedPlan(userId, planId) {
    return this.request('POST', { userId }, {
      action: 'delete',
      planId
    });
  }

  // --- Active Plan Operations ---
  
  /**
   * Set a plan as the active plan
   */
  async setActivePlan(userId, planId) {
    return this.request('POST', { userId }, {
      action: 'setActive',
      planId
    });
  }

  /**
   * Get the currently active plan
   */
  async getActivePlan(userId) {
    return this.request('GET', { 
      userId,
      action: 'active'
    });
  }

  /**
   * Clear the active plan
   */
  async clearActivePlan(userId) {
    return this.request('POST', { userId }, {
      action: 'setActive',
      planId: null
    });
  }
}

// Create and export singleton instance
const planPersistenceService = new PlanPersistenceService();
export default planPersistenceService;