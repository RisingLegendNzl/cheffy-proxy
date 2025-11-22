// web/src/components/MyPlansModal.jsx
// Modal for managing saved meal plans
// Allows users to view, load, delete, and mark plans as active

import React, { useState } from 'react';
import { 
  X, 
  Save, 
  Trash2, 
  Check, 
  Calendar,
  DollarSign,
  Flame,
  Clock,
  Star,
  StarOff,
  Loader,
  FolderOpen,
  FileText,
  ChevronRight
} from 'lucide-react';
import { COLORS, SHADOWS, Z_INDEX } from '../constants';

/**
 * MyPlansModal Component
 * Displays and manages saved meal plans
 */
const MyPlansModal = ({ 
  isOpen, 
  onClose, 
  savedPlans = [],
  activePlanId,
  onLoadPlan,
  onDeletePlan,
  onSetActivePlan,
  isLoading = false,
  currentPlanData = null,
  onSaveCurrentPlan
}) => {
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [savePlanName, setSavePlanName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  if (!isOpen) return null;

  const handleLoadPlan = async (planId) => {
    setSelectedPlanId(planId);
    await onLoadPlan(planId);
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleDeletePlan = async (planId, e) => {
    e.stopPropagation(); // Prevent triggering load
    
    if (!window.confirm('Are you sure you want to delete this plan?')) {
      return;
    }

    setIsDeleting(true);
    await onDeletePlan(planId);
    setIsDeleting(false);
  };

  const handleToggleActive = async (planId, e) => {
    e.stopPropagation(); // Prevent triggering load
    
    if (planId === activePlanId) {
      // Clear active plan
      await onSetActivePlan(null);
    } else {
      // Set as active
      await onSetActivePlan(planId);
    }
  };

  const handleSaveCurrentPlan = async () => {
    if (!savePlanName.trim()) return;
    
    await onSaveCurrentPlan(savePlanName);
    setSavePlanName('');
    setShowSaveForm(false);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return formatDate(dateString);
  };

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ 
        zIndex: Z_INDEX.modal,
        backgroundColor: 'rgba(0, 0, 0, 0.5)'
      }}
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col animate-slideUp"
        style={{ boxShadow: SHADOWS.xl }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div 
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: COLORS.gray[200] }}
        >
          <div className="flex items-center space-x-3">
            <FolderOpen size={24} style={{ color: COLORS.primary[500] }} />
            <div>
              <h2 className="text-xl font-bold" style={{ color: COLORS.gray[900] }}>
                My Saved Plans
              </h2>
              <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                {savedPlans.length} saved plan{savedPlans.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={20} style={{ color: COLORS.gray[500] }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Save Current Plan Section */}
          {currentPlanData && (
            <div className="mb-6">
              {!showSaveForm ? (
                <button
                  onClick={() => setShowSaveForm(true)}
                  className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg transition-all flex items-center justify-center space-x-2"
                >
                  <Save size={18} />
                  <span>Save Current Plan</span>
                </button>
              ) : (
                <div className="bg-indigo-50 rounded-xl p-4">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={savePlanName}
                      onChange={(e) => setSavePlanName(e.target.value)}
                      placeholder="Enter plan name..."
                      className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      style={{ borderColor: COLORS.gray[300] }}
                      autoFocus
                      onKeyPress={(e) => e.key === 'Enter' && handleSaveCurrentPlan()}
                    />
                    <button
                      onClick={handleSaveCurrentPlan}
                      disabled={!savePlanName.trim()}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setShowSaveForm(false);
                        setSavePlanName('');
                      }}
                      className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Plans List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="animate-spin" size={32} style={{ color: COLORS.primary[500] }} />
            </div>
          ) : savedPlans.length === 0 ? (
            <div className="text-center py-12">
              <FileText size={48} style={{ color: COLORS.gray[300] }} className="mx-auto mb-3" />
              <p className="text-lg font-medium mb-1" style={{ color: COLORS.gray[700] }}>
                No saved plans yet
              </p>
              <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                Generate a meal plan and save it here for quick access
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedPlans.map((plan) => (
                <div
                  key={plan.planId}
                  onClick={() => handleLoadPlan(plan.planId)}
                  className={`
                    border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md
                    ${selectedPlanId === plan.planId ? 'ring-2 ring-indigo-500 border-indigo-500' : ''}
                    ${plan.isActive ? 'bg-indigo-50 border-indigo-300' : 'bg-white hover:bg-gray-50'}
                  `}
                  style={{ 
                    borderColor: plan.isActive ? COLORS.primary[300] : COLORS.gray[200],
                    boxShadow: selectedPlanId === plan.planId ? SHADOWS.md : 'none'
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-semibold text-lg" style={{ color: COLORS.gray[900] }}>
                          {plan.name}
                        </h3>
                        {plan.isActive && (
                          <span className="px-2 py-0.5 bg-indigo-600 text-white text-xs rounded-full font-medium">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      
                      {/* Plan Stats */}
                      <div className="flex flex-wrap items-center gap-3 text-sm mb-2">
                        <div className="flex items-center space-x-1">
                          <Calendar size={14} style={{ color: COLORS.gray[400] }} />
                          <span style={{ color: COLORS.gray[600] }}>
                            {plan.days || 7} days
                          </span>
                        </div>
                        {plan.totalCost > 0 && (
                          <div className="flex items-center space-x-1">
                            <DollarSign size={14} style={{ color: COLORS.gray[400] }} />
                            <span style={{ color: COLORS.gray[600] }}>
                              ${plan.totalCost.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {plan.totalCalories > 0 && (
                          <div className="flex items-center space-x-1">
                            <Flame size={14} style={{ color: COLORS.gray[400] }} />
                            <span style={{ color: COLORS.gray[600] }}>
                              {Math.round(plan.totalCalories / (plan.days || 7))} cal/day
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Plan Details */}
                      {plan.formData && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {plan.formData.goal && (
                            <span 
                              className="px-2 py-0.5 rounded text-xs font-medium"
                              style={{ 
                                backgroundColor: COLORS.info.light,
                                color: COLORS.info.main
                              }}
                            >
                              {plan.formData.goal.replace(/_/g, ' ')}
                            </span>
                          )}
                          {plan.formData.dietary && plan.formData.dietary !== 'None' && (
                            <span 
                              className="px-2 py-0.5 rounded text-xs font-medium"
                              style={{ 
                                backgroundColor: COLORS.success.light,
                                color: COLORS.success.main
                              }}
                            >
                              {plan.formData.dietary}
                            </span>
                          )}
                          {plan.formData.store && (
                            <span 
                              className="px-2 py-0.5 rounded text-xs font-medium"
                              style={{ 
                                backgroundColor: COLORS.gray[100],
                                color: COLORS.gray[700]
                              }}
                            >
                              {plan.formData.store}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* Timestamps */}
                      <div className="flex items-center space-x-1 text-xs">
                        <Clock size={12} style={{ color: COLORS.gray[400] }} />
                        <span style={{ color: COLORS.gray[500] }}>
                          Created {formatTime(plan.createdAt)}
                        </span>
                        {plan.lastAccessed && (
                          <span style={{ color: COLORS.gray[400] }}>
                            • Last viewed {formatTime(plan.lastAccessed)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-1 ml-3">
                      <button
                        onClick={(e) => handleToggleActive(plan.planId, e)}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                        title={plan.isActive ? 'Remove as active' : 'Set as active'}
                      >
                        {plan.isActive ? (
                          <Star size={18} style={{ color: COLORS.warning.main }} fill={COLORS.warning.main} />
                        ) : (
                          <StarOff size={18} style={{ color: COLORS.gray[400] }} />
                        )}
                      </button>
                      <button
                        onClick={(e) => handleDeletePlan(plan.planId, e)}
                        disabled={isDeleting}
                        className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                        title="Delete plan"
                      >
                        <Trash2 size={18} style={{ color: COLORS.error.main }} />
                      </button>
                      <ChevronRight size={18} style={{ color: COLORS.gray[400] }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div 
          className="px-6 py-4 border-t flex items-center justify-between"
          style={{ borderColor: COLORS.gray[200], backgroundColor: COLORS.gray[50] }}
        >
          <p className="text-sm" style={{ color: COLORS.gray[500] }}>
            Plans are saved for 30 days
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default MyPlansModal;