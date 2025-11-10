// web/src/components/landing/HeroSection.jsx
import React from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { COLORS } from '../../constants';

/**
 * Hero Section Component
 * Main landing section with headline, CTAs, and social proof
 */
const HeroSection = ({ onGetStarted, onWatchDemo }) => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50 to-white py-20 md:py-32">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="text-center mb-12">
          {/* Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full mb-6"
            style={{ 
              backgroundColor: COLORS.primary[50],
              color: COLORS.primary[700]
            }}
          >
            <span className="text-2xl">✨</span>
            <span className="text-sm font-semibold">AI-Powered Meal Planning</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 font-poppins">
            <span style={{ color: COLORS.gray[900] }}>Your Personal</span>
            <br />
            <span 
              className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent"
            >
              Meal Companion
            </span>
          </h1>

          {/* Subheadline */}
          <p 
            className="text-lg md:text-xl mb-10 max-w-2xl mx-auto"
            style={{ color: COLORS.gray[600] }}
          >
            Generate personalized meal plans, track your macros, and achieve your health goals with AI-powered nutrition insights.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 mb-16">
            <button
              onClick={onGetStarted}
              className="w-full sm:w-auto px-8 py-4 rounded-full font-semibold text-white transition-all hover:shadow-xl hover:scale-105 flex items-center justify-center space-x-2"
              style={{ 
                backgroundColor: COLORS.primary[600],
              }}
            >
              <span>Start Free Trial</span>
              <ArrowRight size={20} />
            </button>

            <button
              onClick={onWatchDemo}
              className="w-full sm:w-auto px-8 py-4 rounded-full font-semibold transition-all hover:shadow-lg flex items-center justify-center space-x-2"
              style={{ 
                backgroundColor: COLORS.success.main,
                color: 'white'
              }}
            >
              <Play size={20} />
              <span>Watch Demo</span>
            </button>
          </div>

          {/* Social Proof Stats */}
          <div className="flex flex-col md:flex-row items-center justify-center space-y-8 md:space-y-0 md:space-x-12 mb-16">
            <div className="text-center">
              <div 
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{ color: COLORS.gray[900] }}
              >
                50K+
              </div>
              <div style={{ color: COLORS.gray[600] }}>Active Users</div>
            </div>

            <div className="hidden md:block w-px h-12" style={{ backgroundColor: COLORS.gray[300] }}></div>

            <div className="text-center">
              <div 
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{ color: COLORS.gray[900] }}
              >
                4.9/5
              </div>
              <div style={{ color: COLORS.gray[600] }}>User Rating</div>
            </div>

            <div className="hidden md:block w-px h-12" style={{ backgroundColor: COLORS.gray[300] }}></div>

            <div className="text-center">
              <div 
                className="text-4xl md:text-5xl font-bold mb-2"
                style={{ color: COLORS.gray[900] }}
              >
                1M+
              </div>
              <div style={{ color: COLORS.gray[600] }}>Meals Generated</div>
            </div>
          </div>

          {/* Hero Image */}
          <div className="max-w-5xl mx-auto">
            <div 
              className="rounded-2xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: COLORS.gray[100] }}
            >
              <img
                src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&h=600&fit=crop"
                alt="Healthy meal prep containers"
                className="w-full h-auto"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Decorative Elements */}
      <div 
        className="absolute top-20 left-10 w-72 h-72 bg-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"
      ></div>
      <div 
        className="absolute top-40 right-10 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"
      ></div>
    </section>
  );
};

export default HeroSection;