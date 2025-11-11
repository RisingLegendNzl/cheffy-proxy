// web/src/components/landing/HeroSection.jsx
import React, { useState, useEffect } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { COLORS } from '../../constants';

/**
 * Hero Section Component
 * Main landing section with headline, CTAs, and social proof
 */
const HeroSection = ({ onGetStarted, onWatchDemo }) => {
  // Add state to track component mount for load-in animation
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    // Set mounted to true after a short delay to ensure animation plays
    const timer = setTimeout(() => setIsMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50 to-white py-20 md:py-32">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/*
          ADD:
          - transition-all, duration-700
          - Ternary for opacity and transform based on isMounted
        */}
        <div
          className={`text-center mb-12 transition-all duration-700 ease-out ${
            isMounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
          }`}
        >
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
              <span>Start 7-Day Free Trial</span> {/* <-- Updated to 7-Day */}
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

          {/* Hero Image - Larger and Cleaner */}
          {/*
            ADD:
            - transition-all, duration-1000
            - Ternary for opacity and scale based on isMounted
            - Added delay-300 to make it appear after the text
          */}
          <div
            className={`max-w-6xl mx-auto px-4 transition-all duration-1000 ease-out delay-300 ${
              isMounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            <div 
              className="rounded-3xl overflow-hidden shadow-2xl"
              style={{ backgroundColor: COLORS.gray[100] }}
            >
              <img
                src="https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1400&h=700&fit=crop&q=80"
                alt="Healthy meal prep bowls"
                className="w-full h-auto"
                loading="eager"
              />
            </div>
            
            {/* Subtle Caption */}
            <p 
              className="text-center mt-6 text-sm"
              style={{ color: COLORS.gray[500] }}
            >
              Personalized meal plans tailored to your goals
            </p>
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

