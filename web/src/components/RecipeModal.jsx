// web/src/components/RecipeModal.jsx
import React from 'react';
import { X, ListChecks, ListOrdered } from 'lucide-react';

/**
 * RecipeModal - Meal detail overlay with guaranteed header visibility
 */
const RecipeModal = ({ meal, onClose }) => {
    if (!meal) return null;

    // Handle backdrop click
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    // Prevent body scroll when modal is open
    React.useEffect(() => {
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, []);

    return (
        <div 
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                zIndex: 200,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
            }}
            onClick={handleBackdropClick}
        >
            {/* Modal Container */}
            <div 
                style={{
                    backgroundColor: 'white',
                    width: '100%',
                    maxWidth: '672px',
                    maxHeight: '90vh',
                    borderTopLeftRadius: '24px',
                    borderTopRightRadius: '24px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* HEADER - Always visible, never scrolls */}
                <div 
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '1.25rem',
                        paddingTop: 'max(1.25rem, calc(env(safe-area-inset-top) + 0.5rem))',
                        borderBottom: '1px solid #e5e7eb',
                        backgroundColor: 'white',
                        flexShrink: 0,
                        minHeight: '70px',
                    }}
                >
                    {/* Title */}
                    <h3 
                        style={{
                            fontSize: '1.25rem',
                            fontWeight: 700,
                            color: '#111827',
                            margin: 0,
                            paddingRight: '0.75rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                        }}
                    >
                        {meal.name}
                    </h3>
                    
                    {/* Close Button */}
                    <button 
                        onClick={onClose}
                        style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            backgroundColor: '#f3f4f6',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                            transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                        aria-label="Close"
                    >
                        <X size={20} color="#4b5563" />
                    </button>
                </div>
                
                {/* SCROLLABLE BODY */}
                <div 
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        padding: '1.5rem 1.25rem',
                        WebkitOverflowScrolling: 'touch',
                    }}
                >
                    {/* Description */}
                    {meal.description && (
                        <div style={{ marginBottom: '2rem' }}>
                            <p style={{
                                color: '#374151',
                                fontSize: '1rem',
                                lineHeight: '1.625',
                                margin: 0,
                            }}>
                                {meal.description}
                            </p>
                        </div>
                    )}
                    
                    {/* Ingredients */}
                    {meal.items && meal.items.length > 0 && (
                        <div style={{ marginBottom: '2rem' }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '1rem',
                            }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    backgroundColor: '#e0e7ff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <ListChecks size={20} color="#4f46e5" />
                                </div>
                                <h4 style={{
                                    fontSize: '1.25rem',
                                    fontWeight: 700,
                                    color: '#111827',
                                    margin: 0,
                                }}>
                                    Ingredients
                                </h4>
                            </div>
                            <ul style={{
                                listStyle: 'none',
                                padding: 0,
                                margin: 0,
                            }}>
                                {meal.items.map((item, index) => (
                                    <li 
                                        key={index}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '0.75rem',
                                            marginBottom: '0.75rem',
                                            color: '#374151',
                                        }}
                                    >
                                        <span style={{
                                            width: '8px',
                                            height: '8px',
                                            borderRadius: '50%',
                                            backgroundColor: '#818cf8',
                                            marginTop: '0.5rem',
                                            flexShrink: 0,
                                        }}></span>
                                        <span style={{
                                            flex: 1,
                                            fontSize: '1rem',
                                            lineHeight: '1.625',
                                        }}>
                                            <span style={{ fontWeight: 600, color: '#111827' }}>
                                                {item.qty}{item.unit}
                                            </span>
                                            {' '}
                                            {item.key}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    {/* Instructions */}
                    {meal.instructions && meal.instructions.length > 0 && (
                        <div style={{ marginBottom: '2rem' }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '1rem',
                            }}>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    backgroundColor: '#d1fae5',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <ListOrdered size={20} color="#059669" />
                                </div>
                                <h4 style={{
                                    fontSize: '1.25rem',
                                    fontWeight: 700,
                                    color: '#111827',
                                    margin: 0,
                                }}>
                                    Instructions
                                </h4>
                            </div>
                            <ol style={{
                                listStyle: 'none',
                                padding: 0,
                                margin: 0,
                            }}>
                                {meal.instructions.map((step, index) => (
                                    <li 
                                        key={index}
                                        style={{
                                            display: 'flex',
                                            gap: '1rem',
                                            marginBottom: '1rem',
                                            color: '#374151',
                                        }}
                                    >
                                        <span style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            backgroundColor: '#d1fae5',
                                            color: '#047857',
                                            fontWeight: 700,
                                            fontSize: '0.875rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                        }}>
                                            {index + 1}
                                        </span>
                                        <span style={{
                                            flex: 1,
                                            fontSize: '1rem',
                                            lineHeight: '1.625',
                                            paddingTop: '0.125rem',
                                        }}>
                                            {step}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {/* Bottom safe area padding */}
                    <div style={{
                        height: '2rem',
                        paddingBottom: 'env(safe-area-inset-bottom)',
                    }} />
                </div>
            </div>
        </div>
    );
};

export default RecipeModal;