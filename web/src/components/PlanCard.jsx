// web/src/components/PlanCard.jsx
import React, { useState } from 'react';
import { Calendar, DollarSign, Trash2, Download, Star } from 'lucide-react';
import { COLORS, SHADOWS } from '../constants';

const PlanCard = ({ plan, isActive, onLoad, onDelete, onSetActive, loading = false }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    if (showDeleteConfirm) {
      onDelete(plan.planId);
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-AU', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  return (
    <div
      className="p-4 rounded-lg border-2 transition-all hover:shadow-md"
      style={{
        borderColor: isActive ? COLORS.primary[500] : COLORS.gray[200],
        backgroundColor: isActive ? COLORS.primary[50] : 'white',
        boxShadow: isActive ? SHADOWS.primary : 'none'
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <h3 
              className="font-bold text-lg"
              style={{ color: COLORS.gray[900] }}
            >
              {plan.name}
            </h3>
            {isActive && (
              <div
                className="px-2 py-1 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: COLORS.primary[100],
                  color: COLORS.primary[700]
                }}
              >
                Active
              </div>
            )}
          </div>
          <p className="text-xs" style={{ color: COLORS.gray[500] }}>
            Created {formatDate(plan.createdAt)}
          </p>
        </div>

        <button
          onClick={() => onSetActive(plan.planId)}
          disabled={loading || isActive}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
          title={isActive ? 'Already active' : 'Set as active plan'}
        >
          <Star
            size={18}
            fill={isActive ? COLORS.primary[500] : 'none'}
            style={{ color: isActive ? COLORS.primary[500] : COLORS.gray[400] }}
          />
        </button>
      </div>

      <div className="flex items-center space-x-4 mb-4 text-sm">
        <div className="flex items-center space-x-1">
          <Calendar size={16} style={{ color: COLORS.gray[500] }} />
          <span style={{ color: COLORS.gray[600] }}>
            {plan.days} {plan.days === 1 ? 'day' : 'days'}
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <DollarSign size={16} style={{ color: COLORS.gray[500] }} />
          <span style={{ color: COLORS.gray[600] }}>
            ${plan.totalCost?.toFixed(2) || '0.00'}
          </span>
        </div>
      </div>

      <div className="flex space-x-2">
        <button
          onClick={() => onLoad(plan.planId)}
          disabled={loading}
          className="flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition-all hover:shadow-md disabled:opacity-50 flex items-center justify-center space-x-1"
          style={{
            backgroundColor: COLORS.primary[500],
            color: 'white'
          }}
        >
          <Download size={16} />
          <span>Load</span>
        </button>

        <button
          onClick={handleDelete}
          disabled={loading}
          className="py-2 px-3 rounded-lg font-semibold text-sm transition-all hover:shadow-md disabled:opacity-50 flex items-center justify-center space-x-1"
          style={{
            backgroundColor: showDeleteConfirm ? COLORS.error.main : COLORS.error.light,
            color: showDeleteConfirm ? 'white' : COLORS.error.dark
          }}
        >
          <Trash2 size={16} />
          <span>{showDeleteConfirm ? 'Confirm?' : 'Delete'}</span>
        </button>
      </div>
    </div>
  );
};

export default PlanCard;