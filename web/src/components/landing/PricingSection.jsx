// web/src/components/landing/PricingSection.jsx
import React, { useRef, useState } from 'react';
import { Check, Zap } from 'lucide-react';
import { COLORS } from '../../constants';
import { useInView } from '../../hooks/useResponsive';

/**
 * Pricing Section Component
 * Displays monthly and annual plans
 */
const PricingSection = ({ onGetStarted }) => {
  const [isYearly, setIsYearly] = useState(true);

  // --- Animation Hooks ---
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { threshold: 0.1, triggerOnce: true });

  const features = [
    'AI Meal Generation',
    'Personalized Macro Tracking',
    'Weekly Meal Planning Calendar',
    'Automatic Grocery Lists',
    'Unlimited Recipe Substitutes',
    'Health Goal & Progress Monitoring',
  ];

  const plans = [
    {
      name: 'Monthly',
      price: '$5',
      pricePer: '/ month',
      originalPrice: null,
      badge: null,
      isPrimary: false,
    },
    {
      name: 'Yearly',
      price: '$55',
      pricePer: '/ year',
      originalPrice: '$60',
      badge: 'Save 8%',
      isPrimary: true,
    },
  ];

  return (
    <section
      id="pricing" // <-- Added ID for footer link
      ref={sectionRef} // <-- Assign ref for animation
      className="py-20 md:py-32 bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/* Section Header */}
        <div
          className={`text-center mb-16 ${
            isInView ? 'animate-fadeInUp' : 'opacity-0'
          }`}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-4 font-poppins">
            <span style={{ color: COLORS.gray[900] }}>Simple, All-Inclusive</span>
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Transparent Pricing
            </span>
          </h2>
          <p
            className="text-lg md:text-xl max-w-3xl mx-auto"
            style={{ color: COLORS.gray[600] }}
          >
            Start with a 7-day free trial. Cancel anytime.
            One plan, all features included.
          </p>
        </div>

        {/* Pricing Cards */}
        <div
          className={`grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto ${
            isInView ? 'animate-fadeInUp' : 'opacity-0'
          }`}
          style={{ animationDelay: '150ms' }}
        >
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-8 border-2 transition-all ${
                plan.isPrimary
                  ? 'border-indigo-600 shadow-2xl relative'
                  : 'border-gray-200'
              }`}
            >
              {plan.badge && (
                <div
                  className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full font-semibold text-sm text-white"
                  style={{ backgroundColor: COLORS.primary[600] }}
                >
                  {plan.badge}
                </div>
              )}

              <h3
                className="text-xl font-semibold mb-2"
                style={{ color: COLORS.gray[800] }}
              >
                {plan.name} Plan
              </h3>
              <div className="flex items-end mb-6">
                <span
                  className="text-5xl font-extrabold"
                  style={{ color: COLORS.gray[900] }}
                >
                  {plan.price}
                </span>
                <span
                  className="text-lg font-medium ml-2"
                  style={{ color: COLORS.gray[500] }}
                >
                  {plan.pricePer}
                </span>
                {plan.originalPrice && (
                  <span
                    className="text-lg font-medium ml-3 line-through"
                    style={{ color: COLORS.gray[400] }}
                  >
                    {plan.originalPrice}
                  </span>
                )}
              </div>

              <button
                onClick={onGetStarted}
                className={`w-full py-3.5 rounded-lg font-semibold text-lg transition-all flex items-center justify-center space-x-2 ${
                  plan.isPrimary
                    ? 'text-white hover:shadow-xl'
                    : 'text-indigo-600 hover:bg-indigo-50'
                }`}
                style={{
                  backgroundColor: plan.isPrimary
                    ? COLORS.primary[600]
                    : 'white',
                  borderColor: plan.isPrimary ? 'transparent' : COLORS.gray[300],
                  borderWidth: plan.isPrimary ? 0 : '1px'
                }}
              >
                <Zap size={20} />
                <span>Start 7-Day Trial</span>
              </button>

              <div
                className="w-full h-px my-8"
                style={{ backgroundColor: COLORS.gray[200] }}
              ></div>

              <p
                className="text-sm font-semibold mb-4"
                style={{ color: COLORS.gray[700] }}
              >
                ALL FEATURES INCLUDED:
              </p>
              <ul className="space-y-3">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center space-x-3">
                    <Check
                      size={20}
                      className="flex-shrink-0"
                      style={{ color: COLORS.success.main }}
                    />
                    <span
                      className="text-base"
                      style={{ color: COLORS.gray[600] }}
                    >
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;

