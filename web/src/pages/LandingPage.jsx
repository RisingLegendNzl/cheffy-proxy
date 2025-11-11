// web/src/pages/LandingPage.jsx
import React, { useState } from 'react';
import { ChefHat } from 'lucide-react';
import { COLORS } from '../constants';
import HeroSection from '../components/landing/HeroSection';
import FeaturesSection from '../components/landing/FeaturesSection';
import HowItWorksSection from '../components/landing/HowItWorksSection';
import PricingSection from '../components/landing/PricingSection'; // <-- 1. Import new component
import TestimonialsSection from '../components/landing/TestimonialsSection';
import CTASection from '../components/landing/CTASection';
import Footer from '../components/landing/Footer';
import AuthModal from '../components/AuthModal';

/**
 * Main Landing Page Component
 * Entry point for non-authenticated users
 */
const LandingPage = ({ onSignUp, onSignIn, authLoading = false }) => {
  const [showDemoVideo, setShowDemoVideo] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const handleGetStarted = () => {
    setShowAuthModal(true);
  };

  const handleWatchDemo = () => {
    setShowDemoVideo(true);
  };

  const handleCloseDemoVideo = () => {
    setShowDemoVideo(false);
  };

  const handleCloseAuthModal = () => {
    if (!authLoading) {
      setShowAuthModal(false);
    }
  };

  const handleSignUp = async (credentials) => {
    await onSignUp(credentials);
    // Modal will close automatically from parent on success
  };

  const handleSignIn = async (credentials) => {
    await onSignIn(credentials);
    // Modal will close automatically from parent on success
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Header */}
      <nav 
        className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-b z-50"
        style={{ borderColor: COLORS.gray[200] }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <div
                className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full w-10 h-10 flex items-center justify-center"
              >
                <ChefHat className="text-white" size={20} />
              </div>
              <h1 
                className="text-xl font-bold font-poppins"
                style={{ color: COLORS.gray[900] }}
              >
                Cheffy
              </h1>
            </div>

            {/* Get Started Button */}
            <button
              onClick={handleGetStarted}
              className="px-6 py-2.5 rounded-full font-semibold text-white transition-all hover:shadow-lg hover:scale-105"
              style={{ 
                backgroundColor: COLORS.primary[600],
              }}
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-16">
        <HeroSection onGetStarted={handleGetStarted} onWatchDemo={handleWatchDemo} />
        <FeaturesSection />
        <HowItWorksSection />
        <PricingSection onGetStarted={handleGetStarted} /> {/* <-- 2. Add component here */}
        <TestimonialsSection />
        <CTASection onGetStarted={handleGetStarted} onScheduleDemo={handleWatchDemo} />
      </main>

      {/* Footer */}
      <Footer />

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={handleCloseAuthModal}
        onSignUp={handleSignUp}
        onSignIn={handleSignIn}
        loading={authLoading}
      />

      {/* Demo Video Modal */}
      {showDemoVideo && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={handleCloseDemoVideo}
        >
          <div 
            className="bg-white rounded-2xl p-6 max-w-4xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold" style={{ color: COLORS.gray[900] }}>
                Watch Demo
              </h3>
              <button
                onClick={handleCloseDemoVideo}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
              <p className="text-gray-500">Demo video would be embedded here</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;

