// web/src/components/landing/HowItWorksSection.jsx
import React, { useRef } from 'react';
import { UserPlus, ChefHat, TrendingUp } from 'lucide-react';
import { COLORS } from '../../constants';
import { useInView } from '../../hooks/useResponsive'; // <-- Import useInView

/**
 * How It Works Section Component
 * Shows the 3-step onboarding process
 */
const HowItWorksSection = () => {
  const steps = [
    // ... (steps array remains the same)
    {
      number: '01',
      icon: <UserPlus size={32} />,
      title: 'Create Your Profile',
      description: 'Tell us about your dietary preferences, allergies, and fitness goals in just 2 minutes.',
      color: COLORS.primary[500],
      bgColor: COLORS.primary[50]
    },
    {
      number: '02',
      icon: <ChefHat size={32} />,
      title: 'Get Your Meal Plan',
      description: 'Our AI instantly generates a personalized weekly meal plan tailored to your needs.',
      color: COLORS.secondary[500],
      bgColor: COLORS.secondary[50]
    },
    {
      number: '03',
      icon: <TrendingUp size={32} />,
      title: 'Track Your Progress',
      description: 'Monitor your nutrition, adjust your goals, and watch yourself achieve amazing results.',
      color: COLORS.success.main,
      bgColor: COLORS.success.light
    }
  ];

  // --- Add Animation Hooks ---
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { threshold: 0.1, triggerOnce: true });
  // --- End Animation Hooks ---

  return (
    <section 
      ref={sectionRef} // <-- Assign ref to section
      className="py-20 md:py-32 transition-opacity duration-500"
      style={{ 
        backgroundColor: COLORS.gray[50],
        opacity: isInView ? 1 : 0 // <-- Fade in section
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/* Section Header */}
        <div
          className={`text-center mb-16 ${
            isInView ? 'animate-fadeInUp' : 'opacity-0'
          }`}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4 font-poppins">
            <span style={{ color: COLORS.gray[900] }}>Start Your Journey in</span>
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Three Simple Steps
            </span>
          </h2>
          <p 
            className="text-lg md:text-xl max-w-3xl mx-auto"
            style={{ color: COLORS.gray[600] }}
          >
            From sign-up to your first meal plan in minutes. No complicated setup required.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connecting Line (Desktop) */}
          <div
            className={`hidden md:block absolute top-20 left-1/4 right-1/4 h-0.5 transition-all duration-1000 ${
              isInView ? 'scale-x-100' : 'scale-x-0'
            }`}
            style={{ 
              backgroundColor: COLORS.gray[300],
              transformOrigin: 'left'
            }}
          ></div>

          {steps.map((step, index) => (
            <div
              key={index}
              /*
                ADD:
                - stagger-item class for animation
                - Opacity 0 to hide before animation
                - isInView check to trigger animation
              */
              className={`relative ${
                isInView ? 'stagger-item' : 'opacity-0'
              }`}
              style={{
                animationDelay: `${index * 150}ms` // <-- Stagger delay
              }}
            >
              {/* Step Number Badge */}
              <div className="flex justify-center mb-6">
                <div 
                  className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold relative z-10"
                  style={{ 
                    backgroundColor: step.color,
                    color: 'white'
                  }}
                >
                  {step.number}
                </div>
              </div>

              {/* Card */}
              <div
                className="bg-white p-8 rounded-2xl text-center shadow-lg hover:shadow-xl transition-shadow"
              >
                {/* Icon */}
                <div 
                  className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-6"
                  style={{ 
                    backgroundColor: step.bgColor,
                    color: step.color
                  }}
                >
                  {step.icon}
                </div>

                {/* Title */}
                <h3 
                  className="text-xl font-bold mb-4"
                  style={{ color: COLORS.gray[900] }}
                >
                  {step.title}
                </h3>

                {/* Description */}
                <p 
                  className="text-base leading-relaxed"
                  style={{ color: COLORS.gray[600] }}
                >
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;

