// web/src/components/FormSection.jsx
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { COLORS } from '../constants';

/**
 * Reusable form section with header and optional collapse
 * Helps organize long forms into logical groups
 */
const FormSection = ({
  title,
  icon: Icon,
  description,
  children,
  collapsible = false,
  defaultOpen = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const handleToggle = () => {
    if (collapsible) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className="mb-6">
      {/* Section Header */}
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between mb-4 pb-3 border-b ${
          collapsible ? 'cursor-pointer hover:border-indigo-500' : 'cursor-default'
        } transition-colors`}
        style={{ borderColor: COLORS.gray[200] }}
        disabled={!collapsible}
      >
        <div className="flex items-center">
          {Icon && (
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center mr-3"
              style={{ backgroundColor: COLORS.primary[100] }}
            >
              <Icon size={20} style={{ color: COLORS.primary[600] }} />
            </div>
          )}
          <div className="text-left">
            <h3 className="text-lg font-bold" style={{ color: COLORS.gray[900] }}>
              {title}
            </h3>
            {description && (
              <p className="text-sm" style={{ color: COLORS.gray[500] }}>
                {description}
              </p>
            )}
          </div>
        </div>

        {collapsible && (
          <div style={{ color: COLORS.gray[400] }}>
            {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        )}
      </button>

      {/* Section Content */}
      {(!collapsible || isOpen) && (
        <div className="space-y-4 animate-fadeIn">{children}</div>
      )}
    </div>
  );
};

export default FormSection;