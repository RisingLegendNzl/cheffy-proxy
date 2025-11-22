// web/src/components/Header.jsx
// Modified to include "My Saved Plans" menu item

import React, { useState, useEffect } from 'react';
import { ChefHat, Menu, X, User, Settings, LogOut, Bookmark } from 'lucide-react';
import { COLORS, SPACING, SHADOWS, Z_INDEX } from '../constants';
import { APP_CONFIG } from '../constants';

/**
 * Main app header with branding, user menu, and scroll behavior
 * Becomes compact when user scrolls down
 */
const Header = ({ userId, onOpenSettings, onNavigateToProfile, onSignOut, onOpenSavedPlans }) => {
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
        className={`fixed top-0 left-0 right-0 bg-white border-b transition-all duration-300 ${
          isScrolled ? 'shadow-md' : ''
        }`}
        style={{
          zIndex: Z_INDEX.sticky,
          borderColor: COLORS.gray[200],
        }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div
            className={`flex items-center justify-between transition-all duration-300 ${
              isScrolled ? 'py-3' : 'py-4'
            }`}
          >
            {/* Logo and Brand */}
            <div className="flex items-center space-x-3">
              <div
                className={`bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center transition-all duration-300 ${
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
                  Cheffy
                </h1>
                {!isScrolled && (
                  <p className="text-xs" style={{ color: COLORS.gray[500] }}>
                    Your AI Meal Planner
                  </p>
                )}
              </div>
            </div>

            {/* User Menu Button */}
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              style={{ color: COLORS.gray[700] }}
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
            className="fixed inset-0 bg-black bg-opacity-25 animate-fadeIn"
            style={{ zIndex: Z_INDEX.dropdown - 1 }}
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Menu Panel */}
          <div
            className="fixed top-16 right-4 w-64 bg-white rounded-xl animate-scaleIn"
            style={{
              zIndex: Z_INDEX.dropdown,
              boxShadow: SHADOWS['2xl'],
            }}
          >
            <div className="p-2">
              {/* User Info */}
              {userId && (
                <div
                  className="px-4 py-3 mb-2 rounded-lg"
                  style={{ backgroundColor: COLORS.gray[50] }}
                >
                  <p className="text-xs text-gray-500 mb-1">Signed in as</p>
                  <p
                    className="text-sm font-semibold truncate"
                    style={{ color: COLORS.gray[900] }}
                  >
                    {userId.startsWith('local_') ? 'Local User' : userId}
                  </p>
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

              {/* My Saved Plans - NEW */}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenSavedPlans && onOpenSavedPlans();
                }}
                className="w-full flex items-center px-4 py-3 rounded-lg hover:bg-gray-50 transition-fast text-left"
              >
                <Bookmark
                  size={18}
                  className="mr-3"
                  style={{ color: COLORS.gray[600] }}
                />
                <span style={{ color: COLORS.gray[900] }}>My Saved Plans</span>
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
            </div>

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