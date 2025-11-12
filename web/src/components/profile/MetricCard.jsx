// web/src/components/profile/MetricCard.jsx
import React from 'react';
import { COLORS } from '../../constants';

/**
 * Metric Card - Displays body metrics with blueprint aesthetic
 * Features:
 * - Technical typography
 * - Grid overlay
 * - Clean layout
 * - Icon support
 */
const MetricCard = ({ label, value, icon }) => {
    return (
        <div
            className="relative p-4 rounded-lg border overflow-hidden"
            style={{
                backgroundColor: COLORS.gray[50],
                borderColor: COLORS.blueprint.grid,
            }}
        >
            {/* Grid overlay */}
            <div
                className="absolute inset-0 pointer-events-none opacity-20"
                style={{
                    backgroundImage: `
                        linear-gradient(${COLORS.blueprint.grid} 1px, transparent 1px),
                        linear-gradient(90deg, ${COLORS.blueprint.grid} 1px, transparent 1px)
                    `,
                    backgroundSize: '10px 10px',
                }}
            />

            {/* Content */}
            <div className="relative">
                {/* Icon */}
                {icon && (
                    <div className="text-3xl mb-2">{icon}</div>
                )}

                {/* Label */}
                <p
                    className="text-xs font-semibold uppercase tracking-wider mb-1"
                    style={{ color: COLORS.blueprint.text }}
                >
                    {label}
                </p>

                {/* Value */}
                <p
                    className="text-xl font-bold font-mono"
                    style={{ color: COLORS.gray[900] }}
                >
                    {value}
                </p>
            </div>

            {/* Corner accent */}
            <div
                className="absolute top-0 right-0 w-8 h-8"
                style={{
                    background: `linear-gradient(135deg, transparent 50%, ${COLORS.blueprint.line}20 50%)`,
                }}
            />
        </div>
    );
};

export default MetricCard;