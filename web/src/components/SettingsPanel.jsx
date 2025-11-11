// web/src/components/SettingsPanel.jsx
import React, { useState, useEffect } from 'react';
import { 
  X, 
  Store, 
  Terminal,
  Eye,
  EyeOff,
  Trash2,
  Save
} from 'lucide-react';
import { COLORS, Z_INDEX, SHADOWS } from '../constants';
import { APP_CONFIG } from '../constants';

/**
 * Settings panel/modal for app preferences
 * Enhanced with mobile bottom sheet behavior
 */
const SettingsPanel = ({ 
  isOpen, 
  onClose,
  currentStore = 'Woolworths',
  onStoreChange,
  onClearData,
  showOrchestratorLogs = true,
  onToggleOrchestratorLogs,
  showFailedIngredientsLogs = true,
  onToggleFailedIngredientsLogs,
}) => {
  const [selectedStore, setSelectedStore] = useState(currentStore);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!isOpen) return null;

  const handleSave = () => {
    if (onStoreChange) {
      onStoreChange(selectedStore);
    }
    onClose();
  };

  const handleClearAllData = () => {
    console.log('Attempting to clear all data.');
    if (onClearData) {
      onClearData();
    }
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 animate-fadeIn"
        style={{ zIndex: Z_INDEX.modalBackdrop }}
        onClick={onClose}
      />

      {/* Panel - Bottom sheet on mobile, side panel on desktop */}
      <div
        className={`fixed bg-white shadow-2xl overflow-y-auto ${
          isMobile 
            ? 'bottom-0 left-0 right-0 rounded-t-3xl animate-slideUp max-h-[85vh]' 
            : 'top-0 right-0 bottom-0 w-full md:w-96 animate-slideLeft'
        }`}
        style={{ 
          zIndex: Z_INDEX.modal,
          paddingBottom: isMobile ? 'env(safe-area-inset-bottom)' : '0',
        }}
      >
        {/* Drag Handle (mobile only) */}
        {isMobile && (
          <div className="flex justify-center pt-3 pb-2">
            <div
              className="w-12 h-1 rounded-full"
              style={{ backgroundColor: COLORS.gray[300] }}
            />
          </div>
        )}

        {/* Header */}
        <div
          className={`sticky top-0 text-white p-6 flex items-center justify-between ${
            isMobile ? 'rounded-t-3xl' : ''
          }`}
          style={{ 
            zIndex: 10,
            background: COLORS.gradients.primary,
          }}
        >
          <h2 
            className="text-2xl font-bold"
            style={{ fontFamily: 'var(--font-family-display)' }}
          >
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white hover:bg-opacity-20 transition-fast"
            style={{ minWidth: '44px', minHeight: '44px' }}
            aria-label="Close settings"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Preferences Section */}
          <div>
            <div className="flex items-center mb-4">
              <Store size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
              <h3 className="font-bold" style={{ color: COLORS.gray[900] }}>
                Preferences
              </h3>
            </div>

            {/* Default Store */}
            <div className="mb-4">
              <label 
                className="block text-sm font-semibold mb-2" 
                style={{ color: COLORS.gray[700] }}
                htmlFor="store-select"
              >
                Default Store
              </label>
              <select
                id="store-select"
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full p-3 border rounded-lg"
                style={{
                  borderColor: COLORS.gray[300],
                  color: COLORS.gray[900],
                  minHeight: '44px',
                }}
              >
                <option value="Woolworths">Woolworths</option>
                <option value="Coles">Coles</option>
              </select>
            </div>

            {/* Units */}
            <div className="mb-4">
              <label 
                className="block text-sm font-semibold mb-2" 
                style={{ color: COLORS.gray[700] }}
                htmlFor="units-select"
              >
                Measurement Units
              </label>
              <select
                id="units-select"
                className="w-full p-3 border rounded-lg"
                style={{
                  borderColor: COLORS.gray[300],
                  color: COLORS.gray[900],
                  minHeight: '44px',
                }}
              >
                <option value="metric">Metric (kg, g)</option>
                <option value="imperial">Imperial (lb, oz)</option>
              </select>
            </div>
          </div>

          {/* Diagnostics Section */}
          <div>
            <div className="flex items-center mb-4">
              <Terminal size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
              <h3 className="font-bold" style={{ color: COLORS.gray[900] }}>
                Diagnostics
              </h3>
            </div>

            {/* Show Orchestrator Logs Toggle */}
            <div 
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-3 hover:bg-gray-100 transition-fast"
              style={{ minHeight: '60px' }}
            >
              <div className="flex items-center flex-1">
                <Terminal size={16} className="mr-2" style={{ color: COLORS.gray[600] }} />
                <label 
                  className="text-sm font-semibold cursor-pointer flex-1" 
                  style={{ color: COLORS.gray[700] }}
                  htmlFor="orchestrator-logs"
                >
                  Orchestrator Logs
                </label>
              </div>
              <button
                id="orchestrator-logs"
                onClick={() => onToggleOrchestratorLogs && onToggleOrchestratorLogs(!showOrchestratorLogs)}
                className="p-2 rounded-lg transition-fast"
                style={{
                  backgroundColor: showOrchestratorLogs ? COLORS.success.light : COLORS.gray[200],
                  color: showOrchestratorLogs ? COLORS.success.dark : COLORS.gray[600],
                  minWidth: '44px',
                  minHeight: '44px',
                }}
                aria-label={`${showOrchestratorLogs ? 'Hide' : 'Show'} orchestrator logs`}
              >
                {showOrchestratorLogs ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>

            {/* Show Failed Ingredients Logs Toggle */}
            <div 
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-fast"
              style={{ minHeight: '60px' }}
            >
              <div className="flex items-center flex-1">
                <Terminal size={16} className="mr-2" style={{ color: COLORS.gray[600] }} />
                <label 
                  className="text-sm font-semibold cursor-pointer flex-1" 
                  style={{ color: COLORS.gray[700] }}
                  htmlFor="failed-logs"
                >
                  Failed Ingredients Logs
                </label>
              </div>
              <button
                id="failed-logs"
                onClick={() => onToggleFailedIngredientsLogs && onToggleFailedIngredientsLogs(!showFailedIngredientsLogs)}
                className="p-2 rounded-lg transition-fast"
                style={{
                  backgroundColor: showFailedIngredientsLogs ? COLORS.success.light : COLORS.gray[200],
                  color: showFailedIngredientsLogs ? COLORS.success.dark : COLORS.gray[600],
                  minWidth: '44px',
                  minHeight: '44px',
                }}
                aria-label={`${showFailedIngredientsLogs ? 'Hide' : 'Show'} failed ingredients logs`}
              >
                {showFailedIngredientsLogs ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div>
            <h3 
              className="font-bold mb-4 flex items-center" 
              style={{ color: COLORS.error.main }}
            >
              <Trash2 size={20} className="mr-2" />
              Danger Zone
            </h3>
            
            <button
              onClick={handleClearAllData}
              className="w-full p-4 border-2 rounded-lg font-semibold transition-all hover-lift"
              style={{
                borderColor: COLORS.error.main,
                color: COLORS.error.main,
                backgroundColor: COLORS.error.light,
                minHeight: '48px',
              }}
            >
              Clear All Data
            </button>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="w-full p-4 rounded-lg font-semibold text-white transition-all hover-lift"
            style={{
              background: COLORS.gradients.primary,
              boxShadow: SHADOWS.md,
              minHeight: '48px',
            }}
          >
            <Save size={20} className="inline mr-2" />
            Save Changes
          </button>

          {/* App Version */}
          <div className="text-center pt-4 border-t" style={{ borderColor: COLORS.gray[200] }}>
            <p className="text-xs" style={{ color: COLORS.gray[400] }}>
              {APP_CONFIG.name} v{APP_CONFIG.version}
            </p>
          </div>
        </div>
      </div>

      {/* Slide up animation for mobile */}
      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
        .animate-slideUp {
          animation: slideUp 300ms ease-out;
        }
      `}</style>
    </>
  );
};

export default SettingsPanel;