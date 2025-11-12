// web/src/components/Header.jsx
import React, { useState, useEffect } from 'react';
import { ChefHat, Menu, X, User, Settings, LogOut } from 'lucide-react';
import { COLORS, SPACING, SHADOWS, Z_INDEX, APP_CONFIG } from '../constants';
import { getTimeOfDay } from '../utils/animationHelpers';

/**
 * Header - Enhanced with ambient gradient and breathing animation
 * Features:
 * - Ambient gradient shift based on time of day
 * - Subtle breathing animation on logo
 * - Compact on scroll
 * - User menu
 */
const Header = ({ userId, onOpenSettings, onNavigateToProfile, onSignOut }) => {
    const [isScrolled, setIsScrolled] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [timeOfDay, setTimeOfDay] = useState('morning');

    // Detect scroll for compact header
    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Update time of day for ambient gradient
    useEffect(() => {
        const updateTimeOfDay = () => {
            setTimeOfDay(getTimeOfDay());
        };

        updateTimeOfDay();
        const interval = setInterval(updateTimeOfDay, 1800000); // 30 minutes

        return () => clearInterval(interval);
    }, []);

    // Get ambient gradient
    const getAmbientGradient = () => {
        const ambientColors = COLORS.ambient[timeOfDay];
        return ambientColors ? ambientColors.gradient : COLORS.ambient.morning.gradient;
    };

    return (
        <>
            <header
                className={`fixed top-0 left-0 right-0 bg-white border-b transition-all duration-300 ${
                    isScrolled ? 'shadow-md' : ''
                }`}
                style={{
                    zIndex: Z_INDEX.sticky,
                    borderColor: COLORS.gray[200],
                }}
            >
                {/* Ambient gradient overlay */}
                <div
                    className="absolute inset-0 opacity-5 transition-all duration-1000 pointer-events-none"
                    style={{
                        background: getAmbientGradient(),
                    }}
                />

                <div className="relative max-w-7xl mx-auto px-4 md:px-8">
                    <div
                        className={`flex items-center justify-between transition-all duration-300 ${
                            isScrolled ? 'py-3' : 'py-4'
                        }`}
                    >
                        {/* Logo and Brand */}
                        <div className="flex items-center space-x-3">
                            <div
                                className={`bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center transition-all duration-300 animate-breathe ${
                                    isScrolled ? 'w-10 h-10' : 'w-12 h-12'
                                }`}
                            >
                                <ChefHat className="text-white" size={isScrolled ? 20 : 24} />
                            </div>
                            <div>
                                <h1
                                    className={`font-bold font-poppins transition-all duration-300 ${
                                        isScrolled ? 'text-xl' : 'text-2xl'
                                    }`}
                                    style={{ color: COLORS.gray[900] }}
                                >
                                    {APP_CONFIG.name}
                                </h1>
                                {!isScrolled && (
                                    <p
                                        className="text-xs animate-fadeIn"
                                        style={{ color: COLORS.gray[500] }}
                                    >
                                        {APP_CONFIG.tagline}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Desktop User Menu */}
                        <div className="hidden md:flex items-center space-x-4">
                            {userId && (
                                <>
                                    <div
                                        className="text-xs px-3 py-1 rounded-full"
                                        style={{
                                            backgroundColor: COLORS.primary[50],
                                            color: COLORS.primary[700],
                                        }}
                                    >
                                        <User size={12} className="inline mr-1" />
                                        Signed In
                                    </div>

                                    <button
                                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                                        className="p-2 rounded-full hover-lift transition-spring"
                                        style={{
                                            backgroundColor: COLORS.gray[100],
                                            color: COLORS.gray[700],
                                        }}
                                        aria-label="User menu"
                                    >
                                        <Menu size={20} />
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Mobile Menu Button */}
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="md:hidden p-2 rounded-full hover-lift transition-spring"
                            style={{
                                backgroundColor: COLORS.gray[100],
                                color: COLORS.gray[700],
                            }}
                            aria-label="Menu"
                        >
                            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>
            </header>

            {/* Dropdown Menu */}
            {isMenuOpen && (
                <>
                    <div
                        className="fixed inset-0 bg-black bg-opacity-25 animate-fadeIn"
                        style={{ zIndex: Z_INDEX.dropdown - 1 }}
                        onClick={() => setIsMenuOpen(false)}
                    />

                    <div
                        className="fixed top-16 right-4 bg-white rounded-xl shadow-2xl border animate-slideDown"
                        style={{
                            zIndex: Z_INDEX.dropdown,
                            borderColor: COLORS.gray[200],
                            minWidth: '240px',
                        }}
                    >
                        {/* User Info */}
                        {userId && (
                            <div className="p-4 border-b" style={{ borderColor: COLORS.gray[200] }}>
                                <div className="flex items-center space-x-3">
                                    <div
                                        className="w-10 h-10 rounded-full flex items-center justify-center"
                                        style={{
                                            backgroundColor: COLORS.primary[100],
                                        }}
                                    >
                                        <User size={20} style={{ color: COLORS.primary[600] }} />
                                    </div>
                                    <p className="text-sm font-semibold" style={{ color: COLORS.gray[900] }}>
                                        {userId.startsWith('local_') ? 'Local User' : userId}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Menu Items */}
                        <button
                            onClick={() => {
                                setIsMenuOpen(false);
                                onNavigateToProfile && onNavigateToProfile();
                            }}
                            className="w-full flex items-center px-4 py-3 rounded-lg hover:bg-gray-50 transition-fast text-left"
                        >
                            <User
                                size={18}
                                className="mr-3"
                                style={{ color: COLORS.gray[600] }}
                            />
                            <span style={{ color: COLORS.gray[900] }}>Edit Profile</span>
                        </button>

                        <button
                            onClick={() => {
                                setIsMenuOpen(false);
                                onOpenSettings && onOpenSettings();
                            }}
                            className="w-full flex items-center px-4 py-3 rounded-lg hover:bg-gray-50 transition-fast text-left"
                        >
                            <Settings
                                size={18}
                                className="mr-3"
                                style={{ color: COLORS.gray[600] }}
                            />
                            <span style={{ color: COLORS.gray[900] }}>Settings</span>
                        </button>

                        {userId && !userId.startsWith('local_') && (
                            <>
                                <div
                                    className="my-2 border-t"
                                    style={{ borderColor: COLORS.gray[200] }}
                                />

                                <button
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        onSignOut && onSignOut();
                                    }}
                                    className="w-full flex items-center px-4 py-3 rounded-lg hover:bg-red-50 transition-fast text-left"
                                >
                                    <LogOut
                                        size={18}
                                        className="mr-3"
                                        style={{ color: COLORS.error.main }}
                                    />
                                    <span style={{ color: COLORS.error.main }}>Sign Out</span>
                                </button>
                            </>
                        )}

                        {/* App Version */}
                        <div
                            className="px-4 py-2 border-t text-center"
                            style={{ borderColor: COLORS.gray[200] }}
                        >
                            <p className="text-xs" style={{ color: COLORS.gray[400] }}>
                                v{APP_CONFIG.version}
                            </p>
                        </div>
                    </div>
                </>
            )}

            {/* Spacer to prevent content from going under fixed header */}
            <div className={isScrolled ? 'h-16' : 'h-20'} />
        </>
    );
};

export default Header;