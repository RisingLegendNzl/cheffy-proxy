// web/src/components/SettingsPanel.jsx
import React, { useState } from 'react';
import { 
  X, 
  User, 
  Store, 
  Globe, 
  Info, 
  Shield,
  ChevronRight,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Terminal,
  ListX,
  Target
} from 'lucide-react';
import { COLORS, Z_INDEX, SHADOWS } from '../constants';
import { APP_CONFIG } from '../constants';

/**
 * Settings panel/modal for app preferences
 */
const SettingsPanel = ({ 
  isOpen, 
  onClose,
  currentStore = 'Woolworths',
  onStoreChange,
  onClearData,
  onEditProfile, // Prop is still received but not used
  showOrchestratorLogs = true,
  onToggleOrchestratorLogs,
  showFailedIngredientsLogs = true,
  onToggleFailedIngredientsLogs,
  // NEW: Macro Debug Log props with defensive defaults
  showMacroDebugLog = false,
  onToggleMacroDebugLog = () => {},
}) => {
  const [selectedStore, setSelectedStore] = useState(currentStore);

  if (!isOpen) return null;

  const handleSave = () => {
    if (onStoreChange) {
      onStoreChange(selectedStore);
    }
    onClose();
  };

  // This function is no longer called from the UI, but kept to avoid breaking prop chain
  const handleEditProfileClick = () => {
    if (onEditProfile) {
      onEditProfile();
    }
  };

  const handleClearAllData = () => {
    // Replaced window.confirm with a simple console log as per instructions
    console.log('Attempting to clear all data. (Confirmation skipped)');
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

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 w-full md:w-96 bg-white shadow-2xl overflow-y-auto animate-slideLeft"
        style={{ zIndex: Z_INDEX.modal }}
      >
        {/* Header */}
        <div
          className="sticky top-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 flex items-center justify-between"
          style={{ zIndex: 10 }}
        >
          <h2 className="text-2xl font-bold">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white hover:bg-opacity-20 transition-fast"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          {/* Profile Section Removed */}

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
              <label className="block text-sm font-semibold mb-2" style={{ color: COLORS.gray[700] }}>
                Default Store
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full p-3 border rounded-lg"
                style={{
                  borderColor: COLORS.gray[300],
                  color: COLORS.gray[900],
                }}
              >
                <option value="Woolworths">Woolworths</option>
                <option value="Coles">Coles</option>
              </select>
            </div>

            {/* Units */}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2" style={{ color: COLORS.gray[700] }}>
                Measurement Units
              </label>
              <select
                className="w-full p-3 border rounded-lg"
                style={{
                  borderColor: COLORS.gray[300],
                  color: COLORS.gray[900],
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
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-3 hover:bg-gray-100 transition-fast">
              <div className="flex items-center">
                <Terminal size={16} className="mr-2" style={{ color: COLORS.gray[600] }} />
                <label className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                  Orchestrator Logs
                </label>
              </div>
              <button
                onClick={() => onToggleOrchestratorLogs && onToggleOrchestratorLogs(!showOrchestratorLogs)}
                className="p-2 rounded-lg transition-fast"
                style={{
                  backgroundColor: showOrchestratorLogs ? COLORS.success.light : COLORS.gray[200],
                  color: showOrchestratorLogs ? COLORS.success.dark : COLORS.gray[600],
                }}
              >
                {showOrchestratorLogs ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>

            {/* Show Failed Ingredients Logs Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-3 hover:bg-gray-100 transition-fast">
              <div className="flex items-center">
                <ListX size={16} className="mr-2" style={{ color: COLORS.gray[600] }} />
                <label className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                  Failed Ingredients Log
                </label>
              </div>
              <button
                onClick={() => onToggleFailedIngredientsLogs && onToggleFailedIngredientsLogs(!showFailedIngredientsLogs)}
                className="p-2 rounded-lg transition-fast"
                style={{
                  backgroundColor: showFailedIngredientsLogs ? COLORS.success.light : COLORS.gray[200],
                  color: showFailedIngredientsLogs ? COLORS.success.dark : COLORS.gray[600],
                }}
              >
                {showFailedIngredientsLogs ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>

            {/* NEW: Show Macro Debug Log Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-3 hover:bg-gray-100 transition-fast">
              <div className="flex items-center">
                <Target size={16} className="mr-2" style={{ color: COLORS.gray[600] }} />
                <label className="text-sm font-semibold" style={{ color: COLORS.gray[700] }}>
                  Macro Debug Log
                </label>
              </div>
              <button
                onClick={() => onToggleMacroDebugLog && onToggleMacroDebugLog(!showMacroDebugLog)}
                className="p-2 rounded-lg transition-fast"
                style={{
                  backgroundColor: showMacroDebugLog ? COLORS.success.light : COLORS.gray[200],
                  color: showMacroDebugLog ? COLORS.success.dark : COLORS.gray[600],
                }}
              >
                {showMacroDebugLog ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>

            <p className="text-xs mt-3" style={{ color: COLORS.gray[500] }}>
              Toggle diagnostic logs on/off. These are useful for troubleshooting but can clutter the interface.
            </p>
          </div>

          {/* App Info */}
          <div>
            <div className="flex items-center mb-4">
              <Info size={20} className="mr-2" style={{ color: COLORS.primary[600] }} />
              <h3 className="font-bold" style={{ color: COLORS.gray[900] }}>
                About
              </h3>
            </div>
            <div className="space-y-2 text-sm">
              <p style={{ color: COLORS.gray[600] }}>
                <strong>App Name:</strong> {APP_CONFIG.name}
              </p>
              <p style={{ color: COLORS.gray[600] }}>
                <strong>Version:</strong> {APP_CONFIG.version}
              </p>
              <button
                className="flex items-center text-indigo-600 hover:text-indigo-700"
              >
                View Privacy Policy
                <ChevronRight size={16} className="ml-1" />
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div>
            <div className="flex items-center mb-4">
              <Trash2 size={20} className="mr-2" style={{ color: COLORS.error.main }} />
              <h3 className="font-bold" style={{ color: COLORS.error.main }}>
                Danger Zone
              </h3>
            </div>
            <button
              onClick={handleClearAllData}
              className="w-full p-4 bg-red-50 border-2 border-red-200 rounded-lg hover:bg-red-100 transition-fast"
              style={{ color: COLORS.error.main }}
            >
              <Trash2 size={20} className="inline mr-2" />
              Clear All Data
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className="sticky bottom-0 bg-white border-t p-6 flex space-x-3"
          style={{ borderColor: COLORS.gray[200] }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-lg font-semibold border transition-fast"
            style={{
              borderColor: COLORS.gray[300],
              color: COLORS.gray[700],
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 rounded-lg font-semibold text-white hover-lift transition-spring"
            style={{ backgroundColor: COLORS.primary[500] }}
          >
            <Save size={18} className="inline mr-2" />
            Save Changes
          </button>
        </div>
      </div>
    </>
  );
};

export default SettingsPanel;