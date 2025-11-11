// web/src/components/Header.jsx
import React, { useState, useEffect } from 'react';
import { ChefHat, Menu, X, User, Settings, LogOut } from 'lucide-react';
import { COLORS, SHADOWS, Z_INDEX, TRANSITIONS } from '../constants';
import { APP_CONFIG } from '../constants';

/**
 * Main app header with refined branding, user menu, and scroll behavior
 * Enhanced with better spacing, typography, and smooth animations
 */
const Header = ({ userId, onOpenSettings, onNavigateToProfile, onSignOut }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Detect scroll for compact header
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 bg-white transition-all duration-300 ${
          isScrolled ? '' : ''
        }`}
        style={{
          zIndex: Z_INDEX.sticky,
          borderBottom: `1px solid ${COLORS.gray[200]}`,
          boxShadow: isScrolled ? SHADOWS.md : 'none',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 md:px-8">
          <div
            className={`flex items-center justify-between transition-all duration-300 ${
              isScrolled ? 'py-3' : 'py-5'
            }`}
          >
            {/* Logo and Brand */}
            <div className="flex items-center space-x-3">
              <div
                className={`rounded-full flex items-center justify-center transition-all duration-300 ${
                  isScrolled ? 'w-10 h-10' : 'w-12 h-12'
                }`}
                style={{
                  background: COLORS.gradients.primary,
                  boxShadow: SHADOWS.sm,
                }}
              >
                <ChefHat className="text-white" size={isScrolled ? 20 : 24} />
              </div>
              <div>
                <h1
                  className={`font-bold transition-all duration-300 ${
                    isScrolled ? 'text-xl' : 'text-2xl'
                  }`}
                  style={{
                    color: COLORS.gray[900],
                    fontFamily: 'var(--font-family-display)',
                    letterSpacing: 'var(--letter-spacing-tight)',
                  }}
                >
                  {APP_CONFIG.name}
                </h1>
                {!isScrolled && (
                  <p
                    className="text-xs animate-fadeIn"
                    style={{
                      color: COLORS.gray[500],
                      fontFamily: 'var(--font-family-body)',
                    }}
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
                    className="text-xs px-3 py-1.5 rounded-full"
                    style={{
                      backgroundColor: COLORS.primary[50],
                      color: COLORS.primary[700],
                      fontWeight: 500,
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
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-20 animate-fadeIn"
            style={{ zIndex: Z_INDEX.dropdown - 1 }}
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Menu Panel */}
          <div
            className="fixed top-16 right-4 md:right-8 bg-white rounded-xl shadow-xl overflow-hidden animate-fadeInUp"
            style={{
              zIndex: Z_INDEX.dropdown,
              minWidth: '240px',
              boxShadow: SHADOWS.xl,
            }}
          >
            {/* User Info (if logged in) */}
            {userId && (
              <div
                className="px-4 py-3 border-b"
                style={{
                  backgroundColor: COLORS.gray[50],
                  borderColor: COLORS.gray[200],
                }}
              >
                <div className="flex items-center">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mr-3"
                    style={{
                      background: COLORS.gradients.primary,
                    }}
                  >
                    <User size={18} className="text-white" />
                  </div>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: COLORS.gray[900] }}
                  >
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
              className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition-fast text-left"
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
              className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition-fast text-left"
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
                  className="w-full flex items-center px-4 py-3 hover:bg-red-50 transition-fast text-left"
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