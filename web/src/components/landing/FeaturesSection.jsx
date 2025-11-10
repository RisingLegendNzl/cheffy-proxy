// web/src/components/landing/FeaturesSection.jsx
import React from 'react';
import { Sparkles, Target, Calendar, Heart } from 'lucide-react';
import { COLORS } from '../../constants';

/**
 * Features Section Component
 * Showcases the 4 main features of Cheffy
 */
const FeaturesSection = () => {
  const features = [
    {
      icon: <Sparkles size={32} />,
      title: 'AI Meal Generation',
      description: 'Get personalized meal suggestions based on your preferences, dietary restrictions, and nutritional goals.',
      color: COLORS.primary[500],
      bgColor: COLORS.primary[50]
    },
    {
      icon: <Target size={32} />,
      title: 'Macro Tracking',
      description: 'Monitor your daily protein, carbs, and fats intake with visual progress indicators and detailed breakdowns.',
      color: COLORS.secondary[500],
      bgColor: COLORS.secondary[50]
    },
    {
      icon: <Calendar size={32} />,
      title: 'Meal Planning Calendar',
      description: 'Plan your meals for the week ahead with our intuitive calendar view and automatic grocery list generation.',
      color: COLORS.info.main,
      bgColor: COLORS.info.light
    },
    {
      icon: <Heart size={32} />,
      title: 'Health Goals',
      description: 'Set and achieve your fitness objectives with customized meal plans that support your journey.',
      color: COLORS.error.main,
      bgColor: COLORS.error.light
    }
  ];

  return (
    <section className="py-20 md:py-32 bg-white">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4 font-poppins">
            <span style={{ color: COLORS.gray[900] }}>Everything You Need to</span>
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Master Your Nutrition
            </span>
          </h2>
          <p 
            className="text-lg md:text-xl max-w-3xl mx-auto"
            style={{ color: COLORS.gray[600] }}
          >
            Powerful features designed to make healthy eating simple, sustainable, and enjoyable.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {features.map((feature, index) => (
            <div
              key={index}
              className="p-8 rounded-2xl border-2 transition-all hover:shadow-xl hover:-translate-y-1"
              style={{ 
                borderColor: COLORS.gray[200],
                backgroundColor: 'white'
              }}
            >
              {/* Icon */}
              <div 
                className="w-16 h-16 rounded-xl flex items-center justify-center mb-6"
                style={{ 
                  backgroundColor: feature.bgColor,
                  color: feature.color
                }}
              >
                {feature.icon}
              </div>

              {/* Title */}
              <h3 
                className="text-2xl font-bold mb-4"
                style={{ color: COLORS.gray[900] }}
              >
                {feature.title}
              </h3>

              {/* Description */}
              <p 
                className="text-base leading-relaxed"
                style={{ color: COLORS.gray[600] }}
              >
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;