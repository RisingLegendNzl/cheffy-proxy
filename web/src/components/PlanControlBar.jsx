// web/src/components/PlanControlBar.jsx
// Control bar for plan persistence features
// Displays save status and quick actions

import React from 'react';
import { 
  Save, 
  FolderOpen, 
  Check, 
  Clock,
  CloudOff,
  Loader,
  Download,
  Upload
} from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';

/**
 * PlanControlBar Component
 * Provides quick access to plan persistence features
 */
const PlanControlBar = ({
  hasCurrentPlan = false,
  isSaving = false,
  lastSaveDisplay = '',
  hasUnsavedChanges = false,
  savedPlansCount = 0,
  activePlanName = null,
  onSaveClick,
  onOpenMyPlans,
  onLoadCurrent,
  isConnected = true
}) => {
  return (
    <div 
      className="bg-white rounded-xl shadow-sm border px-4 py-3 mb-4"
      style={{ borderColor: COLORS.gray[200] }}
    >
      <div className="flex items-center justify-between">
        {/* Left Section - Save Status */}
        <div className="flex items-center space-x-4">
          {/* Auto-save Status */}
          {hasCurrentPlan && (
            <div className="flex items-center space-x-2">
              {isSaving ? (
                <>
                  <Loader className="animate-spin" size={16} style={{ color: COLORS.primary[500] }} />
                  <span className="text-sm" style={{ color: COLORS.gray[600] }}>
                    Saving...
                  </span>
                </>
              ) : hasUnsavedChanges ? (
                <>
                  <Clock size={16} style={{ color: COLORS.warning.main }} />
                  <span className="text-sm" style={{ color: COLORS.warning.main }}>
                    Unsaved changes
                  </span>
                </>
              ) : lastSaveDisplay ? (
                <>
                  <Check size={16} style={{ color: COLORS.success.main }} />
                  <span className="text-sm" style={{ color: COLORS.gray[600] }}>
                    {lastSaveDisplay}
                  </span>
                </>
              ) : null}
            </div>
          )}

          {/* Connection Status */}
          {!isConnected && (
            <div className="flex items-center space-x-2">
              <CloudOff size={16} style={{ color: COLORS.error.main }} />
              <span className="text-sm" style={{ color: COLORS.error.main }}>
                Offline
              </span>
            </div>
          )}

          {/* Active Plan Indicator */}
          {activePlanName && (
            <div 
              className="flex items-center space-x-2 px-3 py-1 rounded-lg"
              style={{ backgroundColor: COLORS.primary[50] }}
            >
              <span className="text-sm font-medium" style={{ color: COLORS.primary[700] }}>
                Active: {activePlanName}
              </span>
            </div>
          )}
        </div>

        {/* Right Section - Actions */}
        <div className="flex items-center space-x-2">
          {/* Load Current Plan */}
          {!hasCurrentPlan && lastSaveDisplay && (
            <button
              onClick={onLoadCurrent}
              className="flex items-center space-x-2 px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              style={{ color: COLORS.primary[600] }}
              title="Load previous plan"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Load Previous</span>
            </button>
          )}

          {/* Quick Save */}
          {hasCurrentPlan && (
            <button
              onClick={onSaveClick}
              disabled={isSaving}
              className="flex items-center space-x-2 px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
              title="Save plan with name"
            >
              <Save size={16} />
              <span className="hidden sm:inline">Save Plan</span>
            </button>
          )}

          {/* My Plans */}
          <button
            onClick={onOpenMyPlans}
            className="flex items-center space-x-2 px-3 py-1.5 text-sm font-medium border rounded-lg hover:bg-gray-50 transition-colors"
            style={{ 
              borderColor: COLORS.gray[300],
              color: COLORS.gray[700]
            }}
            title={`${savedPlansCount} saved plans`}
          >
            <FolderOpen size={16} />
            <span className="hidden sm:inline">My Plans</span>
            {savedPlansCount > 0 && (
              <span 
                className="ml-1 px-1.5 py-0.5 text-xs rounded-full font-medium"
                style={{ 
                  backgroundColor: COLORS.primary[100],
                  color: COLORS.primary[700]
                }}
              >
                {savedPlansCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanControlBar;