// web/src/components/landing/CTASection.jsx
import React, { useRef } from 'react';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { COLORS } from '../../constants';
import { useInView } from '../../hooks/useResponsive'; // <-- Import useInView

/**
 * Final CTA Section Component
 * Encourages users to get started with benefits list
 */
const CTASection = ({ onGetStarted, onScheduleDemo }) => {
  const benefits = [
    '7-day free trial, no credit card required', // <-- Updated to 7-Day
    'Cancel anytime, no commitments',
    'Join 50,000+ happy users',
    'Personalized meal plans starting day one'
  ];

  // --- Add Animation Hooks ---
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { threshold: 0.1, triggerOnce: true });
  // --- End Animation Hooks ---

  return (
    <section 
      ref={sectionRef} // <-- Assign ref to section
      className="py-20 md:py-32"
      style={{ 
        background: `linear-gradient(135deg, ${COLORS.primary[600]} 0%, ${COLORS.secondary[600]} 100%)`
      }}
    >
      <div
        /*
          ADD:
          - transition-all, duration-700
          - Ternary for opacity and transform based on isInView
        */
        className={`max-w-4xl mx-auto px-4 md:px-8 text-center transition-all duration-700 ease-out ${
          isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
        }`}
      >
        {/* Headline */}
        <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 font-poppins">
          Get Started Today
        </h2>

        {/* Subheadline */}
        <p className="text-lg md:text-xl text-indigo-100 mb-10 max-w-2xl mx-auto">
          Join thousands of people who are already achieving their health goals with Cheffy.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 mb-12">
          <button
            onClick={onGetStarted}
            className="w-full sm:w-auto px-8 py-4 bg-white rounded-full font-semibold transition-all hover:shadow-xl hover:scale-105 flex items-center justify-center space-x-2"
            style={{ color: COLORS.primary[700] }}
          >
            <span>Start 7-Day Trial</span> {/* <-- Updated to 7-Day */}
            <ArrowRight size={20} />
          </button>

          <button
            onClick={onScheduleDemo}
            className="w-full sm:w-auto px-8 py-4 rounded-full font-semibold text-white transition-all hover:bg-white/10 border-2 border-white flex items-center justify-center space-x-2"
          >
            <span>Schedule a Demo</span>
          </button>
        </div>

        {/* Benefits Checklist */}
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 inline-block">
          <div className="space-y-4">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="flex items-center space-x-3 text-left"
              >
                <CheckCircle 
                  size={24} 
                  className="flex-shrink-0"
                  style={{ color: COLORS.success.light }}
                />
                <span className="text-white text-base md:text-lg">
                  {benefit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;

