// web/src/components/SavePlanModal.jsx
import React, { useState } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { COLORS, Z_INDEX, SHADOWS } from '../constants';

const SavePlanModal = ({ isOpen, onClose, onSave, loading = false, error = null }) => {
  const [planName, setPlanName] = useState('');
  const [localError, setLocalError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError('');

    if (!planName.trim()) {
      setLocalError('Please enter a plan name');
      return;
    }

    if (planName.trim().length < 3) {
      setLocalError('Plan name must be at least 3 characters');
      return;
    }

    onSave(planName.trim());
  };

  const handleClose = () => {
    if (!loading) {
      setPlanName('');
      setLocalError('');
      onClose();
    }
  };

  const displayError = localError || error;

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 animate-fadeIn"
        style={{ zIndex: Z_INDEX.modalBackdrop }}
        onClick={handleClose}
      />

      <div
        className="fixed inset-0 flex items-center justify-center p-4 animate-scaleIn"
        style={{ zIndex: Z_INDEX.modal }}
      >
        <div
          className="bg-white rounded-2xl w-full max-w-md"
          style={{ boxShadow: SHADOWS['2xl'] }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 className="text-2xl font-bold" style={{ color: COLORS.gray[900] }}>
              Save Meal Plan
            </h2>
            <button
              onClick={handleClose}
              disabled={loading}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              <X size={24} style={{ color: COLORS.gray[600] }} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div>
              <label
                htmlFor="planName"
                className="block text-sm font-semibold mb-2"
                style={{ color: COLORS.gray[700] }}
              >
                Plan Name
              </label>
              <input
                id="planName"
                type="text"
                value={planName}
                onChange={(e) => {
                  setPlanName(e.target.value);
                  setLocalError('');
                }}
                placeholder="e.g., My Weekly Meal Plan"
                disabled={loading}
                className="w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-indigo-500 focus:outline-none transition-colors"
                style={{
                  backgroundColor: loading ? COLORS.gray[50] : 'white'
                }}
                maxLength={50}
                autoFocus
              />
              <p className="text-xs mt-1" style={{ color: COLORS.gray[500] }}>
                {planName.length}/50 characters
              </p>
            </div>

            {displayError && (
              <div
                className="p-3 rounded-lg flex items-start space-x-2"
                style={{ backgroundColor: COLORS.error.light }}
              >
                <AlertCircle size={20} style={{ color: COLORS.error.main }} />
                <p className="text-sm" style={{ color: COLORS.error.dark }}>
                  {displayError}
                </p>
              </div>
            )}

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="flex-1 py-3 rounded-lg font-semibold border transition-fast disabled:opacity-50"
                style={{
                  borderColor: COLORS.gray[300],
                  color: COLORS.gray[700],
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !planName.trim()}
                className="flex-1 py-3 rounded-lg font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                style={{ backgroundColor: COLORS.primary[500] }}
              >
                {loading ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Save size={18} />
                    <span>Save Plan</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default SavePlanModal;