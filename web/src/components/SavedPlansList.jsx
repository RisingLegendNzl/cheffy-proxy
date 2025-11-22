// web/src/components/SavedPlansList.jsx
import React from 'react';
import { X, Bookmark, AlertCircle, Loader } from 'lucide-react';
import { COLORS, Z_INDEX } from '../constants';
import PlanCard from './PlanCard';

const SavedPlansList = ({ 
  isOpen, 
  onClose, 
  plans = [], 
  activePlanId = null,
  loading = false,
  error = null,
  onLoadPlan,
  onDeletePlan,
  onSetActivePlan,
  onRefresh
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 animate-fadeIn"
        style={{ zIndex: Z_INDEX.modalBackdrop }}
        onClick={onClose}
      />

      <div
        className="fixed top-0 right-0 bottom-0 w-full md:w-96 bg-white shadow-2xl overflow-y-auto animate-slideLeft"
        style={{ zIndex: Z_INDEX.modal }}
      >
        <div
          className="sticky top-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 flex items-center justify-between"
          style={{ zIndex: 10 }}
        >
          <div className="flex items-center space-x-3">
            <Bookmark size={24} />
            <h2 className="text-2xl font-bold">My Saved Plans</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white hover:bg-opacity-20 transition-fast"
          >
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div
              className="mb-4 p-4 rounded-lg flex items-start space-x-3"
              style={{ backgroundColor: COLORS.error.light }}
            >
              <AlertCircle size={20} style={{ color: COLORS.error.main }} />
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: COLORS.error.dark }}>
                  Error
                </p>
                <p className="text-sm" style={{ color: COLORS.error.dark }}>
                  {error}
                </p>
              </div>
            </div>
          )}

          {loading && plans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader size={40} className="animate-spin mb-4" style={{ color: COLORS.primary[500] }} />
              <p style={{ color: COLORS.gray[600] }}>Loading your plans...</p>
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-12">
              <Bookmark size={48} className="mx-auto mb-4" style={{ color: COLORS.gray[300] }} />
              <h3 className="text-lg font-semibold mb-2" style={{ color: COLORS.gray[900] }}>
                No Saved Plans
              </h3>
              <p className="text-sm" style={{ color: COLORS.gray[600] }}>
                Generate a meal plan and save it to see it here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.planId}
                  plan={plan}
                  isActive={plan.planId === activePlanId}
                  onLoad={onLoadPlan}
                  onDelete={onDeletePlan}
                  onSetActive={onSetActivePlan}
                  loading={loading}
                />
              ))}
            </div>
          )}

          {plans.length > 0 && (
            <div className="mt-6 text-center">
              <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                {plans.length} {plans.length === 1 ? 'plan' : 'plans'} saved
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default SavedPlansList;