// web/src/hooks/useTimeOfDay.js
import { useState, useEffect } from 'react';
import { getTimeOfDay } from '../utils/animationHelpers';
import { COLORS } from '../constants';

/**
 * Custom hook for determining current time of day
 * Returns time period and corresponding theme values
 */
const useTimeOfDay = () => {
    const [timeOfDay, setTimeOfDay] = useState('morning');
    const [ambientGradient, setAmbientGradient] = useState('');

    useEffect(() => {
        const updateTimeOfDay = () => {
            const newTimeOfDay = getTimeOfDay();
            setTimeOfDay(newTimeOfDay);

            const ambientColors = COLORS.ambient[newTimeOfDay];
            if (ambientColors) {
                setAmbientGradient(ambientColors.gradient);
            }
        };

        updateTimeOfDay();
        const interval = setInterval(updateTimeOfDay, 1800000); // 30 minutes

        return () => clearInterval(interval);
    }, []);

    return {
        timeOfDay,
        ambientGradient,
        colors: COLORS.ambient[timeOfDay] || COLORS.ambient.morning,
    };
};

export default useTimeOfDay;