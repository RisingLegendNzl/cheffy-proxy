// web/src/components/SavedPlansModal.jsx
// Modal for viewing, loading, and deleting saved meal plans
// Opened from the menu, not a separate tab

import React, { useState } from 'react';
import { X, Calendar, Trash2, Download, CheckCircle } from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';

/**
 * Modal component for managing saved meal plans
 */
const SavedPlansModal = ({
    isOpen,
    onClose,
    savedPlans,
    activePlanId,
    onLoadPlan,
    onDeletePlan,
    loadingPlan
}) => {
    const [deletingPlanId, setDeletingPlanId] = useState(null);

    if (!isOpen) return null;

    const handleLoadClick = async (planId) => {
        const success = await onLoadPlan(planId);
        if (success) {
            onClose();
        }
    };

    const handleDeleteClick = async (planId) => {
        if (!window.confirm('Are you sure you want to delete this plan?')) {
            return;
        }

        setDeletingPlanId(planId);
        await onDeletePlan(planId);
        setDeletingPlanId(null);
    };

    const formatDate = (isoString) => {
        try {
            const date = new Date(isoString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            return 'Unknown date';
        }
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-50 transition-opacity"
                onClick={onClose}
                style={{ backdropFilter: 'blur(4px)' }}
            />

            {/* Modal */}
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <div
                    className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                    style={{ boxShadow: SHADOWS.xl }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between p-6 border-b"
                        style={{ borderColor: COLORS.gray[200] }}
                    >
                        <div className="flex items-center space-x-3">
                            <Calendar size={24} style={{ color: COLORS.primary[600] }} />
                            <h2
                                className="text-2xl font-bold"
                                style={{ color: COLORS.gray[900] }}
                            >
                                My Saved Plans
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                            aria-label="Close"
                        >
                            <X size={24} style={{ color: COLORS.gray[600] }} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="overflow-y-auto max-h-[calc(80vh-80px)]">
                        {savedPlans.length === 0 ? (
                            <div className="p-12 text-center">
                                <Calendar
                                    size={48}
                                    className="mx-auto mb-4 opacity-30"
                                    style={{ color: COLORS.gray[400] }}
                                />
                                <p
                                    className="text-lg font-medium mb-2"
                                    style={{ color: COLORS.gray[600] }}
                                >
                                    No saved plans yet
                                </p>
                                <p
                                    className="text-sm"
                                    style={{ color: COLORS.gray[500] }}
                                >
                                    Generate a meal plan and save it to see it here
                                </p>
                            </div>
                        ) : (
                            <div className="p-6 space-y-3">
                                {savedPlans.map((plan) => {
                                    const isActive = plan.planId === activePlanId;
                                    const isDeleting = deletingPlanId === plan.planId;

                                    return (
                                        <div
                                            key={plan.planId}
                                            className="border rounded-xl p-4 hover:shadow-md transition-all"
                                            style={{
                                                borderColor: isActive ? COLORS.primary[300] : COLORS.gray[200],
                                                backgroundColor: isActive ? `${COLORS.primary[50]}` : 'white'
                                            }}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center space-x-2 mb-2">
                                                        <h3
                                                            className="text-lg font-semibold truncate"
                                                            style={{ color: COLORS.gray[900] }}
                                                        >
                                                            {plan.name}
                                                        </h3>
                                                        {isActive && (
                                                            <CheckCircle
                                                                size={18}
                                                                style={{ color: COLORS.primary[600] }}
                                                            />
                                                        )}
                                                    </div>
                                                    <div className="flex items-center space-x-4 text-sm">
                                                        <span style={{ color: COLORS.gray[600] }}>
                                                            {plan.mealPlan?.length || 0} days
                                                        </span>
                                                        <span style={{ color: COLORS.gray[400] }}>•</span>
                                                        <span style={{ color: COLORS.gray[600] }}>
                                                            {formatDate(plan.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center space-x-2 ml-4">
                                                    {/* Load Button */}
                                                    <button
                                                        onClick={() => handleLoadClick(plan.planId)}
                                                        disabled={loadingPlan || isDeleting}
                                                        className="p-2 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
                                                        style={{ color: COLORS.primary[600] }}
                                                        aria-label="Load plan"
                                                    >
                                                        <Download size={20} />
                                                    </button>

                                                    {/* Delete Button */}
                                                    <button
                                                        onClick={() => handleDeleteClick(plan.planId)}
                                                        disabled={loadingPlan || isDeleting}
                                                        className="p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                                                        style={{ color: COLORS.red }}
                                                        aria-label="Delete plan"
                                                    >
                                                        <Trash2 size={20} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default SavedPlansModal;