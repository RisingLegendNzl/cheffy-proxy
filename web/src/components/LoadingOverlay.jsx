// web/src/components/LoadingOverlay.jsx
import React from 'react';
import { COLORS, Z_INDEX } from '../constants';
import ChefMascot from './ui/ChefMascot';

/**
 * Loading Overlay - Non-blocking with skeleton screens
 * Features:
 * - Never blocks interaction
 * - Friendly chef mascot animation
 * - Subtle backdrop
 * - Optional message
 */
const LoadingOverlay = ({
    isVisible = false,
    message = 'Preparing your plan...',
    blocking = false,
}) => {
    if (!isVisible) return null;

    return (
        <div
            className={`fixed inset-0 flex items-center justify-center ${
                blocking ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            style={{
                zIndex: Z_INDEX.modalBackdrop,
                backgroundColor: blocking ? 'rgba(0, 0, 0, 0.4)' : 'transparent',
            }}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm mx-4 animate-scaleIn pointer-events-auto"
                style={{
                    border: `2px solid ${COLORS.primary[200]}`,
                }}
            >
                {/* Chef Mascot */}
                <div className="flex justify-center mb-4">
                    <ChefMascot variant="cooking" size={100} />
                </div>

                {/* Message */}
                <p
                    className="text-center text-lg font-semibold mb-2"
                    style={{ color: COLORS.gray[900] }}
                >
                    {message}
                </p>

                {/* Spinner */}
                <div className="flex justify-center">
                    <div className="spinner" />
                </div>
            </div>
        </div>
    );
};

export default LoadingOverlay;