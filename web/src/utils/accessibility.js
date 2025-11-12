// web/src/utils/accessibility.js

/**
 * Accessibility utility functions for Cheffy
 * Ensures WCAG compliance, focus management, and touch target sizing
 */

/**
 * Check if color contrast meets WCAG AA standards
 * @param {string} foreground - Foreground color hex
 * @param {string} background - Background color hex
 * @returns {boolean}
 */
export const meetsContrastRequirements = (foreground, background) => {
    const getLuminance = (hex) => {
        const rgb = parseInt(hex.slice(1), 16);
        const r = (rgb >> 16) & 0xff;
        const g = (rgb >> 8) & 0xff;
        const b = (rgb >> 0) & 0xff;

        const rsRGB = r / 255;
        const gsRGB = g / 255;
        const bsRGB = b / 255;

        const rLin = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
        const gLin = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
        const bLin = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

        return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    };

    const l1 = getLuminance(foreground);
    const l2 = getLuminance(background);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    return ratio >= 4.5; // WCAG AA standard
};

/**
 * Ensure touch target meets minimum size (44x44px)
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export const meetsTouchTargetSize = (element) => {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const MIN_SIZE = 44;

    return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE;
};

/**
 * Set focus trap within a modal or dialog
 * @param {HTMLElement} container - Modal container element
 * @returns {function} Cleanup function
 */
export const setFocusTrap = (container) => {
    if (!container) return () => {};

    const focusableElements = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e) => {
        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
            if (document.activeElement === firstElement) {
                e.preventDefault();
                lastElement.focus();
            }
        } else {
            if (document.activeElement === lastElement) {
                e.preventDefault();
                firstElement.focus();
            }
        }
    };

    container.addEventListener('keydown', handleTabKey);

    // Focus first element
    firstElement?.focus();

    return () => {
        container.removeEventListener('keydown', handleTabKey);
    };
};

/**
 * Announce message to screen readers
 * @param {string} message - Message to announce
 * @param {string} priority - 'polite' or 'assertive'
 */
export const announceToScreenReader = (message, priority = 'polite') => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;

    document.body.appendChild(announcement);

    setTimeout(() => {
        document.body.removeChild(announcement);
    }, 1000);
};

/**
 * Handle keyboard navigation for lists
 * @param {KeyboardEvent} event
 * @param {number} currentIndex
 * @param {number} totalItems
 * @param {function} onNavigate
 */
export const handleListKeyboardNavigation = (event, currentIndex, totalItems, onNavigate) => {
    const { key } = event;

    switch (key) {
        case 'ArrowUp':
        case 'ArrowLeft':
            event.preventDefault();
            if (currentIndex > 0) {
                onNavigate(currentIndex - 1);
            }
            break;
        case 'ArrowDown':
        case 'ArrowRight':
            event.preventDefault();
            if (currentIndex < totalItems - 1) {
                onNavigate(currentIndex + 1);
            }
            break;
        case 'Home':
            event.preventDefault();
            onNavigate(0);
            break;
        case 'End':
            event.preventDefault();
            onNavigate(totalItems - 1);
            break;
        default:
            break;
    }
};

/**
 * Create accessible label for screen readers
 * @param {string} action - Action being performed
 * @param {string} context - Context of the action
 * @returns {string}
 */
export const createAriaLabel = (action, context) => {
    return `${action} ${context}`;
};

/**
 * Ensure focus visibility for keyboard users
 * @param {HTMLElement} element
 */
export const ensureFocusVisible = (element) => {
    if (!element) return;

    element.style.outline = '2px solid #6366f1';
    element.style.outlineOffset = '2px';
};

/**
 * Remove focus visibility (typically on mouse/touch)
 * @param {HTMLElement} element
 */
export const removeFocusVisible = (element) => {
    if (!element) return;

    element.style.outline = 'none';
};

/**
 * Check if element is keyboard focusable
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export const isKeyboardFocusable = (element) => {
    if (!element) return false;

    const tabIndex = element.getAttribute('tabindex');
    return (
        tabIndex !== '-1' &&
        !element.disabled &&
        element.offsetParent !== null
    );
};

/**
 * Add skip link for keyboard navigation
 * @param {string} targetId - ID of main content
 */
export const addSkipLink = (targetId) => {
    const skipLink = document.createElement('a');
    skipLink.href = `#${targetId}`;
    skipLink.textContent = 'Skip to main content';
    skipLink.className = 'sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:z-50 focus:p-4 focus:bg-white focus:text-blue-600';

    document.body.insertBefore(skipLink, document.body.firstChild);
};

/**
 * Screen reader only class utility
 */
export const SR_ONLY_CLASSES = 'absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0';

/**
 * Validate form accessibility
 * @param {HTMLFormElement} form
 * @returns {Object} Validation results
 */
export const validateFormAccessibility = (form) => {
    const issues = [];

    // Check for labels
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach((input) => {
        const id = input.getAttribute('id');
        const ariaLabel = input.getAttribute('aria-label');
        const ariaLabelledBy = input.getAttribute('aria-labelledby');

        if (!id && !ariaLabel && !ariaLabelledBy) {
            issues.push(`Input "${input.name || 'unknown'}" is missing a label or aria-label`);
        }
    });

    // Check for error messages
    const requiredFields = form.querySelectorAll('[required]');
    requiredFields.forEach((field) => {
        const errorId = field.getAttribute('aria-describedby');
        if (!errorId) {
            issues.push(`Required field "${field.name || 'unknown'}" should have aria-describedby for error messages`);
        }
    });

    return {
        isValid: issues.length === 0,
        issues,
    };
};

export default {
    meetsContrastRequirements,
    meetsTouchTargetSize,
    setFocusTrap,
    announceToScreenReader,
    handleListKeyboardNavigation,
    createAriaLabel,
    ensureFocusVisible,
    removeFocusVisible,
    isKeyboardFocusable,
    addSkipLink,
    SR_ONLY_CLASSES,
    validateFormAccessibility,
};